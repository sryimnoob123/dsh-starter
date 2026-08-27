import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isValidNpmPackageName } from './package-name.js';
/** 官方组件不属于插件自救范畴，永不隔离。 */
const PROTECTED_PREFIX = '@deepseek-ai/';
/** The empty user patch layer DSH expects at `profiles/<name>/cordis.patch.yml`.
 *  清块后只剩注释/空白时必须写回含 `[]` 的模板——注释-only 的空 YAML 文档
 *  会被 DSH 判为非法 patch 顶层而崩溃（2026-08-22 真机教训）。 */
const PROFILE_PATCH_TEMPLATE = [
    '# Your patch layer for this dsh profile, applied after every bundle layer:',
    '# a top-level YAML array of loader patch entries (id-targeted config',
    '# overrides, disables, and insert lists; `!!js` expressions allowed).',
    '[]',
    '',
].join('\n');
/**
 * 包在 node_modules 下的真实目录：带 scope（@dsh-desktop/x）→ node_modules/@dsh-desktop/x；
 * 无 scope（如 dshmarket）→ node_modules/name。
 */
function packageNodeModulesDir(root, packageName) {
    const slash = packageName.indexOf('/');
    return slash === -1
        ? join(root, 'node_modules', packageName)
        : join(root, 'node_modules', packageName.slice(0, slash), packageName.slice(slash + 1));
}
/** 断言 target 解析后确实位于 root 之内（防路径穿越的第二道闸，包名白名单之外的双保险）。 */
function isInside(root, target) {
    const rel = relative(resolve(root), resolve(target));
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
function readProfileManifest(dir) {
    const path = join(dir, 'package.json');
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
/**
 * DSH 插件隔离器：把肇事插件从运行环境彻底摘除（manifest bundles 移除 +
 * profile 链接删除 + patch 手写块清理 + runtime 实体删除）。幂等。
 * 移植自壳内 bundledDshPlugins.ts 的 isolatePlugin（2026-08-22 真机验证版），
 * 公开库新增：包名白名单 + 路径Containment 双闸（stderr 是外部可控输入）、
 * 文件系统异常一律收敛为 ok:false（自救不得反向伤害宿主）。
 *
 * 隔离 = 移走不是删除（2026-08-23 用户拍板）：删除任何东西之前先把实体与配置
 * 原文备份到 backupRoot/<packageName>/，restore 通道按备份原样装回。
 */
export function createDshIsolator(options) {
    const profileName = options.profile ?? 'web';
    const backupRoot = options.backupRoot ?? join(options.dshHome, '.rescue-backups');
    /** 备份目录：包名已过白名单（单段或 @scope/name，无路径段），再叠 isInside 双保险。 */
    function backupDirFor(packageName) {
        return join(backupRoot, packageName);
    }
    /** 备份目录不得位于隔离的递归删除面（profile/runtime 的 node_modules）之内——否则隔离会连备份一起删。 */
    function backupRootSafe() {
        const profileNm = join(options.dshHome, 'profiles', profileName, 'node_modules');
        const runtimeNm = join(options.dshRuntimeRoot, 'node_modules');
        return !isInside(profileNm, backupRoot) && !isInside(runtimeNm, backupRoot);
    }
    /**
     * 写 patch 前备份（2026-08-23 用户拍板：坏 YAML 自动回退）：
     * 每次改写 cordis.patch.yml 前，把当前内容备份到同目录 cordis.patch.yml.bak（覆盖式）。
     * 壳在启动崩溃检测到 YAML 解析失败时，用这份备份自动恢复——插件问题导致的坏 YAML 全自动活过来。
     * 幂等：无 patch 文件时跳过；备份失败不阻断写（写坏由回退兜底）。
     */
    function backupPatchBeforeWrite(profileDir) {
        try {
            const patchPath = join(profileDir, 'cordis.patch.yml');
            if (!existsSync(patchPath))
                return;
            writeFileSync(join(profileDir, 'cordis.patch.yml.bak'), readFileSync(patchPath, 'utf8'), 'utf8');
        }
        catch {
            // 备份失败不阻断写（写坏由回退兜底）
        }
    }
    /** 先备份后隔离：把实体与配置原文落到 backupDir，返回 false 表示备份失败（隔离必须放弃）。 */
    function backupBeforeIsolate(packageName, profileDir) {
        try {
            const backupDir = backupDirFor(packageName);
            if (existsSync(join(backupDir, 'meta.json')))
                return true; // 同包二次隔离：复用首次备份
            mkdirSync(backupDir, { recursive: true });
            const runtimeDir = packageNodeModulesDir(options.dshRuntimeRoot, packageName);
            const runtimeExists = existsSync(runtimeDir);
            if (runtimeExists) {
                mkdirSync(join(backupDir, 'runtime'), { recursive: true });
                cpSync(runtimeDir, join(backupDir, 'runtime', packageName), { recursive: true });
            }
            const profilePackage = packageNodeModulesDir(profileDir, packageName);
            const profileExists = existsSync(profilePackage);
            const profileShape = profileExists && lstatSync(profilePackage).isSymbolicLink() ? 'junction' : 'real';
            const profileRealExists = profileExists && profileShape === 'real';
            if (profileRealExists) {
                mkdirSync(join(backupDir, 'profile-real'), { recursive: true });
                cpSync(profilePackage, join(backupDir, 'profile-real', packageName), { recursive: true });
            }
            const manifestPath = join(profileDir, 'package.json');
            const manifestExisted = existsSync(manifestPath);
            const patchPath = join(profileDir, 'cordis.patch.yml');
            const patchExisted = existsSync(patchPath);
            const meta = {
                version: 1,
                packageName,
                isolatedAt: Date.now(),
                profileShape,
                runtime: { exists: runtimeExists },
                profileReal: { exists: profileRealExists },
                manifest: { existed: manifestExisted, originalText: manifestExisted ? readFileSync(manifestPath, 'utf8') : undefined },
                patch: { existed: patchExisted, originalText: patchExisted ? readFileSync(patchPath, 'utf8') : undefined },
            };
            writeFileSync(join(backupDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
            return true;
        }
        catch {
            return false;
        }
    }
    return {
        isolate(plugin) {
            const packageName = plugin.packageName ?? plugin.id;
            // 第一道闸：stderr 提取的"包名"必须形如合法 npm 包名，杜绝 ../ 与多余路径段
            if (!isValidNpmPackageName(packageName)) {
                return { ok: false, detail: `invalid package name: ${packageName}` };
            }
            if (packageName.startsWith(PROTECTED_PREFIX)) {
                return { ok: false, detail: `protected package: ${packageName}` };
            }
            const profileDir = join(options.dshHome, 'profiles', profileName);
            try {
                // 备份目录安全断言：backupRoot 不得位于隔离的递归删除面之内（配置失误防自删）
                if (!backupRootSafe()) {
                    return { ok: false, detail: `backupRoot inside deletion surface: ${backupRoot}` };
                }
                // 先备份后隔离：备份失败（盘满/权限）→ 放弃隔离，绝不"删了却备份失败"
                if (!backupBeforeIsolate(packageName, profileDir)) {
                    return { ok: false, detail: `backup failed for ${packageName}, isolation aborted` };
                }
                let changed = false;
                // 1) manifest：dsh.profile.bundles 移除该包 + dependencies 移除该包（文件不存在/无该包则跳过）
                //    [2026-08-27 自救缺陷修复] 只摘 bundles 不摘 dependencies 会让重启后 loader 仍按
                //    dependencies 找包 → module-not-found 继续崩 → 反复隔离/重启死循环（v0.5.0 用户
                //    装 dsh-web-ui-all 崩溃后实测）。dependencies 摘除后 pnpm 状态文件（.modules.yaml/
                //    lockfile）仍记录该包，但 loader 只按 manifest 的 bundles+dependencies 引用——
                //    摘除后不再引用，崩溃即止。restore 按 meta.manifest.originalText 原样写回（含
                //    dependencies），恢复完整。
                const manifest = readProfileManifest(profileDir);
                if (manifest) {
                    const profileObj = (manifest.dsh ?? {});
                    const profile = (profileObj.profile ?? {});
                    const bundles = Array.isArray(profile.bundles) ? profile.bundles : [];
                    const deps = (manifest.dependencies ?? {});
                    const bundlesChanged = bundles.includes(packageName);
                    const depsChanged = Object.prototype.hasOwnProperty.call(deps, packageName);
                    if (bundlesChanged || depsChanged) {
                        const nextDeps = { ...deps };
                        if (depsChanged)
                            delete nextDeps[packageName];
                        writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
                            ...manifest,
                            dependencies: nextDeps,
                            dsh: { ...profileObj, profile: { ...profile, bundles: bundles.filter((n) => n !== packageName) } },
                        }, null, 2) + '\n', 'utf8');
                        changed = true;
                    }
                }
                // 2) profile node_modules 里的插件路径：可能是 pnpm 的 junction 链接（指向 runtime 实体），
                //    也可能是市场/手动安装时落下的真实目录。链接只删链接本身、绝不递归（Windows junction
                //    递归会穿透删掉 runtime 里的实体）；真实目录递归删整棵（它是独立拷贝，删了才彻底）。
                const profilePackage = packageNodeModulesDir(profileDir, packageName);
                if (!isInside(options.dshHome, profilePackage)) {
                    return { ok: false, detail: `path escapes dshHome: ${profilePackage}` };
                }
                if (existsSync(profilePackage)) {
                    if (lstatSync(profilePackage).isSymbolicLink()) {
                        try {
                            unlinkSync(profilePackage);
                            changed = true;
                        }
                        catch (e) {
                            // 链接删除失败（EPERM/EBUSY）不得静默——残留会让下次启动继续崩，必须让宿主知道隔离未彻底
                            throw e;
                        }
                    }
                    else {
                        rmSync(profilePackage, { recursive: true, force: true });
                        changed = true;
                    }
                }
                // 3) patch 手写 insert 块清理（顶层条目分块，name 行匹配包名即整块移除）——
                //    否则条目仍引用已删除的包，下一轮启动变成 module-not-found 继续崩
                const patchPath = join(profileDir, 'cordis.patch.yml');
                if (existsSync(patchPath)) {
                    const text = readFileSync(patchPath, 'utf8');
                    const blocks = text.split(/\n(?=- )/);
                    const kept = blocks.filter((b) => !new RegExp(`name:\\s*['"]?${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm').test(b));
                    if (kept.length !== blocks.length) {
                        backupPatchBeforeWrite(profileDir);
                        const hasContent = kept.join('').replace(/#[^\n]*/g, '').trim().length > 0;
                        writeFileSync(patchPath, hasContent ? kept.join('\n') : PROFILE_PATCH_TEMPLATE, 'utf8');
                        changed = true;
                    }
                }
                // 4) DSH runtime node_modules 里的插件实体删除
                const target = packageNodeModulesDir(options.dshRuntimeRoot, packageName);
                if (!isInside(options.dshRuntimeRoot, target)) {
                    return { ok: false, detail: `path escapes dshRuntimeRoot: ${target}` };
                }
                if (existsSync(target)) {
                    rmSync(target, { recursive: true, force: true });
                    changed = true;
                }
                return { ok: true, detail: changed ? 'isolated' : 'already-clean' };
            }
            catch (error) {
                // 文件系统异常（EBUSY/EPERM/盘满…）收敛为失败结果：自救机制自己出错
                // 不能反向带崩宿主进程
                return { ok: false, detail: String(error) };
            }
        },
        /**
         * 修复通道（2026-08-23 真机教训：patch 双挂崩溃的正确处置是修复配置，不是删插件）：
         * 支持 kind='drop-duplicate-insert'——把 profile patch 里该 entry id 的 insert 块删除
         * （bundles 里的插件靠 bundle 机制加载，重复 insert 是纯冗余，删了不丢功能）。
         * 幂等：无该 insert 块时原样返回。target 是 entry id（非路径，无穿越面）。
         */
        repair(request) {
            const profileDir = join(options.dshHome, 'profiles', profileName);
            const patchPath = join(profileDir, 'cordis.patch.yml');
            try {
                // [坏 YAML] 恢复写前备份（restore-patch-yaml）：读 .bak → 净化（剔除已隔离插件
                // insert 块，防 module-not-found 连环崩）→ 写回。无备份 → 失败（壳回落 give-up）。
                if (request.kind === 'restore-patch-yaml') {
                    const bakPath = `${patchPath}.bak`;
                    if (!existsSync(bakPath))
                        return { ok: false, detail: 'no patch backup to restore' };
                    const bakText = readFileSync(bakPath, 'utf8');
                    const sanitized = sanitizePatchForRestore({ dshHome: options.dshHome, dshRuntimeRoot: options.dshRuntimeRoot, profile: profileName }, bakText);
                    writeFileSync(patchPath, sanitized ?? bakText, 'utf8');
                    return { ok: true, detail: 'restored patch from backup' };
                }
                // [安装回退被挡·整目录形态] purge-fallback-blockers：profiles/node_modules 下
                // 存在多个非 symlink 实体目录（DSH 0.1.1-rc.2 要求整个 fallback 目录是 symlink 闭包，
                // healProfilesModuleFallback BFS 校验整个依赖闭包，一次只报第一个实体 → 逐个
                // remove-fallback-blocker 修不完 250 个实体、3 次预算就耗尽）。一次性把全部
                // 非 symlink 实体移入 backupRoot（移走不删除），DSH 重启重建整个闭包。
                if (request.kind === 'purge-fallback-blockers') {
                    const fallbackDir = join(options.dshHome, 'profiles', 'node_modules');
                    if (!isInside(options.dshHome, fallbackDir)) {
                        return { ok: false, detail: `path escapes dshHome: ${fallbackDir}` };
                    }
                    if (!existsSync(fallbackDir))
                        return { ok: true, detail: 'already-clean' };
                    // 遍历顶层条目：symlink 保留；实体目录整体移入 backupRoot/fallback-<名>。
                    // 顶层文件（如 .pnpm 锁文件残留）不处置——只移目录，避免误删无关文件。
                    let moved = 0;
                    let failed = 0;
                    for (const name of readdirSync(fallbackDir)) {
                        const entry = join(fallbackDir, name);
                        let isLink = false;
                        try {
                            isLink = lstatSync(entry).isSymbolicLink();
                        }
                        catch {
                            continue;
                        }
                        if (isLink)
                            continue;
                        if (!lstatSync(entry).isDirectory())
                            continue;
                        // [安全审查 P3] 备份目标与 remove-fallback-blocker 对齐：目录名拼进备份路径前
                        // 先过 isInside 校验（防异常目录名把备份移出 backupRoot；Windows 目录名不可含
                        // 分隔符，此为纵深防御一致性）
                        const backupDir = backupDirFor(`fallback-${name}`);
                        if (!isInside(backupRoot, backupDir)) {
                            failed += 1;
                            continue;
                        }
                        if (existsSync(backupDir))
                            rmSync(backupDir, { recursive: true, force: true });
                        mkdirSync(backupDir, { recursive: true });
                        try {
                            renameSync(entry, backupDir);
                            moved += 1;
                        }
                        catch {
                            try {
                                cpSync(entry, backupDir, { recursive: true });
                                rmSync(entry, { recursive: true, force: true });
                                moved += 1;
                            }
                            catch {
                                failed += 1;
                            }
                        }
                    }
                    if (failed > 0)
                        return { ok: false, detail: `purged ${moved}, failed ${failed}` };
                    if (moved === 0)
                        return { ok: true, detail: 'already-clean' };
                    return { ok: true, detail: `moved ${moved} non-symlink dirs to backup` };
                }
                // [安装回退被挡] 移走非 symlink 目录（remove-fallback-blocker）：目标在
                // profiles/node_modules 下（fallback 目录）且是真实目录（非链接）→ 移入 backupRoot
                // （移走不删除，与 restore 语义对齐；DSH 重启会重建 symlink）。
                if (request.kind === 'remove-fallback-blocker') {
                    // [安全闸] 对抗审查 C2 修复：target 是路径型（拼进 filesystem 操作），必须过
                    // 包名白名单（与 isolate/restore 同闸，防穿越删任意文件）。
                    // 注意：这里不挡官方包——fallback-blocker 的修复目标正是官方包的非 symlink
                    // 错误安装形态（隔离器禁隔离官方插件 ≠ 禁修官方包安装回退目录）。
                    if (!isValidNpmPackageName(request.target)) {
                        return { ok: false, detail: `invalid package name: ${request.target}` };
                    }
                    const target = join(options.dshHome, 'profiles', 'node_modules', request.target);
                    if (!isInside(options.dshHome, target)) {
                        return { ok: false, detail: `path escapes dshHome: ${target}` };
                    }
                    if (!existsSync(target))
                        return { ok: true, detail: 'already-clean' };
                    if (lstatSync(target).isSymbolicLink())
                        return { ok: true, detail: 'is symlink, nothing to remove' };
                    // 2026-08-23 对抗审查 C1 修复：先整体移入 backupRoot（移走不删除），
                    // 与 isolate/restore 通道的「先备份后处置」语义对齐；移走失败则放弃处置。
                    const backupDir = backupDirFor(`fallback-${request.target}`);
                    if (existsSync(backupDir))
                        rmSync(backupDir, { recursive: true, force: true });
                    mkdirSync(join(backupDir, '..'), { recursive: true });
                    try {
                        renameSync(target, backupDir);
                    }
                    catch {
                        cpSync(target, backupDir, { recursive: true });
                        rmSync(target, { recursive: true, force: true });
                    }
                    return { ok: true, detail: `moved non-symlink dir to backup: ${request.target}` };
                }
                if (request.kind === 'reorder-bundles') {
                    // [2026-08-27 自救缺陷修复 G1] 聚合包 × 独立包双挂载：request.target = 被挂包
                    // （如 dsh-better-sidebar），自动扫描 manifest dependencies 找「声明了该包的聚合包」
                    // （如 dsh-web-ui-all 的 dependencies 里有 dsh-better-sidebar）→ 把聚合包移到被挂包
                    // 之前，让被挂包自带的防双挂载守卫生效（守卫按 loader 处理顺序求值，聚合包在前
                    // 即可看到并禁用自身）。显式 request.before 优先（规则侧已知聚合包时直接指定）。
                    // 原子写回（temp+rename），失败不破坏原 manifest。
                    const manifest = readProfileManifest(profileDir);
                    if (!manifest)
                        return { ok: false, detail: 'no manifest to reorder' };
                    const profileObj = (manifest.dsh ?? {});
                    const profile = (profileObj.profile ?? {});
                    const bundles = Array.isArray(profile.bundles) ? profile.bundles : [];
                    const target = request.target;
                    if (!bundles.includes(target))
                        return { ok: true, detail: 'already-clean' };
                    // 找聚合包：显式 before 优先；否则扫 dependencies 里声明了 target 的包
                    let agg = request.before ?? '';
                    if (!agg || !bundles.includes(agg)) {
                        const deps = (manifest.dependencies ?? {});
                        agg = Object.keys(deps).find((d) => d !== target && bundles.includes(d)) ?? '';
                    }
                    if (!agg || !bundles.includes(agg))
                        return { ok: true, detail: 'no-aggregator-found' };
                    const idxAgg = bundles.indexOf(agg);
                    const idxTarget = bundles.indexOf(target);
                    if (idxAgg < idxTarget)
                        return { ok: true, detail: 'already-ordered' };
                    const next = [...bundles];
                    next.splice(idxAgg, 1);
                    next.splice(idxTarget, 0, agg);
                    const tmpPath = join(profileDir, 'package.json.tmp');
                    writeFileSync(tmpPath, JSON.stringify({
                        ...manifest,
                        dsh: { ...profileObj, profile: { ...profile, bundles: next } },
                    }, null, 2) + '\n', 'utf8');
                    renameSync(tmpPath, join(profileDir, 'package.json'));
                    return { ok: true, detail: `reordered ${agg} before ${target}` };
                }
                if (request.kind !== 'drop-duplicate-insert') {
                    return { ok: false, detail: `unknown repair kind: ${request.kind}` };
                }
                const id = request.target;
                // entry id 白名单形态（loader 行 id 都是 [A-Za-z0-9._-]），拒绝路径穿越形态
                if (!/^[A-Za-z0-9._-]+$/.test(id)) {
                    return { ok: false, detail: `invalid entry id: ${id}` };
                }
                if (!existsSync(patchPath))
                    return { ok: true, detail: 'no patch, nothing to drop' };
                const text = readFileSync(patchPath, 'utf8');
                // 按顶层 `- ` 分块，删掉"insert 块且含该 id"的块（复用 isolate 的分块语义，但保留其余原样）
                const blocks = text.split(/\n(?=- )/);
                const kept = blocks.filter((b) => {
                    const idMatch = /^\s*-\s*id:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*$/m.exec(b);
                    return !(b.includes('insert:') && idMatch && idMatch[1] === id);
                });
                if (kept.length === blocks.length)
                    return { ok: true, detail: 'already-clean' };
                // 哨兵法保留块间换行（split(/\n(?=- )/) 吃掉分隔 \n，join 必须补回，否则块粘连坏 YAML——
                // 2026-08-23 真机教训：repair 后 patch 粘连，DSH 报 bad indentation 继续崩）
                backupPatchBeforeWrite(profileDir);
                const joined = kept.join('\n');
                // 清空后只剩注释/空白 → 必须写回 DSH 期待的 [] 模板（否则注释-only 空文档判非法 patch）
                const hasContent = joined.replace(/#[^\n]*/g, '').trim().length > 0;
                writeFileSync(patchPath, hasContent ? joined : PROFILE_PATCH_TEMPLATE, 'utf8');
                return { ok: true, detail: `dropped duplicate insert: ${id}` };
            }
            catch (error) {
                return { ok: false, detail: String(error) };
            }
        },
        /**
         * 恢复通道（2026-08-23 用户拍板：隔离 = 移走不是删除）：
         * 把 isolate 前备份的插件实体与配置原文装回运行环境（撤销隔离）。
         * 顺序讲究：先实体后配置——中途失败落于"实体在、未挂载"的无害态，且可幂等重跑。
         * 恢复成功即删备份（生命周期结束）；失败保留备份可重试。
         */
        restore(plugin) {
            const packageName = plugin.packageName ?? plugin.id;
            // 三道闸与 isolate 同级：包名白名单 + 官方保护 + 备份路径包含校验
            if (!isValidNpmPackageName(packageName)) {
                return { ok: false, detail: `invalid package name: ${packageName}` };
            }
            if (packageName.startsWith(PROTECTED_PREFIX)) {
                return { ok: false, detail: `protected package: ${packageName}` };
            }
            const backupDir = backupDirFor(packageName);
            if (!isInside(backupRoot, backupDir)) {
                return { ok: false, detail: `path escapes backupRoot: ${backupDir}` };
            }
            const profileDir = join(options.dshHome, 'profiles', profileName);
            try {
                const metaPath = join(backupDir, 'meta.json');
                if (!existsSync(metaPath))
                    return { ok: true, detail: 'nothing-to-restore' };
                let meta;
                try {
                    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
                }
                catch {
                    return { ok: false, detail: 'backup meta corrupted' };
                }
                // 1) 还原 runtime 实体：<backup>/runtime/<pkg>/ → runtime node_modules/<pkg>
                if (meta.runtime.exists) {
                    const target = packageNodeModulesDir(options.dshRuntimeRoot, packageName);
                    if (!isInside(options.dshRuntimeRoot, target)) {
                        return { ok: false, detail: `path escapes dshRuntimeRoot: ${target}` };
                    }
                    const src = join(backupDir, 'runtime', packageName);
                    if (existsSync(src)) {
                        mkdirSync(join(target, '..'), { recursive: true });
                        cpSync(src, target, { recursive: true });
                    }
                }
                // 2) 还原 profile：junction 形态重建链接；real 形态整树拷回
                const profilePackage = packageNodeModulesDir(profileDir, packageName);
                if (!isInside(options.dshHome, profilePackage)) {
                    return { ok: false, detail: `path escapes dshHome: ${profilePackage}` };
                }
                if (meta.profileShape === 'junction') {
                    const realDir = packageNodeModulesDir(options.dshRuntimeRoot, packageName);
                    if (existsSync(realDir) && !existsSync(profilePackage)) {
                        mkdirSync(join(profilePackage, '..'), { recursive: true });
                        symlinkSync(realDir, profilePackage, 'junction');
                    }
                }
                else if (meta.profileReal.exists) {
                    const src = join(backupDir, 'profile-real', packageName);
                    if (existsSync(src)) {
                        mkdirSync(join(profilePackage, '..'), { recursive: true });
                        cpSync(src, profilePackage, { recursive: true });
                    }
                }
                // 3) 还原 manifest 原文（逐字节，与 isolate 写文件路径对称）
                if (meta.manifest.existed && meta.manifest.originalText !== undefined) {
                    writeFileSync(join(profileDir, 'package.json'), meta.manifest.originalText, 'utf8');
                }
                // 4) 还原 patch 原文（隔离前无 patch 则跳过）
                if (meta.patch.existed && meta.patch.originalText !== undefined) {
                    writeFileSync(join(profileDir, 'cordis.patch.yml'), meta.patch.originalText, 'utf8');
                }
                // 5) 全部成功 → 备份生命周期结束
                rmSync(backupDir, { recursive: true, force: true });
                return { ok: true, detail: 'restored' };
            }
            catch (error) {
                // 任一异常 → 收敛失败，备份保留、可重试（幂等重放）
                return { ok: false, detail: String(error) };
            }
        },
    };
}
export { PROFILE_PATCH_TEMPLATE };
/**
 * 净化备份 patch（坏 YAML 回退用）：剔除 insert 块里引用「实体已不存在」的包——
 * 备份是隔离前生成的，可能含已被移走插件的 insert 块，直接回退会 module-not-found 继续崩。
 * 返回净化后的文本；无变化返回 null。幂等：无 insert 块/无缺失实体时原样返回。
 */
export function sanitizePatchForRestore(options, text) {
    const profileName = options.profile ?? 'web';
    const profileDir = join(options.dshHome, 'profiles', profileName);
    const blocks = text.split(/\n(?=- )/);
    const kept = blocks.filter((b) => {
        if (!b.includes('insert:'))
            return true;
        const nameMatch = /name:\s*['"]?([@\w][\w.-]*(?:\/[\w.-]+)?)['"]?\s*$/m.exec(b);
        if (!nameMatch)
            return true;
        const pkg = nameMatch[1];
        // 官方组件永不隔离，实体必然在（跳过校验）
        if (pkg.startsWith(PROTECTED_PREFIX))
            return true;
        const profilePackage = packageNodeModulesDir(profileDir, pkg);
        const runtimePackage = packageNodeModulesDir(options.dshRuntimeRoot, pkg);
        return existsSync(profilePackage) || existsSync(runtimePackage);
    });
    if (kept.length === blocks.length)
        return null;
    const joined = kept.join('\n');
    const hasContent = joined.replace(/#[^\n]*/g, '').trim().length > 0;
    return hasContent ? joined : PROFILE_PATCH_TEMPLATE;
}
