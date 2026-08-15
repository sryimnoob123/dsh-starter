/**
 * 文件路径纯函数（壳侧承接 DSH 对话里的文件路径动作：右键菜单 / 复制 / 打开 / 定位）。
 * 与 DSH 客户端 `resolveWorkspacePath` 同语义：绝对路径原样返回，相对路径按会话工作区根（cwd）拼接。
 */

import { join } from 'node:path';

/** 是否绝对路径（POSIX 根 `/`、Windows 盘符 `C:`、UNC `\\server`） */
export function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\');
}

/** 相对路径按 cwd 拼成绝对路径；cwd 缺失或路径已绝对时原样返回（与 DSH 行为一致） */
export function resolveFilePath(cwd: string | undefined, path: string): string {
  if (isAbsoluteFilePath(path)) return path;
  if (cwd === undefined || cwd === '') return path;
  return join(cwd, path);
}
