import { isValidNpmPackageName } from './package-name.js';
/** 两种真机实测的依赖缺失报错风格：ESM/断链报 Cannot find package（2026-08-22 断链样本），
 *  CJS require 报 Cannot find module（2026-08-22 注入样本）。 */
const MODULE_NOT_FOUND = /Cannot find (?:package|module) '([^']+)'/;
const DUPLICATE_ENTRY = /duplicate loader entry id:\s*(\S+)/;
/** cordis 装载插件失败：`failed to apply/import loader entry <id> (<包名>): <原因>`。
 *  覆盖「插件版本与 DSH 不兼容」（如 dsh-mobile 只支持 0.1.0-rc.5/6/7）、插件语法错误等
 *  ——这些崩溃不是「缺包」，缺包规则认不出。
 *  [2026-08-27 自救缺陷修复 G2] 补 dispose/rollback 变体——loader 在 dispose/rollback
 *  阶段失败同样会崩（`failed to dispose loader entry` / `failed to rollback loader entry`），
 *  原正则只认 apply/import 会漏。 */
const LOADER_ENTRY_FAILED = /failed to (?:apply|import|dispose|rollback) loader entry \S+ \(([^)]+)\):/;
/** [2026-08-27 自救缺陷修复 G1] webserver 重复路由（聚合包 × 独立包双挂载的标准崩溃，
 *  如 dsh-web-ui-all 挂 dsh-better-sidebar 与顶层 bundle 双挂 → 各自注册 /sidebar/api）。
 *  报错形态：`failed to apply loader entry <id> (<包名>): webserver: duplicate prefix route "/sidebar/api"`
 *  或裸 `webserver: duplicate <exact|prefix|upgrade> route "<path>"` / `webserver: fallback already registered`。
 *  归因：优先从 loader entry 的 (<包名>) 提取（双挂的独立包）；提取不到则从 knownPlugins 里
 *  找「注册了该路由的插件」——stderr 无包名时无法精确归因，交给决策层（无 suspect 不处置）。 */
const DUPLICATE_ROUTE = /webserver: duplicate (?:exact|prefix|upgrade) route "([^"]+)"|webserver: fallback already registered/i;
const LOADER_ENTRY_PKG = /failed to (?:apply|import|dispose|rollback) loader entry \S+ \(([^)]+)\):/;
/** [2026-08-27 自救缺陷修复 G3] 服务依赖悬空（inject 依赖缺失的最终形态，聚合包子插件
 *  依赖父服务时高发）：`<bin>: <N> entries did not activate` + `pending (waiting for service: <name>)`。
 *  归因：从 pending 行提取 entry 包名（`<id> (<包名>): pending (waiting for service: ...)`）。 */
const PENDING_SERVICE = /(\d+) entries? did not activate[\s\S]{0,2000}?pending \(waiting for service: ([^)]+)\)/i;
const PENDING_ENTRY_PKG = /([A-Za-z0-9._-]+) \(([^)]+)\):\s*pending \(waiting for service:/i;
/** [2026-08-27 自救缺陷修复 G5] patch/overlay 校验类 throw（坏 YAML 规则的近亲）：
 *  `must be a top-level YAML array of loader patch entries` / `entry N must be a mapping` /
 *  `failed to read overlay` / `config file must be a top-level array`。归入坏 YAML repair。 */
const PATCH_VALIDATION = /(?:must be a top-level YAML array of loader patch entries|entry \d+ must be a mapping|failed to read (?:overlay|patch)|config file must be a top-level array)/i;
/** [2026-08-27 自救缺陷修复 G6] 浏览器端 client 双执行（与后端双挂载同源）：
 *  `client-modules: duplicate graph entry "<id>"` / `duplicate factory registration for "<id>"`。
 *  归因：从 URL/包名提取（`/plugins/<包名>/client.js` 或 entry id 映射）。 */
const CLIENT_DUPLICATE = /client-modules: duplicate (?:graph entry|factory registration)(?: for)? "([^"]+)"/i;
/** 剥包名可能的 @version 尾巴；@scope/name（scope @ 在下标 0）不受影响。 */
function stripVersionSuffix(raw) {
    const at = raw.lastIndexOf('@');
    return at > 0 ? raw.slice(0, at) : raw;
}
function matchKnown(known, name) {
    return known.find((p) => p.packageName === name || p.id === name);
}
/** 从 "imported from ...node_modules/<插件目录>/..." 提取引用者插件名
 *  （依赖缺失场景：缺失的是普通依赖，肇事的是引用它的插件——2026-08-22 注入实测）。 */
const IMPORTED_FROM = /imported from [^\n]*?node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/;
/** DSH 0.1.1-rc.2：依赖缺失崩溃。两种归因（2026-08-22 两类真机样本）：
 *  a) 缺失的包本身是注册插件（junction 断链）→ 隔离该插件；
 *  b) 缺失的是普通依赖 → 从 imported from 归因到引用者插件并隔离引用者；
 *  c) 都归因不到 → 无 suspect，不处置（隔离一个不存在的包是空操作，白烧预算）。
 *  stderr 是外部可控输入：提取的包名不合法（路径穿越/伪造）同样不产 suspect。 */
export const dshModuleNotFoundRule = {
    name: 'dsh-module-not-found',
    diagnose(crash) {
        const m = MODULE_NOT_FOUND.exec(crash.stderr);
        if (!m)
            return null;
        const pkg = stripVersionSuffix(m[1] ?? '');
        if (!isValidNpmPackageName(pkg))
            return { kind: 'module-not-found', detail: m[0] };
        const missingHit = matchKnown(crash.knownPlugins, pkg);
        if (missingHit)
            return { kind: 'module-not-found', suspect: missingHit, detail: m[0] };
        const from = IMPORTED_FROM.exec(crash.stderr);
        if (from) {
            const importer = stripVersionSuffix(from[1] ?? '');
            if (isValidNpmPackageName(importer)) {
                const importerHit = matchKnown(crash.knownPlugins, importer);
                if (importerHit)
                    return { kind: 'module-not-found', suspect: importerHit, detail: m[0] };
            }
        }
        return { kind: 'module-not-found', detail: m[0] };
    },
};
/** DSH 0.1.1-rc.2：loader entry id 冲突（patch insert 与 bundle 双挂，如 modlens 既在
 *  dsh.profile.bundles 又在 cordis.patch.yml insert）。
 *  处置语义（2026-08-23 真机教训）：这是配置错误，正确动作是**修复**（清掉重复 insert 块），
 *  不是隔离（隔离会把没坏的插件实体整个删掉，方向反了）。因此诊断始终带 repair 请求：
 *  - 规则侧：id 映射到已知插件（id 或 packageName 两路）；映射不到（第三方）
 *    也照样给 repair——清 insert 块不依赖 suspect；
 *  - 引擎侧：隔离器提供 repair 通道时优先走 repair（不烧隔离预算、不锁会话）。 */
export const dshDuplicateEntryRule = {
    name: 'dsh-duplicate-entry',
    diagnose(crash) {
        const m = DUPLICATE_ENTRY.exec(crash.stderr);
        if (!m)
            return null;
        const rowId = (m[1] ?? '').trim();
        const suspect = matchKnown(crash.knownPlugins, rowId);
        const repair = { kind: 'drop-duplicate-insert', target: rowId };
        return suspect
            ? { kind: 'duplicate-entry', suspect, repair, detail: m[0] }
            : { kind: 'duplicate-entry', repair, detail: m[0] };
    },
};
/** DSH 0.1.1-rc.2：cordis 装载插件失败（版本不兼容/语法错误等）。
 *  从 `loader entry <id> (<包名>):` 提取包名；包名不合法（stderr 可注入/路径穿越）或不在已知清单
 *  → 无 suspect，不处置（隔离一个不存在的包是空操作，白烧预算）。 */
export const dshLoaderEntryFailedRule = {
    name: 'dsh-loader-entry-failed',
    diagnose(crash) {
        const m = LOADER_ENTRY_FAILED.exec(crash.stderr);
        if (!m)
            return null;
        const pkg = stripVersionSuffix(m[1] ?? '');
        if (!isValidNpmPackageName(pkg))
            return { kind: 'loader-entry-failed', detail: m[0] };
        const hit = matchKnown(crash.knownPlugins, pkg);
        return hit
            ? { kind: 'loader-entry-failed', suspect: hit, detail: m[0] }
            : { kind: 'loader-entry-failed', detail: m[0] };
    },
};
/** 浏览器端 client bundle 加载失败（2026-08-25 真机样本：dsh-session-log-export）。
 *  dsh-client-modules 加载 bundle script 失败时报 `client-modules: bundle script <url> failed to load`，
 *  URL 形如 /plugins/<包名>/client.js（真机样本为 `client-modules:bundlescript/plugins/.../client.jsrev-<hash> failed to load`，
 *  bundlescript 连写、client.js 后直接跟 rev 哈希）。从 URL 提取包名归因；包名不合法或不在已知清单 → 无 suspect。
 *  处置语义与 loader-entry-failed 一致：隔离肇事插件（浏览器端 bundle 坏 = 插件实体问题）。 */
const CLIENT_BUNDLE_FAILED = /client-modules:\s*bundlescript\s*\/plugins\/((?:@[^\/]+\/)?[^\/]+)\/client\.js[^\n]*failed to load/i;
export const dshClientBundleFailedRule = {
    name: 'dsh-client-bundle-failed',
    diagnose(crash) {
        const m = CLIENT_BUNDLE_FAILED.exec(crash.stderr);
        if (!m)
            return null;
        const pkg = stripVersionSuffix(m[1] ?? '');
        if (!isValidNpmPackageName(pkg))
            return { kind: 'client-bundle-failed', detail: m[0] };
        const hit = matchKnown(crash.knownPlugins, pkg);
        return hit
            ? { kind: 'client-bundle-failed', suspect: hit, detail: m[0] }
            : { kind: 'client-bundle-failed', detail: m[0] };
    },
};
/** 坏 YAML（cordis.patch.yml 解析失败，如 2026-08-23 真机 `name: [unclosed` 注入）。
 *  处置 = 恢复写前备份（repair restore-patch-yaml），不隔离不烧预算。
 *  必须排在 dshLoaderEntryFailedRule 之前——YAML 崩先于 loader 命中，否则 loader 规则
 *  把 `cordis:include` 当非法包名吞掉，坏 YAML 永远恢复不了（子代理缺口分析 §5.2）。 */
// 对抗审查 I1 修复：`[^\n]*?` 不跨行会漏掉「failed to parse overlay <path>:\nYAMLException」的
// 真实多行 stderr（错误原因行在第二行）；改跨行限长匹配（0-500 字符内找原因行）
const BAD_PATCH_YAML = /failed to parse (?:overlay|patch)[\s\S]{0,500}?(?:YAMLException|YAML error|bad indentation|invalid yaml|unexpected end of the stream)/i;
export const dshBadPatchYamlRule = {
    name: 'dsh-bad-patch-yaml',
    diagnose(crash) {
        const m = BAD_PATCH_YAML.exec(crash.stderr);
        if (!m)
            return null;
        return { kind: 'bad-patch-yaml', repair: { kind: 'restore-patch-yaml', target: '' }, detail: m[0] };
    },
};
/** profiles 安装回退目录被真实目录挡住（`exists and is not a symlink; remove it so dsh can manage ...`）。
 *  目标在 profiles/node_modules 下（fallback 目录），从 stderr 提取包名作 repair target。
 *  处置 = 修复（remove-fallback-blocker：移走非 symlink 目录让 DSH 重建链接）——目标是
 *  @deepseek-ai/ 官方包，隔离器明确禁止隔离官方包，必须走 repair（子代理缺口分析 A003）。 */
// 对抗审查 I2 修复：锚定 `profiles[\\/]node_modules` 前缀——repair 目标固定在
// dshHome/profiles/node_modules/<pkg>，runtime 或其他 profile 的「not a symlink」提示不应误触发
const FALLBACK_BLOCKER = /profiles[\\/]node_modules[\\/]((?:@[^\\/\s]+[\\/])?[^\\/\s]+?)\s+exists and is not a symlink; remove it so [^\n]*?can manage(?: the)? installation fallback/i;
export const dshFallbackBlockerRule = {
    name: 'dsh-fallback-blocker',
    diagnose(crash) {
        const m = FALLBACK_BLOCKER.exec(crash.stderr);
        if (!m)
            return null;
        // 2026-08-23 升级实测教训：DSH 0.1.1-rc.2 的 healProfilesModuleFallback 对整个依赖闭包
        // BFS 校验，一次只报第一个实体目录 → 逐个 remove-fallback-blocker 修不完（250 个实体
        // vs 3 次预算）。一律给整目录修复（purge-fallback-blockers：一次清空全部非 symlink
        // 实体让 DSH 重建闭包）；单包修复保留给白名单外的兼容场景（实际不再产出）。
        const pkg = stripVersionSuffix(m[1] ?? '').replace(/[\\/]+/g, '/');
        if (!isValidNpmPackageName(pkg))
            return { kind: 'fallback-blocker', detail: m[0] };
        return { kind: 'fallback-blocker', repair: { kind: 'purge-fallback-blockers', target: '' }, detail: m[0] };
    },
};
/** [2026-08-27 自救缺陷修复 G1] webserver 重复路由（聚合包 × 独立包双挂载）。
 *  归因：优先从 loader entry 的 (<包名>) 提取（双挂的独立包）；提取不到 → 无 suspect
 *  （stderr 无包名无法精确归因，不处置白烧预算）。处置 = repair reorder-bundles
 *  （把聚合包移到被挂包之前，让被挂包自带的防双挂载守卫生效）——比隔离更优：
 *  隔离会把没坏的插件实体整个删掉，方向反了。 */
export const dshDuplicateRouteRule = {
    name: 'dsh-duplicate-route',
    diagnose(crash) {
        const m = DUPLICATE_ROUTE.exec(crash.stderr);
        if (!m)
            return null;
        const entry = LOADER_ENTRY_PKG.exec(crash.stderr);
        if (entry) {
            const pkg = stripVersionSuffix(entry[1] ?? '');
            if (isValidNpmPackageName(pkg)) {
                const hit = matchKnown(crash.knownPlugins, pkg);
                if (hit) {
                    // 双挂的独立包 → repair 重排（聚合包移到它之前）；repair 失败才考虑隔离
                    return {
                        kind: 'duplicate-route',
                        suspect: hit,
                        repair: { kind: 'reorder-bundles', target: pkg },
                        detail: m[0],
                    };
                }
            }
        }
        return { kind: 'duplicate-route', detail: m[0] };
    },
};
/** [2026-08-27 自救缺陷修复 G3] 服务依赖悬空（inject 缺失）。
 *  归因：从 pending 行提取 entry 包名；包名不合法或不在已知清单 → 无 suspect。 */
export const dshPendingServiceRule = {
    name: 'dsh-pending-service',
    diagnose(crash) {
        const m = PENDING_SERVICE.exec(crash.stderr);
        if (!m)
            return null;
        const entry = PENDING_ENTRY_PKG.exec(crash.stderr);
        if (entry) {
            const pkg = stripVersionSuffix(entry[2] ?? '');
            if (isValidNpmPackageName(pkg)) {
                const hit = matchKnown(crash.knownPlugins, pkg);
                if (hit)
                    return { kind: 'pending-service', suspect: hit, detail: m[0] };
            }
        }
        return { kind: 'pending-service', detail: m[0] };
    },
};
/** [2026-08-27 自救缺陷修复 G5] patch/overlay 校验类 throw → 归入坏 YAML repair。 */
export const dshPatchValidationRule = {
    name: 'dsh-patch-validation',
    diagnose(crash) {
        const m = PATCH_VALIDATION.exec(crash.stderr);
        if (!m)
            return null;
        return { kind: 'bad-patch-yaml', repair: { kind: 'restore-patch-yaml', target: '' }, detail: m[0] };
    },
};
/** [2026-08-27 自救缺陷修复 G6] 浏览器端 client 双执行 → 归因到包名并隔离。 */
export const dshClientDuplicateRule = {
    name: 'dsh-client-duplicate',
    diagnose(crash) {
        const m = CLIENT_DUPLICATE.exec(crash.stderr);
        if (!m)
            return null;
        const id = (m[1] ?? '').trim();
        const hit = matchKnown(crash.knownPlugins, id);
        return hit
            ? { kind: 'client-duplicate', suspect: hit, detail: m[0] }
            : { kind: 'client-duplicate', detail: m[0] };
    },
};
export const dshDiagnosers = [
    dshModuleNotFoundRule,
    dshDuplicateEntryRule,
    dshBadPatchYamlRule,
    dshPatchValidationRule,
    dshFallbackBlockerRule,
    dshLoaderEntryFailedRule,
    dshClientBundleFailedRule,
    dshDuplicateRouteRule,
    dshPendingServiceRule,
    dshClientDuplicateRule,
];
