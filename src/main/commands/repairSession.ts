/**
 * F2 修复按钮：一键把诊断摘要 + 日志尾部 + 环境发给 DSH 新开会话，让 DSH 自修。
 *
 * 稳定边界（DSH 官方行为，dsh-client-connection 源码）：
 * - `session.create`：载荷 {workspaceId?|cwd?, sessionId?, agentPreset?}（workspaceId 与 cwd 互斥），
 *   响应 { sessionId, agentPreset? }；
 * - `session.prompt`：载荷 { sessionId, mode: 'queue', content: [{type:'text', text}] }，
 *   内容恰为 / 开头文本块时宿主当斜杠命令执行、不进模型轮次；普通文本则进模型轮次。
 * 修复会话 = 新开会话（cwd 取当前会话工作区）+ 注入结构化首条消息（诊断数据 + 日志路径 + 建议动作）。
 */
import { callRpc } from '../service/rpc.js';

export interface RepairContext {
  /** 当前会话工作区根（session.create 的 cwd；无则省略） */
  cwd?: string;
  /** 最近自救事件摘要（rescueEngine onEvent 收集；无则省略） */
  rescueSummary?: string;
  /** 已隔离插件包名（逗号分隔；无则省略） */
  isolatedPlugins?: string;
  /** shell.log 尾部（readLogTail 输出） */
  shellLogTail: string;
  /** service.log 尾部（readLogTail 输出；无则省略） */
  serviceLogTail?: string;
  /** 环境摘要：版本/端口/profile */
  envSummary: string;
}

/** 修复会话首条消息（结构化：角色设定 + 诊断数据 + 日志路径 + 建议动作清单） */
export function buildRepairPrompt(ctx: RepairContext): string {
  const lines: string[] = [
    '你是 deepseek-harness-starter 桌面壳的维护助手。下面是一次「修复请求」：',
    '请阅读诊断数据与日志，定位问题并给出修复动作；能直接执行的修复请说明具体命令或配置改动。',
    '',
    '## 环境',
    ctx.envSummary,
  ];
  if (ctx.rescueSummary) {
    lines.push('', '## 最近自救事件', ctx.rescueSummary);
  }
  if (ctx.isolatedPlugins) {
    lines.push('', '## 已隔离插件', ctx.isolatedPlugins, '（本次会话已自动停用；修复后重启壳会自动重新尝试加载）');
  }
  lines.push('', '## 日志（shell.log 尾部）', ctx.shellLogTail);
  if (ctx.serviceLogTail) {
    lines.push('', '## 日志（service.log 尾部）', ctx.serviceLogTail);
  }
  lines.push('', '## 建议动作清单', '- 定位根因并说明修复步骤；', '- 涉及配置/插件改动的，给出具体文件路径与改动内容；', '- 无法确定时说明需要哪些进一步信息。');
  return lines.join('\n');
}

/** session.create 载荷（cwd 可选；workspaceId 与 cwd 互斥，这里只用 cwd） */
export function buildCreateSessionPayload(cwd?: string): { cwd?: string } {
  return cwd ? { cwd } : {};
}

/** session.prompt 载荷（queue 模式；修复消息进模型轮次） */
export function buildRepairPromptPayload(sessionId: string, text: string): {
  sessionId: string;
  mode: 'queue';
  content: Array<{ type: 'text'; text: string }>;
} {
  return { sessionId, mode: 'queue', content: [{ type: 'text', text }] };
}

/**
 * 发起修复会话：session.create → session.prompt 注入首条消息。
 * 返回 { ok: true, sessionId } 或 { ok: false, error }（前端展示）。
 */
export async function openRepairSession(options: {
  port: number;
  ctx: RepairContext;
  /** 测试注入：RPC 传输层（callRpc 的 fetchImpl 透传） */
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  try {
    const created = (await callRpc({
      port: options.port,
      method: 'session.create',
      payload: buildCreateSessionPayload(options.ctx.cwd),
      fetchImpl: options.fetchImpl,
    })) as { sessionId?: unknown };
    if (typeof created?.sessionId !== 'string' || created.sessionId === '') {
      return { ok: false, error: 'session.create 返回异常（无 sessionId）' };
    }
    await callRpc({
      port: options.port,
      method: 'session.prompt',
      payload: buildRepairPromptPayload(created.sessionId, buildRepairPrompt(options.ctx)),
      fetchImpl: options.fetchImpl,
    });
    return { ok: true, sessionId: created.sessionId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `修复会话失败：${detail}` };
  }
}
