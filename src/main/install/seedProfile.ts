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
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cp as cpAsync, rename as renameAsync } from 'node:fs/promises';
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
 *
 * 2026-08-25 修复（首启无响应）：同步 cpSync 拷贝 106 插件 profile 阻塞主进程 2.5 分钟，
 * 窗口无响应、Windows 弹"无响应"警告（真实用户"win11 打不开"根因）。改异步 fs.promises.cp，
 * 主进程事件循环不被阻塞，窗口保持响应。
 */
export async function seedProfileFromBundled(options: {
  installDir: string;
}): Promise<{ seeded: boolean; reason: string }> {
  const seedRoot = join(options.installDir, 'dsh-home-seed', 'profiles', 'web');
  if (!existsSync(seedRoot)) {
    return { seeded: false, reason: 'no-bundled-seed' };
  }
  const target = join(options.installDir, 'dsh-home', 'profiles', 'web');
  if (existsSync(join(target, 'package.json'))) {
    return { seeded: false, reason: 'profile-exists' };
  }
  try {
    // 同盘 rename 瞬时完成（跨盘才触发系统拷贝）。rename 失败（跨卷/权限）→ 回退 cpAsync
    try {
      await renameAsync(seedRoot, target);
      return { seeded: true, reason: 'seeded-from-bundle' };
    } catch {
      // 同盘 rename 失败但 seed 还在 → 走拷贝（跨盘或权限场景）
      if (existsSync(seedRoot)) {
        await cpAsync(seedRoot, target, { recursive: true });
        return { seeded: true, reason: 'seeded-from-bundle' };
      }
      return { seeded: false, reason: 'copy-failed' };
    }
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
  const userSettings = join(dshHome, 'settings.yaml');
  const settingsMissing = !existsSync(userSettings);
  const settingsShell = !settingsMissing && isSettingsShell(userSettings);
  let applied = false;
  if (existsSync(seedSettings)) {
    if (settingsMissing || settingsShell) {
      try {
        cpSync(seedSettings, userSettings);
        applied = true;
      } catch {
        // 拷贝失败不阻塞清理
      }
    } else {
      // [2026-08-26 升级补丁] 用户 settings 有实质内容（4.8 升级产物）但缺
      // dsh-better-sidebar 标题栏兼容段（4.8 种子净化误删，4.3 有）→ 合并补上该段，
      // 不覆盖用户其他配置（4.8 真实用户按钮重叠根因）。
      applied = mergeMissingSidebarCompat(seedSettings, userSettings);
    }
  }
  // 播种完成（无论是否补 settings）→ 删种子残留，终态只有 exe + dsh + dsh-home
  try {
    rmSync(join(options.installDir, 'dsh-home-seed'), { recursive: true, force: true });
  } catch {
    // 删除失败不阻塞（下次启动再清）；日志由调用方记
  }
  return { applied, reason: applied ? (settingsMissing || settingsShell ? 'settings-seeded' : 'sidebar-compat-merged') : 'no-seed-settings' };
}

/**
 * 升级补丁：用户 settings 缺 dsh-better-sidebar 段时，从种子合并该段（保留用户其他内容）。
 * 段已存在但缺关键字段（interceptOpenPath）时，只补该字段——用户已有字段绝不覆盖。
 * 纯文本按段合并（settings.yaml 是简单键值 YAML，段首无缩进）。
 */
function mergeMissingSidebarCompat(seedSettings: string, userSettings: string): boolean {
  try {
    const userText = readFileSync(userSettings, 'utf8');
    // 段缺失 → 整体合并
    if (!userText.includes('dsh-better-sidebar')) {
      const seedText = readFileSync(seedSettings, 'utf8');
      // 从种子提取 dsh-better-sidebar 段（段首无缩进，到下一个无缩进行为止）
      const lines = seedText.split(/\r?\n/);
      let inSidebar = false;
      const sidebarLines: string[] = [];
      for (const line of lines) {
        if (line === 'dsh-better-sidebar:') { inSidebar = true; sidebarLines.push(line); continue; }
        if (inSidebar) {
          if (/^\S/.test(line) && line.length > 0) break; // 下一个顶层段
          sidebarLines.push(line);
        }
      }
      if (sidebarLines.length === 0) return false;
      // 用户 settings 末尾补一段
      const merged = userText.replace(/\s*$/, '\n') + '\n' + sidebarLines.join('\n') + '\n';
      writeFileSync(userSettings, merged, 'utf8');
      return true;
    }
    // 2. 段存在但缺 interceptOpenPath → 补该字段（UI「打开路径拦截」开关，045/046/047 种子都有，
    //    4.8 净化误删整段、首次修复只补了 titleBar 3 字段 → 升级用户该自定义项消失）
    if (!userText.includes('interceptOpenPath')) {
      const seedText = readFileSync(seedSettings, 'utf8');
      if (!seedText.includes('interceptOpenPath')) return false; // 种子也没有（dev 场景）不动作
      const merged = userText.replace(/(dsh-better-sidebar:\s*\r?\n)/, '$1  interceptOpenPath: true\n');
      if (merged === userText) return false;
      writeFileSync(userSettings, merged, 'utf8');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
