import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureProfilePnpmWorkspaces } from './profileWorkspace.js';

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'profile-workspace-'));
  roots.push(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('ensureProfilePnpmWorkspaces（profile 缺 pnpm-workspace.yaml 的启动自愈）', () => {
  it('预置 profile（有 package.json 无 workspace.yaml）→ 补写 dsh 模板，返回目录名', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'profiles/web'), { recursive: true });
    writeFileSync(join(root, 'profiles/web/package.json'), '{}');
    const healed = ensureProfilePnpmWorkspaces(root);
    expect(healed).toEqual(['web']);
    expect(readFileSync(join(root, 'profiles/web/pnpm-workspace.yaml'), 'utf8')).toBe(
      'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
    );
  });

  it('已有 pnpm-workspace.yaml（含用户自定义内容）→ 不覆盖', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'profiles/web'), { recursive: true });
    writeFileSync(join(root, 'profiles/web/package.json'), '{}');
    writeFileSync(join(root, 'profiles/web/pnpm-workspace.yaml'), 'packages:\n  - .\n');
    expect(ensureProfilePnpmWorkspaces(root)).toEqual([]);
    expect(readFileSync(join(root, 'profiles/web/pnpm-workspace.yaml'), 'utf8')).toBe('packages:\n  - .\n');
  });

  it('无 package.json 的目录不是 profile → 跳过；profiles 目录不存在 → 返回空不抛', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'profiles/misc'), { recursive: true });
    expect(ensureProfilePnpmWorkspaces(root)).toEqual([]);
    const empty = makeRoot();
    expect(ensureProfilePnpmWorkspaces(empty)).toEqual([]);
  });

  it('幂等：补写过的目录再次运行不再动文件', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'profiles/web'), { recursive: true });
    writeFileSync(join(root, 'profiles/web/package.json'), '{}');
    ensureProfilePnpmWorkspaces(root);
    expect(ensureProfilePnpmWorkspaces(root)).toEqual([]);
  });
});
