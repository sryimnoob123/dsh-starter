import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { watch } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { effectiveAgentsText, registeredWorkspacePath, validatePromptConfig, validateProjectText } from './lib/core.js';

const NS = settingsNamespace('desktop-global-prompt');
const Config = z.object({
  enabled: z.boolean().default(true), globalPrompt: z.string().default(''),
  includeHarnessIdentity: z.boolean().default(false), personaEnabled: z.boolean().default(false),
  persona: z.string().default(''), includeRuntimeContext: z.boolean().default(false),
  notifyResult: z.boolean().default(true), migrated: z.boolean().default(false),
});
const json = (res, status, value) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
const body = async (req) => { const chunks=[]; let size=0; for await (const c of req) { size+=c.length; if (size>2*1024*1024) throw new Error('payload too large'); chunks.push(c); } return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); };
const atomicWrite = async (path, text) => { await mkdir(dirname(path), { recursive: true }); const tmp=`${path}.${process.pid}.${Date.now()}.tmp`; await writeFile(tmp, text, 'utf8'); await rename(tmp, path); };

// Config 白名单:PUT 只挑这些键,防止客户端把 GET 响应里附带的 agentsPath 等
// 服务端字段透传持久化(schemastery object 非 strict,未知键原样保留)。
const PROMPT_KEYS = ['enabled', 'globalPrompt', 'includeHarnessIdentity', 'personaEnabled', 'persona', 'includeRuntimeContext', 'notifyResult'];
const pickPromptKeys = (input) => {
  const picked = {};
  for (const k of PROMPT_KEYS) if (k in input) picked[k] = input[k];
  return picked;
};

export function apply(ctx) {
  ctx.inject(['settings', 'webServer', 'workspaceRegistry', 'systemPrompt'], (sctx) => {
    const scope = sctx.settings.register(NS, Config);
    const agentsPath = join(resolveDshHome(), 'AGENTS.md');
    // 内容守卫:与磁盘当前文本相同时跳过写入。既省一次 rename/fs 事件,
    // 也让「外部改文件 → 回写 settings → watch 回调」方向不再写盘,防死循环。
    // enabled=false 时跳过写盘:禁用语义由 system-prompt/assemble 过滤承担,
    // 不覆盖用户手动维护的磁盘内容(否则取消启用会静默清空用户文件)。
    const syncAgents = async (config) => {
      if (config.enabled === false) return;
      const next = effectiveAgentsText(config);
      try { if (await readFile(agentsPath, 'utf8') === next) return; }
      catch (e) { if (e?.code !== 'ENOENT') throw e; /* ENOENT 视为空,继续写 */ }
      await atomicWrite(agentsPath, next);
      lastSyncedText = next;
    };
    // 启动 reconcile:磁盘优先,防止默认空配置覆盖用户手动维护的 AGENTS.md。
    // 磁盘有内容且与 settings 不同 → 回填 settings(磁盘是用户事实源),不写盘。
    const reconcileOnStart = async () => {
      const config = scope.get();
      if (config.enabled === false) return;
      let disk = null;
      try { disk = await readFile(agentsPath, 'utf8'); }
      catch (e) { if (e?.code !== 'ENOENT') throw e; }
      if (disk === null) return syncAgents(config);
      if (disk !== config.globalPrompt) {
        if (validatePromptConfig({ globalPrompt: disk })) { ctx.logger.warn('desktop-global-prompt: existing AGENTS.md exceeds limit, left untouched'); return; }
        await scope.update({ globalPrompt: disk });
      }
    };
    // 文件 → settings 方向:监听 $DSH_HOME 目录(AGENTS.md 是 tmp+rename 原子替换,
    // 必须监听目录并按文件名过滤,直接监听文件会漏事件)。事件防抖 150ms,
    // 对齐官方 dsh-settings-file 的 debounce 思想;回调只回写 globalPrompt。
    // 边界:enabled=false 时文件本就被插件清空,外部编辑无注入意义,忽略不回写;
    // 超限文本(>1MiB)也不回写,与 PUT 路径的 validatePromptConfig 校验保持一致。
    // 自写守卫:lastSyncedText 记录插件上次写入的文本,回写时跳过「自己写的」,
    // 避免 UI 保存 → 写盘 → watch 事件 → 回写 的环。
    let lastSyncedText = null;
    const watchAgentsFile = (scope) => {
      let timer = null;
      let closed = false;
      let watcher;
      const dispose = () => { closed = true; if (timer) { clearTimeout(timer); timer = null; } if (watcher) watcher.close(); };
      try {
        watcher = watch(dirname(agentsPath), async (_event, filename) => {
          if (closed) return;
          // Windows 上事件 filename 可能是小写或 Buffer;统一小写比较避免漏事件
          if (filename !== null && basename(String(filename)).toLowerCase() !== basename(agentsPath).toLowerCase()) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(async () => {
            timer = null;
            if (closed) return;
            try {
              const config = scope.get();
              if (config.enabled === false) return;
              const text = await readFile(agentsPath, 'utf8');
              if (text === config.globalPrompt) return;
              if (lastSyncedText === text) return;
              if (validatePromptConfig({ globalPrompt: text })) { ctx.logger.warn('desktop-global-prompt: AGENTS.md exceeds limit, skipped'); return; }
              await scope.update({ globalPrompt: text });
            } catch (e) { ctx.logger.warn('desktop-global-prompt: sync from AGENTS.md failed: %o', e); }
          }, 150);
        });
        watcher.on('error', (e) => ctx.logger.warn('desktop-global-prompt: AGENTS.md watch error: %o', e));
      } catch (e) {
        // $DSH_HOME 首次创建前目录可能不存在;watch 失败不阻断插件其余功能
        ctx.logger.warn('desktop-global-prompt: cannot watch AGENTS.md: %o', e);
      }
      return dispose;
    };
    // includeRuntimeContext=false → 抑制 DSH 官方运行时上下文快照(旧壳基线行为)。
    // suppressor 是全局层 effect:随配置变化先 dispose 再按需重建,并在插件卸载/重载时
    // 一并清理,避免 suppressor 泄漏影响所有 agent。
    let suppressDisposer = null;
    const applySuppression = (config) => {
      try {
        if (suppressDisposer) { suppressDisposer(); suppressDisposer = null; }
        // enabled=false → 不抑制,回退 DSH 原生行为(与 UI 总开关语义一致)
        if (config.enabled !== false && !config.includeRuntimeContext) suppressDisposer = sctx.systemPrompt.suppressRuntimeContext();
      } catch (e) { ctx.logger.warn('desktop-global-prompt: suppression failed: %o', e); }
    };
    reconcileOnStart().catch((e) => ctx.logger.warn(e));
    const disposeWatch = watchAgentsFile(scope);
    sctx.effect(() => {
      applySuppression(scope.get());
      const watcher = scope.watch((next) => { applySuppression(next); return syncAgents(next); });
      return () => { watcher(); if (suppressDisposer) { suppressDisposer(); suppressDisposer = null; } disposeWatch(); };
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
      } catch (e) { return json(res,400,{ error: e?.message ?? 'bad-request' }); }
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
      } catch(e) { return json(res,400,{error: e instanceof Error ? e.message : 'bad-request'}); }
    }}), 'desktop-global-prompt: project api');
  });
}
