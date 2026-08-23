import type { CrashReport, Diagnosis, Diagnoser } from './types.js';
/** 按注册顺序跑诊断规则，第一条命中的结果胜出；都不中返回 null。 */
export declare function runDiagnosers(diagnosers: readonly Diagnoser[], crash: CrashReport): Diagnosis | null;
