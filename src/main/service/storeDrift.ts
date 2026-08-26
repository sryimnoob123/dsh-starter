/**
 * pnpm store 漂移检测与自动修复（2026-08-25 修复：ERR_PNPM_UNEXPECTED_STORE 插件装不了；
 * 2026-08-26 升级：autoFix 自动改写 storeDir + 删 virtualStoreDir，开箱即用）。
 *
 * 背景：用户把 dshs 从 E 盘移到 D 盘后，`profiles/web/node_modules/.modules.yaml`
 * 里记录的 storeDir 是 `E:\.pnpm-store\v11`，但 pnpm 现在默认解析到 `D:\.pnpm-store\v11`，
 * checkCompatibility 拒绝一切 add/remove，插件市场装不了任何插件。
 *
 * 检测：读 .modules.yaml 的 storeDir，与当前盘符对比。漂移 → autoFix 自动改写为
 * 目标机 pnpm 默认 store（盘符相对算法，见 defaultPnpmStorePath）；无法安全修复时
 * 壳启动提示用户目录已迁移 + 修复指引（pnpm install --force 重建，官方语义）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 读 .modules.yaml 的 storeDir；文件缺失/解析失败返回 null。 */
export function readStoreDir(profileDir: string): string | null {
  const modulesYaml = join(profileDir, 'node_modules', '.modules.yaml');
  if (!existsSync(modulesYaml)) return null;
  try {
    // pnpm 写的 .modules.yaml 实际是 JSON 格式（pnpm 内部状态文件）
    const parsed = JSON.parse(readFileSync(modulesYaml, 'utf8')) as { storeDir?: string };
    return typeof parsed.storeDir === 'string' && parsed.storeDir.length > 0 ? parsed.storeDir : null;
  } catch {
    return null;
  }
}

/** 从路径提取盘符（Windows）；非 Windows 或无盘符返回 null。 */
export function driveOf(path: string): string | null {
  const m = /^([A-Za-z]):/.exec(path);
  return m ? m[1].toUpperCase() : null;
}

export interface StoreDriftResult {
  /** 是否漂移（.modules.yaml 的 storeDir 盘符 ≠ 当前盘符） */
  drifted: boolean;
  /** .modules.yaml 记录的 storeDir（可能为 null） */
  oldStore: string | null;
  /** 当前盘符（可能为 null） */
  currentDrive: string | null;
  /** 旧 store 所在盘符（可能为 null） */
  oldDrive: string | null;
}

/**
 * 检测 store 漂移：读 profile 的 .modules.yaml storeDir，与当前盘符对比。
 * 文件缺失/解析失败 → 不漂移（无法判断，不打扰用户）。
 */
export function detectStoreDrift(profileDir: string): StoreDriftResult {
  const oldStore = readStoreDir(profileDir);
  if (oldStore === null) {
    return { drifted: false, oldStore: null, currentDrive: null, oldDrive: null };
  }
  const oldDrive = driveOf(oldStore);
  // 当前盘符必须取 profileDir（= 安装目录）所在盘，不能用 process.cwd()——壳的 cwd
  // 继承自启动它的进程，与安装位置无关（2026-08-25 dshDetected 同款教训，本次 storeDrift 又踩）。
  // 用 cwd 判：用户装 D 盘但 cwd=E 盘时 storeDir(E) 与 cwd(E) 相同 → 误判不漂移 → 不修复 → 插件市场崩。
  const currentDrive = driveOf(profileDir);
  return {
    drifted: oldDrive !== null && currentDrive !== null && oldDrive !== currentDrive,
    oldStore,
    currentDrive,
    oldDrive,
  };
}

/**
 * node_modules 是否含指向"异盘"的链接（pnpm store 链接跨盘才与漂移相关）。
 * 同盘 junction（如 bundled 插件 junction 指向 <安装目录>/dsh/node_modules 实体）
 * 与 pnpm store 无关，不阻止 storeDir 修复（2026-08-26 VM 实测：种子 profile 有
 * 3 个同盘 junction 指向 bundled 插件，删 storeDir 完全安全）。
 * 读不到目录按"有异盘链接"保守处理，不动文件。
 */
export function hasForeignDriveLinks(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  const currentDrive = driveOf(dir);
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    try {
      const target = readlinkSync(join(dir, entry.name));
      const targetDrive = driveOf(target);
      if (targetDrive !== null && currentDrive !== null && targetDrive !== currentDrive) {
        return true; // 链接指向异盘 → pnpm store 跨盘风险，保守不动
      }
    } catch {
      return true; // 读不到目标按保守处理
    }
  }
  return false;
}

/**
 * 升级场景自动修复（2026-08-26）：0.4.8→0.4.9 升级时旧 profile 的 .modules.yaml
 * 记录 storeDir=E:\（打包机盘符），播种因用户数据红线跳过覆盖 → 漂移检测误报 →
 * 弹窗打扰 + 插件市场可能装不了。本函数在"漂移 + 无异盘链接"时把 .modules.yaml
 * 的 storeDir 改写为**目标机 pnpm 默认 store**（盘符相对，见 defaultPnpmStorePath），
 * 消除升级路径误报的同时保证 pnpm 插件市场可安装。
 *
 * 2026-08-26 修复（开箱即用红线）：上一版把 storeDir 字段**删除**，导致全新安装
 * （种子 .modules.yaml 本就带打包机 storeDir，漂移检测改写前）或升级后 pnpm 读到
 * storeDir=undefined → ERR_PNPM_UNEXPECTED_STORE（"linked from the store at undefined"）
 * → 插件市场全部装不了。正确语义是**改写而非删除**：pnpm 依赖 .modules.yaml 的
 * storeDir 与 node_modules 实际来源一致；删字段 = 丢信息，改写 = 保留信息且对齐。
 * 存在指向异盘的链接（用户自装非 hoisted 结构）→ 不动（保留原提示）。
 *
 * 自守卫门控（2026-08-26 对抗评审 P0-2/P0-3）：autoFix 在每次启动都执行（app.ts 播种后
 * 无条件调用），存在多个风险，本函数内自守：
 * - 真漂移门控：只在 .modules.yaml 的 storeDir **盘符 ≠ 安装盘盘符**（detectStoreDrift
 *   drifted）时改写。打包机种子残留、用户迁移目录都带异盘路径 → 命中改写；用户自配
 *   storeDir、用户迁移后重建过、或种子恰与目标机盘符相同 → 不漂移 → 绝不碰 storeDir。
 *   避免覆盖用户合法配置（P0-3：无条件改写会破坏 pnpm config set store-dir 的用户）。
 * - 覆盖用户自定义 store-dir：defaultPnpmStorePath 优先读 config.yaml 显式 storeDir/
 *   store-dir（pnpm 11 写 camelCase storeDir，旧版 kebab-case store-dir 也兼容），
 *   用户自定义即"目标默认"，比对相等 → 不动；只有漂移残留才被改写。
 * - 上次改写后 pnpm 未接受（用户手动重装依赖重建过 .modules.yaml）：改写前留备份
 *   .modules.yaml.dsh-bak；下次启动若备份仍在且 storeDir 已 = 目标默认（用户手动重建
 *   生效）→ 清备份收尾；若仍漂移 → 重试改写（备份不阻断后续修复，避免永久禁修）。
 * 另：漂移改写后同步建 store 目录（P0-1 全新机器该目录不存在，pnpm add 校验失败），
 * virtualStoreDir 一律删除（打包机绝对路径残留，pnpm 会按安装位置自动生成）。
 * @returns true=已自动修复；false=无需修复/无法安全修复
 */
export function autoFixStoreDrift(profileDir: string): boolean {
  const modulesYaml = join(profileDir, 'node_modules', '.modules.yaml');
  if (!existsSync(modulesYaml)) return false;
  const bakPath = `${modulesYaml}.dsh-bak`;
  // 备份已存在：说明上次改写后 pnpm 校验没接受，用户可能手动重建过。
  // 若 storeDir 已 = 目标默认 → 用户重建已生效，清备份收尾；仍漂移 → 继续修。
  if (existsSync(bakPath)) {
    try {
      const rawNow = JSON.parse(readFileSync(modulesYaml, 'utf8')) as { storeDir?: string };
      const targetNow = defaultPnpmStorePath(profileDir);
      if (targetNow && rawNow.storeDir === targetNow) {
        unlinkSync(bakPath); // 已修复，清备份
        return false;
      }
    } catch { /* 读不了就继续修 */ }
  }
  const nmDir = join(profileDir, 'node_modules');
  if (hasForeignDriveLinks(nmDir)) return false; // 有异盘链接 → 保守不动
  try {
    const raw = JSON.parse(readFileSync(modulesYaml, 'utf8')) as { storeDir?: string; virtualStoreDir?: string };
    const drifted = detectStoreDrift(profileDir).drifted;
    // 同盘且无 virtualStoreDir 残留 → 无需任何修复
    if (!drifted && raw.virtualStoreDir === undefined) return false;
    const defaultStore = defaultPnpmStorePath(profileDir);
    if (!defaultStore) return false;
    const storeOk = typeof raw.storeDir === 'string' && raw.storeDir === defaultStore;
    // 漂移且 storeDir 已是目标机默认 → 无需改（可能只是 virtualStoreDir 残留，补删）
    if (storeOk) {
      if (raw.virtualStoreDir !== undefined) {
        delete raw.virtualStoreDir;
        writeFileSync(modulesYaml, JSON.stringify(raw, null, 2), 'utf8');
        return true;
      }
      return false;
    }
    // 不漂移（同盘）但 storeDir ≠ 目标默认 → 用户自配路径，绝不改写；只清理 virtual 残留
    if (!drifted) {
      if (raw.virtualStoreDir !== undefined) {
        delete raw.virtualStoreDir;
        writeFileSync(modulesYaml, JSON.stringify(raw, null, 2), 'utf8');
        return true;
      }
      return false;
    }
    // 备份原文件（用户/上次状态可回退）再改写
    try {
      writeFileSync(`${modulesYaml}.dsh-bak`, readFileSync(modulesYaml, 'utf8'), 'utf8');
    } catch {
      // 备份失败不阻塞改写（只读状态尽量保留）
    }
    raw.storeDir = defaultStore;
    // 同步删 virtualStoreDir：它记录打包机/旧机绝对路径（E:\...\.pnpm），与目标机实际
    // virtual store 不符 → 插件市场校验失败（dshmarket/webui-market 全崩，2026-08-26 实测）。
    // pnpm 会按安装位置自动生成 virtual store，删字段安全。
    delete raw.virtualStoreDir;
    writeFileSync(modulesYaml, JSON.stringify(raw, null, 2), 'utf8');
    // 建 store 目录：全新机器目标盘可能还没有该目录，先建好避免 pnpm 首次 add 因
    // 父目录缺失失败（mkdir recursive 幂等；评审 P0-1：pnpm 校验 storeDir 存在性）。
    try {
      mkdirSync(defaultStore, { recursive: true });
    } catch {
      // 建目录失败不阻断（pnpm 通常能自建；权限问题由 pnpm 报错提示用户）
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 目标机 pnpm 默认 store 路径（复刻 pnpm 源码 storePathRelativeToHome 算法，2026-08-26 读
 * @pnpm/exe dist/pnpm.mjs:182661 确认）。pnpm 默认 store 是"盘符相对"的，不随全局固定：
 * - pnpm home（%LOCALAPPDATA%\pnpm）与 profile 同盘 → store = %LOCALAPPDATA%\pnpm\store\v11
 * - 跨盘 → store = <profile盘>:\.pnpm-store\v11
 * 实测印证：profile 在 E 盘 → E:\.pnpm-store\v11；在 C 盘 → C:\Users\...\AppData\Local\pnpm\store\v11。
 * 实测印证：profile 在 E 盘 → E:\.pnpm-store\v11；在 C 盘 → C:\Users\...\AppData\Local\pnpm\store\v11。
 * 之前"写死 LOCALAPPDATA"只在 C 盘安装时碰巧对，非 C 盘用户改写后 pnpm 校验仍不匹配 → 市场崩
 * （对抗评审 P0-1 实锤）。config.yaml 显式 storeDir/store-dir 时优先用该值（pnpm 读它；实测
 * pnpm 11 `pnpm config set store-dir` 写入 camelCase `storeDir`，旧版本用 kebab-case `store-dir`，
 * 两种都认）。
 * 非 Windows 返回 null（当前只处理 Windows 场景）。
 */
export function defaultPnpmStorePath(profileDir: string): string | null {
  if (process.platform !== 'win32') return null;
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  // 1. 全局 config.yaml 显式 storeDir（pnpm 读 %LOCALAPPDATA%\pnpm\config\config.yaml，
  //    pnpm 11 `pnpm config set store-dir` 写入 camelCase `storeDir`（实测），旧版手写
  //    kebab-case `store-dir` 也兼容——正则两种都要匹配，注意 storeDir 的 D 是大写）
  try {
    const cfg = readFileSync(join(local, 'pnpm', 'config', 'config.yaml'), 'utf8');
    const m = /^\s*(?:storeDir|store-dir)\s*:\s*(.+)$/m.exec(cfg);
    if (m) {
      const dir = m[1].trim().replace(/^["']|["']$/g, '');
      if (dir.length > 0) return dir;
    }
  } catch { /* 无全局配置，走盘符算法 */ }
  // 1b. 用户级 .npmrc（pnpm 读 ~/.npmrc 的 userconfig，键为 kebab-case store-dir；
  //    老 pnpm 用户习惯写这里，评审 P1-2）
  try {
    const userNpmrc = join(homedir(), '.npmrc');
    const npmrc = readFileSync(userNpmrc, 'utf8');
    const nm = /^\s*store-dir\s*=\s*(.+)$/m.exec(npmrc);
    if (nm) {
      const dir = nm[1].trim().replace(/^["']|["']$/g, '');
      if (dir.length > 0) return dir;
    }
  } catch { /* 无 .npmrc，忽略 */ }
  // 2. 复刻 pnpm storePathRelativeToHome：pnpm home（%LOCALAPPDATA%\pnpm）与 profile 同盘 →
  //    %LOCALAPPDATA%\pnpm\store\v11；跨盘 → <profile盘>:\.pnpm-store\v11
  const pnpmHome = join(local, 'pnpm');
  const profileDrive = driveOf(profileDir);
  const pnpmHomeDrive = driveOf(pnpmHome);
  if (profileDrive === null || pnpmHomeDrive === null) return null;
  if (profileDrive === pnpmHomeDrive) {
    return join(pnpmHome, 'store', 'v11');
  }
  return `${profileDrive}:${join('\\', '.pnpm-store', 'v11')}`;
}
