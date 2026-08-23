import { isValidNpmPackageName } from './package-name.js';
/** 两种真机实测的依赖缺失报错风格：ESM/断链报 Cannot find package（2026-08-22 断链样本），
 *  CJS require 报 Cannot find module（2026-08-22 注入样本）。 */
const MODULE_NOT_FOUND = /Cannot find (?:package|module) '([^']+)'/;
const DUPLICATE_ENTRY = /duplicate loader entry id:\s*(\S+)/;
/** cordis 装载插件失败：`failed to apply/import loader entry <id> (<包名>): <原因>`。
 *  覆盖「插件版本与 DSH 不兼容」（如 dsh-mobile 只支持 0.1.0-rc.5/6/7）、插件语法错误等
 *  ——这些崩溃不是「缺包」，缺包规则认不出。 */
const LOADER_ENTRY_FAILED = /failed to (?:apply|import) loader entry \S+ \(([^)]+)\):/;
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
        // Windows 报错路径用 `\` 分隔 scoped 包，捕获组会带进分隔符；归一化为 `/` 再过白名单
        // （白名单仍是防穿越的唯一闸门，归一化不绕过校验）
        const pkg = stripVersionSuffix(m[1] ?? '').replace(/[\\/]+/g, '/');
        if (!isValidNpmPackageName(pkg))
            return { kind: 'fallback-blocker', detail: m[0] };
        return { kind: 'fallback-blocker', repair: { kind: 'remove-fallback-blocker', target: pkg }, detail: m[0] };
    },
};
export const dshDiagnosers = [
    dshModuleNotFoundRule,
    dshDuplicateEntryRule,
    dshBadPatchYamlRule,
    dshFallbackBlockerRule,
    dshLoaderEntryFailedRule,
];
