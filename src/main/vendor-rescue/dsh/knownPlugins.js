import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
/**
 * 已知插件清单 = 宿主内置清单（含 rowId 映射）∪ profile manifest 扫描
 * （dsh.profile.bundles ∪ dependencies，滤 @deepseek-ai/*）。重复时内置清单优先
 * （保留 rowId 映射）。解决第三方插件 duplicate-entry 的映射盲区——
 * manifest 里能看到的第三方包名都进清单。manifest 缺失/损坏不是错误：
 * 等于没装第三方插件，退回仅内置清单。
 */
export function collectKnownPlugins(input) {
    const profileName = input.profile ?? 'web';
    const known = new Map();
    for (const row of input.bundled) {
        known.set(row.packageName, { id: row.rowId, packageName: row.packageName });
    }
    const manifestPath = join(input.dshHome, 'profiles', profileName, 'package.json');
    if (existsSync(manifestPath)) {
        try {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            const dsh = (manifest.dsh ?? {});
            const profile = (dsh.profile ?? {});
            const bundles = Array.isArray(profile.bundles) ? profile.bundles : [];
            const deps = typeof manifest.dependencies === 'object' && manifest.dependencies !== null
                ? Object.keys(manifest.dependencies)
                : [];
            for (const name of [...bundles, ...deps]) {
                if (name.startsWith('@deepseek-ai/'))
                    continue;
                if (!known.has(name))
                    known.set(name, { id: name, packageName: name });
            }
        }
        catch { /* manifest 坏了：退回内置清单 */ }
    }
    return [...known.values()];
}
