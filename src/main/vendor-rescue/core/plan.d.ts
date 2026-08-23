import type { Diagnosis, RepairRequest, RescuePolicy } from './types.js';
export interface PlanInput {
    diagnosis: Diagnosis | null;
    /** 本次会话已隔离过的插件（全量，跨窗口——重复崩溃说明有机制管不到的残留） */
    isolatedPluginIds: readonly string[];
    /** 滑动窗口内的隔离次数（窗口过滤由引擎做） */
    recentIsolationCount: number;
    /** 滑动窗口内的修复次数（窗口过滤由引擎做；对抗审查 C4 防无限 repair 循环） */
    recentRepairCount: number;
    /** 隔离器是否提供 repair 通道 */
    hasRepair: boolean;
}
export interface PlanDecision {
    action: 'isolate' | 'repair' | 'give-up';
    pluginId?: string;
    repair?: RepairRequest;
    reason?: 'no-diagnosis' | 'no-suspect' | 'already-isolated' | 'window-budget-exhausted' | 'repair-budget-exhausted';
}
export declare function planRescue(input: PlanInput, policy: RescuePolicy): PlanDecision;
