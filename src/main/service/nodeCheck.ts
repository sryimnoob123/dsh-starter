/**
 * Node 运行时版本核验（架构文档 §5.1；要求 ^22.19.0 || >=24，调研 A）。
 */

export interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseNodeVersion(version: string): NodeVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isNodeOk(version: string): boolean {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;
  if (parsed.major >= 24) return true;
  return parsed.major === 22 && parsed.minor >= 19;
}
