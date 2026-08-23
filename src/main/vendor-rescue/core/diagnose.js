/** 按注册顺序跑诊断规则，第一条命中的结果胜出；都不中返回 null。 */
export function runDiagnosers(diagnosers, crash) {
    for (const d of diagnosers) {
        const result = d.diagnose(crash);
        if (result)
            return result;
    }
    return null;
}
