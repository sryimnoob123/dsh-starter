import { runDiagnosers } from './diagnose.js';
import { planRescue } from './plan.js';
const DEFAULT_POLICY = {
    maxIsolationsPerWindow: 3,
    maxRepairsPerWindow: 3,
    windowMs: 5 * 60_000,
};
export function createRescueEngine(options) {
    const policy = { ...DEFAULT_POLICY, ...options.policy };
    const clock = options.now ?? Date.now;
    const emit = (e) => options.onEvent?.(e);
    // 会话内状态：隔离台账（id + 时间戳）+ give-up 锁 + 串行队列。
    // 串行化是必须的：isolate 是异步的，await 期间进来的并发崩溃会在台账
    // 记账前完成预算判定，突破窗口上限（把插件逐个剥光的防线失效）。
    // give-up 锁住后续自动处置（壳回落引导页）；runtime 崩溃只诊断不处置、不锁。
    let isolatedLog = [];
    let repairLog = [];
    let gaveUp = false;
    let queue = Promise.resolve();
    async function handleCrash(crash) {
        if (gaveUp)
            return { action: 'give-up', reason: 'already-gave-up' };
        const now = clock();
        const diagnosis = runDiagnosers(options.diagnosers, crash);
        if (crash.phase === 'runtime') {
            // v1 契约：runtime 崩溃只诊断上报（v2 打开自动隔离，接口不变）
            if (diagnosis)
                emit({ type: 'runtime-diagnosis', diagnosis, at: now });
            return { action: 'give-up', reason: 'runtime-phase-not-auto-isolated' };
        }
        const decision = planRescue({
            diagnosis,
            isolatedPluginIds: isolatedLog.map((r) => r.id),
            recentIsolationCount: isolatedLog.filter((r) => now - r.at < policy.windowMs).length,
            recentRepairCount: repairLog.filter((r) => now - r.at < policy.windowMs).length,
            hasRepair: typeof options.isolator.repair === 'function',
        }, policy);
        // 修复通道：非破坏性处置（如清 patch 双挂），不烧隔离预算、不锁会话；
        // 修复失败不隔离（配置错误隔离插件会把没坏的实体删掉，方向反了）——回落到 give-up 让壳提示
        if (decision.action === 'repair' && decision.repair) {
            let repairResult;
            try {
                repairResult = await options.isolator.repair(decision.repair);
            }
            catch (error) {
                repairResult = { ok: false, detail: String(error) };
            }
            if (repairResult.ok) {
                repairLog.push({ kind: decision.repair.kind, at: now });
                emit({ type: 'repaired', repair: decision.repair, at: now });
                // 修复成功不视为隔离：不记入 isolatedLog（下次同因崩溃还会修，幂等无害；
                // 但记入 repairLog 供窗口预算判定，防「修复成功却依旧崩」的无限循环）
                await options.restarter.restart();
                return { action: 'repaired', repairKind: decision.repair.kind, target: decision.repair.target };
            }
            emit({ type: 'repair-failed', kind: decision.repair.kind, target: decision.repair.target, detail: repairResult.detail ?? '', at: now });
            gaveUp = true;
            emit({ type: 'gave-up', reason: 'repair-failed', at: now });
            return { action: 'give-up', reason: 'repair-failed' };
        }
        if (decision.action === 'give-up') {
            gaveUp = true;
            emit({ type: 'gave-up', reason: decision.reason ?? 'unknown', at: now });
            return { action: 'give-up', reason: decision.reason ?? 'unknown' };
        }
        const suspect = diagnosis?.suspect;
        if (suspect === undefined) {
            // planRescue 已保证 isolate 路径必有 suspect；防御式兜底，不可达
            gaveUp = true;
            emit({ type: 'gave-up', reason: 'no-suspect', at: now });
            return { action: 'give-up', reason: 'no-suspect' };
        }
        // 隔离器异常（含第三方 isolator 抛错）兜底为失败通道：自救自身出错
        // 不得反向带崩宿主进程
        let result;
        try {
            result = await options.isolator.isolate(suspect);
        }
        catch (error) {
            result = { ok: false, detail: String(error) };
        }
        if (!result.ok) {
            gaveUp = true;
            emit({ type: 'isolation-failed', pluginId: suspect.id, packageName: suspect.packageName, detail: result.detail ?? '', at: now });
            emit({ type: 'gave-up', reason: 'isolation-failed', at: now });
            return { action: 'give-up', reason: 'isolation-failed' };
        }
        isolatedLog.push({ id: suspect.id, at: now });
        emit({ type: 'isolated', pluginId: suspect.id, packageName: suspect.packageName, at: now });
        // 重启失败向上传播：进程拉不起来属于宿主故障，不是自救范畴
        await options.restarter.restart();
        return { action: 'isolated', pluginId: suspect.id, packageName: suspect.packageName };
    }
    /** 喂一次崩溃（串行执行：并发上报按到达顺序排队，预算判定不会互相穿透）。 */
    function reportCrash(crash) {
        const run = () => handleCrash(crash);
        const outcome = queue.then(run, run);
        queue = outcome.catch(() => undefined);
        return outcome;
    }
    function markHealthy() {
        const ids = isolatedLog.map((r) => r.id);
        isolatedLog = [];
        repairLog = [];
        gaveUp = false;
        if (ids.length > 0)
            emit({ type: 'recovered', isolatedPluginIds: ids, at: clock() });
    }
    return {
        reportCrash,
        markHealthy,
        get isolatedPluginIds() {
            return isolatedLog.map((r) => r.id);
        },
    };
}
