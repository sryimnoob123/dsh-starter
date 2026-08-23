export function planRescue(input, policy) {
    if (input.diagnosis === null)
        return { action: 'give-up', reason: 'no-diagnosis' };
    // 修复优先：诊断带修复请求且隔离器支持 → 走修复（修复不烧隔离预算，
    // 且不要求 suspect——第三方插件映射不到也能修 patch 双挂这类配置错误）
    const repair = input.diagnosis.repair;
    if (repair && input.hasRepair) {
        // [C4] 修复成功但崩溃依旧（.bak 也坏/坏在其他文件）时，repair→restart→再崩→再修
        // 是无限循环；窗口内修复次数预算耗尽 → give-up（配置错误不止于 repair 能修的范围，
        // 该人工介入了）
        if (input.recentRepairCount >= policy.maxRepairsPerWindow) {
            return { action: 'give-up', reason: 'repair-budget-exhausted' };
        }
        return { action: 'repair', repair, pluginId: repair.target };
    }
    const suspect = input.diagnosis.suspect;
    if (suspect === undefined)
        return { action: 'give-up', reason: 'no-suspect' };
    if (input.isolatedPluginIds.includes(suspect.id)) {
        return { action: 'give-up', reason: 'already-isolated' };
    }
    if (input.recentIsolationCount >= policy.maxIsolationsPerWindow) {
        return { action: 'give-up', reason: 'window-budget-exhausted' };
    }
    return { action: 'isolate', pluginId: suspect.id };
}
