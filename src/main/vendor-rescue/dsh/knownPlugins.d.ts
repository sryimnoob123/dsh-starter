import type { KnownPlugin } from '../core/types.js';
/** 宿主内置插件行（rowId 是 patch 行标识，packageName 是规范名）。 */
export interface BundledPluginRow {
    rowId: string;
    packageName: string;
}
/**
 * 已知插件清单 = 宿主内置清单（含 rowId 映射）∪ profile manifest 扫描
 * （dsh.profile.bundles ∪ dependencies，滤 @deepseek-ai/*）。重复时内置清单优先
 * （保留 rowId 映射）。解决第三方插件 duplicate-entry 的映射盲区——
 * manifest 里能看到的第三方包名都进清单。manifest 缺失/损坏不是错误：
 * 等于没装第三方插件，退回仅内置清单。
 */
export declare function collectKnownPlugins(input: {
    bundled: readonly BundledPluginRow[];
    dshHome: string;
    profile?: string;
}): KnownPlugin[];
