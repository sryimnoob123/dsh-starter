import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 与 @deepseek-ai/dsh-app-boot 的 PROFILE_PNPM_WORKSPACE 模板保持一致：
 * dsh plugin/dshmarket 在 profile 目录里直接跑 pnpm，profile 必须是独立的 pnpm
 * workspace root，否则 pnpm 会向上解析进壳根的 workspace（[D-pnpm-workspace]），
 * 用壳根的 virtual store 记录校验 profile 的 node_modules，报
 * ERR_PNPM_UNEXPECTED_VIRTUAL_STORE，market 从此装不了任何插件。
 * dsh 的 initProfile 只在 profile 首建时写该文件；预置/分发来的 profile
 * （package.json 已存在）会跳过 init，永远缺这个文件——壳启动时兜底补齐。
 */
const PROFILE_PNPM_WORKSPACE = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n';

/** 扫 dsh-home/profiles/ 下的 profile 目录，补写缺失的 pnpm-workspace.yaml；返回补写的目录名（幂等，已存在不覆盖，任何异常吞掉不阻塞启动） */
export function ensureProfilePnpmWorkspaces(dshHome: string): string[] {
  const profilesDir = join(dshHome, 'profiles');
  let profiles: string[];
  try {
    profiles = readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const healed: string[] = [];
  for (const name of profiles) {
    const dir = join(profilesDir, name);
    try {
      // 只认 dsh profile（有 package.json 的目录）；workspace 文件已存在则尊重现状
      if (!existsSync(join(dir, 'package.json'))) continue;
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) continue;
      writeFileSync(join(dir, 'pnpm-workspace.yaml'), PROFILE_PNPM_WORKSPACE);
      healed.push(name);
    } catch {
      // 单个 profile 失败不影响其余；调用方只记日志
    }
  }
  return healed;
}
