/**
 * 版本比较（[D78] 自动检查更新 + 自动下载，安装由用户确认）。
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(version: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function needsUpdate(current: string, latest: string): boolean {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return false;
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}
