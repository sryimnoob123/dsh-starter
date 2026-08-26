/**
 * 更新后用户数据恢复（2026-08-24 P0 数据丢失兜底修复）：
 * electron-builder 24.x 把 build/installer.nsh 的宏注入到脚本尾部（晚于 uninstaller.nsh
 * 的 !ifmacrodef 检查），导致 customRemoveFiles/customInstall/customUnInstall 全部不生效，
 * NSIS 默认更新流程直接 RMDir 删除整个 $INSTDIR（含 dsh-home 用户数据）。
 *
 * 本模块是独立于 NSIS 宏的**壳侧兜底**：更新时 dsh-home 被移到 %TEMP%\dsh-home-preserve
 * （旧安装器 customRemoveFiles 若生效则主动移，否则 NSIS 默认流程会挪走旧目录）；
 * 壳启动时检测该保留目录，若当前 dsh-home 空壳（用户数据已丢）则把保留数据整体移回。
 *
 * 幂等：已有完整 dsh-home 不覆盖；失败收敛不阻塞启动。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** 保留目录名（与 installer.nsh 的 customRemoveFiles 一致；固定名，跨进程可见）。 */
export const PRESERVE_DIR = 'dsh-home-preserve';

/** 壳侧更新前备份目录名（独立于 NSIS 宏的 preserve；宏失效时兜底恢复用）。 */
export const BACKUP_DIR = 'dsh-home-backup';

/** %TEMP% 下保留目录的完整路径。 */
export function preserveDir(tempRoot: string = tmpdir()): string {
  return join(tempRoot, PRESERVE_DIR, 'dsh-home');
}

/** %TEMP% 下壳侧备份目录的完整路径。 */
export function backupDir(tempRoot: string = tmpdir()): string {
  return join(tempRoot, BACKUP_DIR, 'dsh-home');
}

/** 判断 dsh-home 是否为"空壳"（无 web profile 内容）——用户数据已丢的判定。 */
function isDshHomeEmpty(dshHome: string): boolean {
  try {
    const web = join(dshHome, 'profiles', 'web');
    if (!existsSync(web)) return true;
    return readdirSync(web).length === 0;
  } catch {
    return true;
  }
}

/** 保留目录里是否有可恢复的数据（web profile 有内容、settings 有效、或 skills 目录存在）。 */
function hasPreservedData(pr: string): boolean {
  try {
    if (!existsSync(pr)) return false;
    const web = join(pr, 'profiles', 'web');
    if (existsSync(web) && readdirSync(web).length > 0) return true;
    const settings = join(pr, 'settings.yaml');
    if (existsSync(settings) && statSync(settings).size > 60) return true;
    if (existsSync(join(pr, 'skills'))) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 更新前壳侧主动备份（2026-08-25 止血补丁）：
 * NSIS 宏在跨版本更新（旧 uninstaller 执行）时可能不生效，用户数据随整目录删除。
 * 本函数在 quitAndInstall 之前把 dsh-home 完整备份到 %TEMP%\dsh-home-backup，
 * 不依赖任何 NSIS 宏——更新后启动时若 dsh-home 为空壳，从备份恢复。
 * 幂等：已有备份不覆盖（保留最近一次）；失败收敛不阻塞安装。
 */
export function backupDshHomeBeforeUpdate(
  dshHome: string,
  tempRoot: string = tmpdir(),
): { backedUp: boolean; detail: string } {
  if (!existsSync(dshHome)) return { backedUp: false, detail: 'no-dsh-home' };
  const bk = backupDir(tempRoot);
  try {
    // 已有备份先清掉（保留最近一次，避免旧备份残留占空间）
    if (existsSync(bk)) rmSync(bk, { recursive: true, force: true });
    mkdirSync(join(bk, '..'), { recursive: true });
    cpSync(dshHome, bk, { recursive: true });
    return { backedUp: true, detail: 'backed-up-before-update' };
  } catch (error) {
    return { backedUp: false, detail: `backup-failed: ${String(error)}` };
  }
}

/**
 * 把 %TEMP%\dsh-home-backup 恢复到 dshHome（壳侧备份兜底；NSIS preserve 失效时用）。
 * 与 tryRestorePreservedDshHome 同语义：目标已有完整数据不覆盖。
 * @returns { restored: boolean; detail: string }
 */
export function tryRestoreBackupDshHome(
  dshHome: string,
  tempRoot: string = tmpdir(),
): { restored: boolean; detail: string } {
  const bk = backupDir(tempRoot);
  if (!existsSync(bk)) return { restored: false, detail: 'no-backup-dir' };
  if (!hasPreservedData(bk)) return { restored: false, detail: 'backup-empty' };
  if (!isDshHomeEmpty(dshHome)) return { restored: false, detail: 'existing-dsh-home-kept' };
  try {
    mkdirSync(dshHome, { recursive: true });
    let copied = 0;
    for (const entry of readdirSync(bk)) {
      cpSync(join(bk, entry), join(dshHome, entry), { recursive: true });
      copied += 1;
    }
    // 恢复成功 → 备份生命周期结束（省 %TEMP% 空间；下次更新 customInit 会重建）
    try {
      rmSync(join(tempRoot, BACKUP_DIR), { recursive: true, force: true });
    } catch {
      // 清理失败不阻塞（备份残留无害，下次更新会覆盖）
    }
    return { restored: copied > 0, detail: copied > 0 ? 'restored-from-backup' : 'backup-no-entries' };
  } catch (error) {
    return { restored: false, detail: `restore-failed: ${String(error)}` };
  }
}

/**
 * 把 %TEMP%\dsh-home-preserve 恢复到 dshHome（跨盘用 cpSync，源保留不动）。
 * @returns { restored: boolean; detail: string }
 */
export function tryRestorePreservedDshHome(
  dshHome: string,
  tempRoot: string = tmpdir(),
): { restored: boolean; detail: string } {
  const pr = preserveDir(tempRoot);
  if (!existsSync(pr)) return { restored: false, detail: 'no-preserve-dir' };
  if (!hasPreservedData(pr)) return { restored: false, detail: 'preserve-empty' };
  if (!isDshHomeEmpty(dshHome)) return { restored: false, detail: 'existing-dsh-home-kept' };
  try {
    mkdirSync(dshHome, { recursive: true });
    // 把保留目录下所有条目复制进 dshHome（cpSync 递归+跟随，跨盘安全，源保留）
    let copied = 0;
    for (const entry of readdirSync(pr)) {
      cpSync(join(pr, entry), join(dshHome, entry), { recursive: true });
      copied += 1;
    }
    return { restored: copied > 0, detail: copied > 0 ? 'restored-from-preserve' : 'preserve-no-entries' };
  } catch (error) {
    return { restored: false, detail: `restore-failed: ${String(error)}` };
  }
}
