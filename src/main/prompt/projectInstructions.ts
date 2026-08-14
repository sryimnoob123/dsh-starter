import { join } from 'node:path';

/**
 * FR-16.7 项目级指令编辑（P1）：工作区 AGENTS.md（CLAUDE.md 为 DSH 同层别名）。
 * 壳通过 `workspace.list` RPC 拿工作区**路径**（DSH 官方 WorkspaceView.path），
 * 直接读写 `<path>/AGENTS.md`；页面只传 workspaceId，路径一律服务端现查——
 * 桥接不暴露任意文件写入能力。
 */

export interface WorkspaceRow {
  workspaceId: string;
  title: string;
  path: string;
}

/** workspace.list 响应归一化：垃圾项丢弃、字段兜底为字符串、缺 id/path 的行丢弃 */
export function normalizeWorkspaceRows(raw: unknown): WorkspaceRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: WorkspaceRow[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const workspaceId = typeof obj.workspaceId === 'string' || typeof obj.workspaceId === 'number'
      ? String(obj.workspaceId)
      : '';
    const title = typeof obj.title === 'string' ? obj.title : '';
    const path = typeof obj.path === 'string' ? obj.path : '';
    if (workspaceId !== '' && path !== '') rows.push({ workspaceId, title, path });
  }
  return rows;
}

/** 按 workspaceId 查路径；未命中 null（写文件前必查，防任意路径写入） */
export function resolveWorkspacePath(workspaces: WorkspaceRow[], workspaceId: string): string | null {
  const row = workspaces.find((w) => w.workspaceId === workspaceId);
  return row ? row.path : null;
}

/** 项目级指令文件 = <工作区>/AGENTS.md（[FR-16.7]） */
export function projectAgentsPath(workspacePath: string): string {
  return join(workspacePath, 'AGENTS.md');
}
