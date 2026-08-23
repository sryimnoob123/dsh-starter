import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { effectiveAgentsText, registeredWorkspacePath, validatePromptConfig, validateProjectText } from './lib/core.js';

const NS = settingsNamespace('desktop-global-prompt');
const Config = z.object({
  enabled: z.boolean().default(true), globalPrompt: z.string().default(''),
  includeHarnessIdentity: z.boolean().default(false), personaEnabled: z.boolean().default(false),
  persona: z.string().default(''), includeRuntimeContext: z.boolean().default(false),
  notifyResult: z.boolean().default(true), migrated: z.boolean().default(false),
});
const json = (res, status, value) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
const body = async (req) => { const chunks=[]; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); };
const atomicWrite = async (path, text) => { await mkdir(dirname(path), { recursive: true }); const tmp=`${path}.tmp`; await writeFile(tmp, text, 'utf8'); await rename(tmp, path); };

// Config 白名单:PUT 只挑这些键,防止客户端把 GET 响应里附带的 agentsPath 等
// 服务端字段透传持久化(schemastery object 非 strict,未知键原样保留)。
const PROMPT_KEYS = ['enabled', 'globalPrompt', 'includeHarnessIdentity', 'personaEnabled', 'persona', 'includeRuntimeContext', 'notifyResult', 'migrated'];
const pickPromptKeys = (input) => {
  const picked = {};
  for (const k of PROMPT_KEYS) if (k in input) picked[k] = input[k];
  return picked;
};

export function apply(ctx) {
  ctx.inject(['settings', 'webServer', 'workspaceRegistry', 'systemPrompt'], (sctx) => {
    const scope = sctx.settings.register(NS, Config);
    const agentsPath = join(resolveDshHome(), 'AGENTS.md');
    const syncAgents = (config) => atomicWrite(agentsPath, effectiveAgentsText(config));
    // includeRuntimeContext=false → 抑制 DSH 官方运行时上下文快照(旧壳基线行为)。
    // suppressor 是全局层 effect:随配置变化先 dispose 再按需重建,并在插件卸载/重载时
    // 一并清理,避免 suppressor 泄漏影响所有 agent。
    let suppressDisposer = null;
    const applySuppression = (config) => {
      if (suppressDisposer) { suppressDisposer(); suppressDisposer = null; }
      // enabled=false → 不抑制,回退 DSH 原生行为(与 UI 总开关语义一致)
      if (config.enabled !== false && !config.includeRuntimeContext) suppressDisposer = sctx.systemPrompt.suppressRuntimeContext();
    };
    syncAgents(scope.get()).catch((e) => ctx.logger.warn(e));
    sctx.effect(() => {
      applySuppression(scope.get());
      const watcher = scope.watch((next) => { applySuppression(next); return syncAgents(next); });
      return () => { watcher(); if (suppressDisposer) { suppressDisposer(); suppressDisposer = null; } };
    }, 'desktop-global-prompt: sync AGENTS.md');
    sctx.on('system-prompt/assemble', async (assembly, _context, next) => {
      const out = await next(); const c = scope.get(); if (!c.enabled) return out;
      out.sections = out.sections.filter((x) => x.name !== 'harness:identity');
      if (c.includeHarnessIdentity) out.sections.unshift({ name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' });
      if (c.personaEnabled) {
        const found = out.sections.find((x) => x.name === 'deployment:persona');
        if (found) found.text = c.persona; else out.sections.push({ name: 'deployment:persona', text: c.persona });
      }
      return out;
    });
    sctx.effect(() => sctx.webServer.register({ kind:'exact', path:'/api/desktop-global-prompt', handler: async (req,res) => {
      try {
        if (req.method === 'GET') return json(res,200,{ ...scope.get(), agentsPath });
        if (req.method === 'PUT') {
          const input = pickPromptKeys(await body(req));
          const error = validatePromptConfig(input);
          if (error) return json(res,400,{ error });
          await scope.update(input);
          return json(res,200,scope.get());
        }
        return json(res,405,{ error:'method-not-allowed' });
      } catch (e) { return json(res,400,{ error:String(e) }); }
    }}), 'desktop-global-prompt: api');
    sctx.effect(() => sctx.webServer.register({ kind:'exact', path:'/api/desktop-project-instructions', handler: async (req,res) => {
      try {
        const input=await body(req); const workspacePath=registeredWorkspacePath(sctx.workspaceRegistry,String(input.workspaceId??''));
        if (!workspacePath) return json(res,404,{error:'workspace-not-found'});
        const file=join(resolve(workspacePath), 'AGENTS.md');
        if (req.method === 'POST') { let text=''; try { text=await readFile(file,'utf8'); } catch (e) { if (e?.code!=='ENOENT') throw e; } return json(res,200,{path:file,text}); }
        if (req.method === 'PUT') {
          const error = validateProjectText(input.text);
          if (error) return json(res,400,{error});
          await atomicWrite(file,String(input.text ?? ''));
          return json(res,200,{path:file});
        }
        return json(res,405,{error:'method-not-allowed'});
      } catch(e) { return json(res,400,{error:String(e)}); }
    }}), 'desktop-global-prompt: project api');
  });
}
