/**
 * 数据备份（[整合包调研] 高优先级差距项）：把 dsh-home 的配置层备份到用户选择的位置。
 * - 备份内容：profiles/* 的配置文件（package.json/cordis.patch.yml/pnpm-workspace.yaml/pnpm-lock.yaml）、
 *   sessions/（会话记录）、settings.yaml、AGENTS.md、dsh-config-manager/、storages/；
 * - 排除：node_modules（358M 可重装）、.cache/（缓存）、.credentials.yaml（凭据）、
 *   undo-snapshots/（撤销快照）、.dsh-market/（市场缓存）、plugins/（插件实体可重装）、
 *   dsh-update-checker-backups/（更新检查器自己的备份，避免备份套备份）；
 * - 全程异步（fs/promises），不阻塞主进程事件循环；
 * - 只复制、不删除源（备份不破坏原数据）。
 */
import { cp as fsCp, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 顶层排除（隐私 + 可重装 + 临时 + 备份噪音） */
const EXCLUDED_TOP = new Set([
  'node_modules',
  '.cache',
  '.credentials.yaml',
  'undo-snapshots',
  'dsh-update-checker-backups',
  'dsh-update-checker-ops.log',
  'dsh-update-checker-state.json',
]);
/** profile/web 内排除（插件实体可重装） */
const EXCLUDED_WEB = new Set(['node_modules', '.dsh-market', 'plugins']);

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  try {
    for (const name of await readdir(dir)) {
      const p = join(dir, name);
      if ((await stat(p)).isDirectory()) n += await countFiles(p);
      else n += 1;
    }
  } catch {
    // 单个目录读失败不影响整体
  }
  return n;
}

/** 复制一个目录树；跳过排除项；返回复制的文件数 + 跳过清单。 */
async function copyTree(src: string, dst: string, exclude: ReadonlySet<string>, skipped: string[]): Promise<number> {
  let copied = 0;
  for (const name of await readdirSafe(src)) {
    if (exclude.has(name)) {
      skipped.push(name);
      continue;
    }
    const s = join(src, name);
    const d = join(dst, name);
    try {
      await cp(s, d);
      copied += (await stat(s)).isDirectory() ? await countFiles(s) : 1;
    } catch (error) {
      skipped.push(`${name} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return copied;
}

/** cp 封装：目录递归复制（fs/promises.cp 递归 + 覆盖，Node ≥16.7）。 */
async function cp(src: string, dst: string): Promise<void> {
  await mkdir(join(dst, '..'), { recursive: true });
  await fsCp(src, dst, { recursive: true });
}

/**
 * 备份 dsh-home 配置层到 targetRoot（自动创建子目录 dsh-backup-<时间戳>）。
 * @returns ok:true + 备份根路径 + 复制的文件数 + 跳过清单；或 ok:false + error。
 */
export async function backupDshHome(options: { dshHome: string; targetRoot: string }): Promise<
  | { ok: true; backupRoot: string; copied: number; skipped: string[] }
  | { ok: false; error: string }
> {
  try {
    if (!existsSync(options.dshHome)) return { ok: false, error: 'dsh-home 不存在，无法备份' };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupRoot = join(options.targetRoot, `dsh-backup-${stamp}`);
    await mkdir(backupRoot, { recursive: true });

    const skipped: string[] = [];
    let copied = 0;
    // profiles 特殊处理：web 内还排除插件实体（node_modules/.dsh-market/plugins），其余 profile 正常复制
    const profilesSrc = join(options.dshHome, 'profiles');
    if (existsSync(profilesSrc)) {
      copied += await copyProfilesTree(profilesSrc, join(backupRoot, 'profiles'), skipped);
    }
    for (const name of await readdirSafe(options.dshHome)) {
      if (name === 'profiles' || EXCLUDED_TOP.has(name)) {
        if (name !== 'profiles') skipped.push(name);
        continue;
      }
      const s = join(options.dshHome, name);
      const d = join(backupRoot, name);
      try {
        await cp(s, d);
        copied += (await stat(s)).isDirectory() ? await countFiles(s) : 1;
      } catch (error) {
        skipped.push(`${name} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    return { ok: true, backupRoot, copied, skipped };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** profiles 层排除（更新检查器自己的备份/日志/状态 + 依赖实体——避免备份套备份） */
const EXCLUDED_PROFILES = new Set([
  'node_modules',
  'dsh-update-checker-backups',
  'dsh-update-checker-ops.log',
  'dsh-update-checker-state.json',
]);

/** 复制 profiles 层：web profile 排除插件实体，其余 profile 正常复制。 */
async function copyProfilesTree(src: string, dst: string, skipped: string[]): Promise<number> {
  let copied = 0;
  for (const name of await readdirSafe(src)) {
    if (EXCLUDED_PROFILES.has(name)) {
      skipped.push(`profiles/${name}`);
      continue;
    }
    const s = join(src, name);
    const d = join(dst, name);
    try {
      if (name === 'web') {
        copied += await copyTree(s, d, EXCLUDED_WEB, skipped);
      } else {
        await cp(s, d);
        copied += (await stat(s)).isDirectory() ? await countFiles(s) : 1;
      }
    } catch (error) {
      skipped.push(`profiles/${name} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return copied;
}
