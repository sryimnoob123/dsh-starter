import type { CrashReport, Diagnoser, Isolator, RescueEvent, RescuePolicy, Restarter } from './types.js';
export interface EngineOptions {
    diagnosers: readonly Diagnoser[];
    isolator: Isolator;
    restarter: Restarter;
    policy?: Partial<RescuePolicy>;
    onEvent?: (event: RescueEvent) => void;
    /** 时钟注入，测试用；默认 Date.now */
    now?: () => number;
}
export type CrashOutcome = {
    action: 'isolated';
    pluginId: string;
    packageName?: string;
} | {
    action: 'repaired';
    repairKind: string;
    target: string;
} | {
    action: 'give-up';
    reason: string;
};
export declare function createRescueEngine(options: EngineOptions): {
    reportCrash: (crash: CrashReport) => Promise<CrashOutcome>;
    markHealthy: () => void;
    readonly isolatedPluginIds: readonly string[];
};
export type RescueEngine = ReturnType<typeof createRescueEngine>;
