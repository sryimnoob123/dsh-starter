/** 核心词汇表：禁止出现任何宿主专有概念（manifest/patch/junction 等住在配方层）。 */
export interface KnownPlugin {
    /** 宿主侧唯一标识（崩溃日志里可能出现的名字） */
    id: string;
    /** 可选规范名（包名）；与 id 不同时提供映射 */
    packageName?: string;
}
export interface CrashReport {
    phase: 'boot' | 'post-ready' | 'runtime';
    stderr: string;
    knownPlugins: readonly KnownPlugin[];
}
export interface Diagnosis {
    /** 规则自定义类别，如 'module-not-found' */
    kind: string;
    /** 认出的肇事者；可能认不出（交给决策层放弃） */
    suspect?: KnownPlugin;
    /** 可选修复请求（如重复挂载的 insert 清理）；核心不解释语义，交给配方层隔离器实现 */
    repair?: RepairRequest;
    /** 原始匹配文本，供日志/上报 */
    detail: string;
}
/** 修复请求：核心只透传 kind + 目标，具体修复动作由配方层隔离器的 repair 实现 */
export interface RepairRequest {
    /** 配方层自定义类别（如 'drop-duplicate-insert'） */
    kind: string;
    /** 修复目标（entry id / 包名，随 kind 语义） */
    target: string;
    /** [2026-08-27] reorder-bundles 专用：聚合包要移到哪个包之前（让守卫生效） */
    before?: string;
}
export interface Diagnoser {
    name: string;
    diagnose(crash: CrashReport): Diagnosis | null;
}
export interface IsolationResult {
    ok: boolean;
    detail?: string;
}
export interface Isolator {
    isolate(plugin: KnownPlugin): Promise<IsolationResult> | IsolationResult;
    /** 可选修复通道：按诊断里的修复请求做非破坏性修复（如清重复 insert 块）；
     *  核心不认识 repair.kind，由配方层实现；不提供 = 无修复能力（退化为仅隔离） */
    repair?(request: RepairRequest): Promise<IsolationResult> | IsolationResult;
    /** 可选恢复通道：把 isolate 前备份的插件实体/配置装回运行环境（撤销隔离）。
     *  核心不认识实现细节，由配方层实现；不提供 = 无恢复能力（隔离后只能手动重装）。 */
    restore?(plugin: KnownPlugin): Promise<IsolationResult> | IsolationResult;
}
export interface Restarter {
    restart(): Promise<void> | void;
}
export interface RescuePolicy {
    /** 滑动窗口内最大隔离次数（默认 3） */
    maxIsolationsPerWindow: number;
    /** 滑动窗口内最大修复次数（默认 3；对抗审查 C4：修复成功但崩溃依旧时防无限 repair→restart 循环） */
    maxRepairsPerWindow: number;
    /** 窗口长度毫秒（默认 5 分钟） */
    windowMs: number;
}
export type RescueEvent = {
    type: 'isolated';
    pluginId: string;
    packageName?: string;
    at: number;
} | {
    type: 'isolation-failed';
    pluginId: string;
    packageName?: string;
    detail: string;
    at: number;
} | {
    type: 'repaired';
    repair: RepairRequest;
    at: number;
} | {
    type: 'repair-failed';
    kind: string;
    target: string;
    detail: string;
    at: number;
} | {
    type: 'gave-up';
    reason: string;
    at: number;
} | {
    type: 'runtime-diagnosis';
    diagnosis: Diagnosis;
    at: number;
} | {
    type: 'recovered';
    isolatedPluginIds: readonly string[];
    at: number;
};
