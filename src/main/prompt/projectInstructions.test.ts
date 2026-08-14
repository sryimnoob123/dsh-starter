import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeWorkspaceRows,
  projectAgentsPath,
  resolveWorkspacePath,
  type WorkspaceRow,
} from './projectInstructions.js';

describe('normalizeWorkspaceRows（workspace.list 响应归一化）', () => {
  it('过滤垃圾项并补齐字段', () => {
    const raw = [
      { workspaceId: 'w1', title: '项目一', path: 'C:\\proj\\a' },
      null,
      'x',
      { workspaceId: 42, title: 't', path: 'C:\\proj\\b' },
      { workspaceId: '', path: '' },
      { workspaceId: 'w3', path: '' },
      { title: 'no-path', path: 'C:\\proj\\c' },
    ];
    expect(normalizeWorkspaceRows(raw)).toEqual([
      { workspaceId: 'w1', title: '项目一', path: 'C:\\proj\\a' },
      { workspaceId: '42', title: 't', path: 'C:\\proj\\b' },
    ]);
  });

  it('非数组 → 空', () => {
    expect(normalizeWorkspaceRows(null)).toEqual([]);
    expect(normalizeWorkspaceRows({ items: [] })).toEqual([]);
  });
});

describe('resolveWorkspacePath', () => {
  const rows: WorkspaceRow[] = [
    { workspaceId: 'w1', title: 'a', path: 'C:\\proj\\a' },
    { workspaceId: 'w2', title: 'b', path: 'C:\\proj\\b' },
  ];

  it('命中返回路径；未命中返回 null（写文件前必查，防任意路径写入）', () => {
    expect(resolveWorkspacePath(rows, 'w2')).toBe('C:\\proj\\b');
    expect(resolveWorkspacePath(rows, 'w-missing')).toBeNull();
    expect(resolveWorkspacePath([], 'w1')).toBeNull();
  });
});

describe('projectAgentsPath', () => {
  it('= <工作区>/AGENTS.md（[FR-16.7] 项目级指令文件）', () => {
    expect(projectAgentsPath('C:\\proj\\a')).toBe('C:\\proj\\a\\AGENTS.md');
  });

  it('与 join 语义一致（跨平台由 node:path 保证）', () => {
    expect(projectAgentsPath('/a/b')).toBe(join('/a/b', 'AGENTS.md'));
  });
});
