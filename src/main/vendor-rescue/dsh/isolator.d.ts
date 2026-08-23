import type { Isolator } from '../core/types.js';
export interface DshIsolatorOptions {
    /** $DSH_HOME（其下 profiles/<name>/ 是 profile 目录） */
    dshHome: string;
    /** DSH 运行时根（其 node_modules/ 存放插件实体） */
    dshRuntimeRoot: string;
    /** profile 名，默认 'web' */
    profile?: string;
    /** 隔离备份根目录（每插件一个子目录，meta.json 记录还原所需全部状态）。
     *  默认 join(dshHome, '.rescue-backups')；壳可注入 userData 等更稳位置。
     *  不得位于 profile/runtime 的 node_modules 删除面之内（隔离会递归删那里）。 */
    backupRoot?: string;
}
/** The empty user patch layer DSH expects at `profiles/<name>/cordis.patch.yml`.
 *  清块后只剩注释/空白时必须写回含 `[]` 的模板——注释-only 的空 YAML 文档
 *  会被 DSH 判为非法 patch 顶层而崩溃（2026-08-22 真机教训）。 */
declare const PROFILE_PATCH_TEMPLATE: string;
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
export declare function createDshIsolator(options: DshIsolatorOptions): Isolator;
export { PROFILE_PATCH_TEMPLATE };
/**
 * 净化备份 patch（坏 YAML 回退用）：剔除 insert 块里引用「实体已不存在」的包——
 * 备份是隔离前生成的，可能含已被移走插件的 insert 块，直接回退会 module-not-found 继续崩。
 * 返回净化后的文本；无变化返回 null。幂等：无 insert 块/无缺失实体时原样返回。
 */
export declare function sanitizePatchForRestore(options: {
    dshHome: string;
    dshRuntimeRoot: string;
    profile?: string;
}, text: string): string | null;
