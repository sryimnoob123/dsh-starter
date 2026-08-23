/**
 * 首启播种（F1 全量打包）：安装目录随包带了净化种子（dsh-home-seed/profiles/web，
 * 106 插件完整 profile），用户 dsh-home 从未建过 web profile 时整体拷贝，
 * 实现「装好即用、免联网装插件」。
 * 幂等红线：已有 profiles/web 绝不覆盖（用户数据优先）；开发模式（无种子目录）静默跳过。
 *
 * 两阶段（2026-08-23 实测定序：DSH 启动会写自己的默认 settings.yaml 覆盖播种的完整配置）：
 * - 阶段 1 seedProfileFromBundled（spawn 前）：拷 web profile（DSH 不覆盖已存在的 profile）。
 * - 阶段 2 finalizeSeedSettings（service ready 后，DSH 已完成初始化）：settings 为空壳才补
 *   种子的完整配置（皮肤/主题/权限/模型引用/插件配置），随后删 dsh-home-seed 残留——
 *   终态只有 exe + dsh + dsh-home 三件套。
 */
import { cpSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 文件大小（不存在返回 -1）；settings 空壳判定用 */
function statSize(path: string): number {
  try { return statSync(path).size; } catch { return -1; }
}

/**
 * DSH 初始化的空壳 settings：只有 permission 默认段（无任何插件/UI/模型配置）。
 * 判定 = 文件存在且内容不含任何"配置段"特征（desktop-background/llm-pi-ai/agent-presets/ui-theme/dsh- 插件段）。
 */
export function isSettingsShell(path: string): boolean {
  const size = statSize(path);
  if (size < 0 || size > 500) return false; // 超过 500 字节必有实质内容
  try {
    const text = readFileSync(path, 'utf8');
    return !/desktop-background|llm-pi-ai|agent-presets|ui-theme|dsh-|onboarding/.test(text);
  } catch {
    return false;
  }
}

/**
 * 阶段 1（spawn 前）：web profile 缺失时从种子整体拷贝（106 插件 + patch + manifest）。
 * 不删 dsh-home-seed（阶段 2 还要读 settings）；已存在 → 用户数据绝不动。
 */
export function seedProfileFromBundled(options: {
  installDir: string;
}): { seeded: boolean; reason: string } {
  const seedRoot = join(options.installDir, 'dsh-home-seed', 'profiles', 'web');
  if (!existsSync(seedRoot)) {
    return { seeded: false, reason: 'no-bundled-seed' };
  }
  const target = join(options.installDir, 'dsh-home', 'profiles', 'web');
  if (existsSync(join(target, 'package.json'))) {
    return { seeded: false, reason: 'profile-exists' };
  }
  try {
    cpSync(seedRoot, target, { recursive: true });
    return { seeded: true, reason: 'seeded-from-bundle' };
  } catch {
    return { seeded: false, reason: 'copy-failed' };
  }
}

/**
 * 阶段 2（service ready 后）：DSH 已完成初始化——settings 缺失或为空壳（DSH 默认 48B）
 * 时补种子的完整配置；用户改过（有实质内容）绝不动。最后删 dsh-home-seed 残留。
 * API key 不在 settings 里（在 .credentials.yaml，不打包），用户自行配置。
 */
export function finalizeSeedSettings(options: {
  installDir: string;
}): { applied: boolean; reason: string } {
  const dshHome = join(options.installDir, 'dsh-home');
  const seedSettings = join(options.installDir, 'dsh-home-seed', 'settings.yaml');
  let applied = false;
  if (existsSync(seedSettings)) {
    const userSettings = join(dshHome, 'settings.yaml');
    const settingsMissing = !existsSync(userSettings);
    const settingsShell = !settingsMissing && isSettingsShell(userSettings);
    if (settingsMissing || settingsShell) {
      try {
        cpSync(seedSettings, userSettings);
        applied = true;
      } catch {
        // 拷贝失败不阻塞清理
      }
    }
  }
  // 播种完成（无论是否补 settings）→ 删种子残留，终态只有 exe + dsh + dsh-home
  try {
    rmSync(join(options.installDir, 'dsh-home-seed'), { recursive: true, force: true });
  } catch {
    // 删除失败不阻塞（下次启动再清）；日志由调用方记
  }
  return { applied, reason: applied ? 'settings-seeded' : 'no-seed-settings' };
}
