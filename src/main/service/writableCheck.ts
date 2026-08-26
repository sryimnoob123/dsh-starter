/**
 * dsh-home 可写性检测（2026-08-25 修复：EPERM 服务起不来）。
 *
 * 背景：dsh-home 数据目录 = 安装目录，装进 Program Files 后普通用户无写权限，
 * DSH 服务启动 mkdir 抛 EPERM 起不来（真实用户 v0.4.8 踩到）。
 *
 * 检测方式：试写探针（在目标目录创建临时文件再删除），不用 fs.accessSync(W_OK)——
 * Windows 上 accessSync 不检查 ACL、管理员下恒通过、且有已知不抛错 bug
 * （nodejs/node#44010，bnoordhuis："just try to write and handle the error"）。
 * 探针与 DSH 服务跑在同一进程 token 下，行为一致，能真实反映 mkdir 会不会 EPERM。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** 试写探针：在目标目录创建临时文件再删除。返回 { ok, detail }。 */
export function checkDirWritable(dir: string): { ok: boolean; detail: string } {
  if (!dir) return { ok: false, detail: 'empty dir' };
  const probe = join(dir, `.dsh-write-probe-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(probe, '', { flag: 'wx' });
    rmSync(probe, { force: true });
    return { ok: true, detail: 'writable' };
  } catch (error) {
    try { rmSync(probe, { force: true }); } catch { /* 只读目录下 unlink 也可能 EPERM，忽略 */ }
    return { ok: false, detail: String(error) };
  }
}

/** 是否以管理员（提权）运行。Windows 无 process.getuid；标准做法 = is-admin 包同款：
 *  跑仅管理员可执行的 fsutil dirty query，回退 fltmc（sindresorhus/is-admin）。 */
export function isAdmin(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync('fsutil', ['dirty', 'query', process.env.SystemDrive ?? 'C:'], { stdio: 'ignore' });
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
      try {
        execFileSync('fltmc', { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/** 临时目录可写性（探针用；%TEMP% 被清/被占时返回 false） */
export function checkTempWritable(): { ok: boolean; detail: string } {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-probe-'));
    rmSync(dir, { recursive: true, force: true });
    return { ok: true, detail: 'temp writable' };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}
