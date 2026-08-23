/**
 * stderr 热路径扫描（缺口 2：热挂载失败 + client-modules 未注册 + loader entry 失败）。
 * 服务活着但单插件挂不上的三类日志特征，统一归因到插件包名（供壳自动隔离）。
 * 纯函数（无 io），stderr 行是外部可控输入 → 提取的包名必须过白名单，防路径穿越进隔离器。
 * 白名单复用独立库 vendor-rescue 的 isValidNpmPackageName（单一来源，防漂移——审查 M3）。
 */
import { isValidNpmPackageName } from '../vendor-rescue/dsh/package-name.js';

/** 剥 `@scope/name/client` 的 `/client` 模块后缀；@scope 的 @ 在下标 0 不受影响 */
function stripClientSuffix(spec: string): string {
  return spec.endsWith('/client') ? spec.slice(0, -7) : spec;
}

/**
 * 扫描一行 stderr，命中热路径故障特征则归因插件包名。
 * 三形态（顺序敏感）：
 * 1. `hot mount of <pkg> failed` —— 壳原有形态（热挂载失败）。
 * 2. `loaded without registering "<id>" via __ModuleLoader__.load` —— client-modules
 *    模块装载后未注册（缺口 2 新形态）。id 是模块 spec，可能带 `/client` 后缀；
 *    剥后缀后过包名白名单，合法才归因（runtime/cordis 这类非包名模块 id 不误伤）。
 * 3. 嵌套形态 `failed to apply loader entry <entry> (<pkg>): failed to import ...`
 *    —— 外层可能是 `cordis:include` 这类冒号模块，内层才是权威包名。
 *    审查 C2：取**最后一个**过白名单的 (pkg) 组（内层最权威），而非只取第一个。
 * 所有形态统一：先剥 `@version` 尾巴（`dsh-a@1.0.0` → `dsh-a`）再过白名单。
 */
export function scanHotMountLine(line: string): { packageName: string } | null {
  if (!line) return null;
  // 形态 3 优先：收集所有 loader entry 的 (pkg) 组，从后往前取第一个过白名单者
  let packageName: string | null = null;
  for (const m of line.matchAll(/failed to (?:apply|import) loader entry \S+ \(([^)]+)\)/g)) {
    const pkg = stripVersion(m[1]);
    if (isValidNpmPackageName(pkg) && !isFileName(pkg)) packageName = pkg;
  }
  if (packageName) return { packageName };
  // 形态 2：client-modules 未注册
  const unregistered = /loaded without registering "([^"]+)" via __ModuleLoader__\.load/.exec(line);
  if (unregistered) {
    const pkg = stripVersion(stripClientSuffix(unregistered[1]));
    if (isValidNpmPackageName(pkg) && !isFileName(pkg)) return { packageName: pkg };
  }
  // 形态 1：热挂载失败（包名可能带 @version 尾巴，捕获组需包含版本段再统一剥离）
  const hot = /hot mount of ([@\w][\w.-]*(?:\/[\w.-]+)?(?:@[^\s]+)?) failed/.exec(line);
  if (hot) {
    const pkg = stripVersion(hot[1]);
    if (isValidNpmPackageName(pkg) && !isFileName(pkg)) return { packageName: pkg };
  }
  return null;
}

/** 剥包名可能的 @version 尾巴；@scope/name 的 @ 在下标 0 不受影响 */
function stripVersion(raw: string): string {
  const at = raw.lastIndexOf('@');
  return at > 0 ? raw.slice(0, at) : raw;
}

/** 文件名形态（entry.js/main.cjs 等 loader 入口）不归因——它不是包名（审查 M1） */
function isFileName(name: string): boolean {
  return /\.(?:js|cjs|mjs)$/.test(name);
}
