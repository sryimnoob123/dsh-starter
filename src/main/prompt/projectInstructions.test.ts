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
    expect(normalizeWorkspaceRows('x')).toEqual([]);
    expect(normalizeWorkspaceRows(42)).toEqual([]);
  });

  it('真实响应为 {items:[...]} 包装对象：自动解包（回归：workspace.list 返回包装对象而非裸数组）', () => {
    const raw = {
      items: [
        {
          workspaceId: 'a56ee5ed-bb8c-49a9-8e73-133699c14e4d',
          path: 'C:\\Users\\user\\Desktop\\dsp\\v2',
          title: 'v2',
          sessionIds: [],
          createdAt: '2026-08-14T09:34:09.973Z',
        },
        null,
        { workspaceId: 'w-keep', title: 't', path: 'C:\\proj\\keep', sessionIds: ['s1'] },
        { workspaceId: '', path: '' },
      ],
      archivedSessionIds: ['session-x'],
    };
    expect(normalizeWorkspaceRows(raw)).toEqual([
      { workspaceId: 'a56ee5ed-bb8c-49a9-8e73-133699c14e4d', title: 'v2', path: 'C:\\Users\\user\\Desktop\\dsp\\v2' },
      { workspaceId: 'w-keep', title: 't', path: 'C:\\proj\\keep' },
    ]);
  });

  it('包装对象缺 items → 空', () => {
    expect(normalizeWorkspaceRows({ archivedSessionIds: ['s'] })).toEqual([]);
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
