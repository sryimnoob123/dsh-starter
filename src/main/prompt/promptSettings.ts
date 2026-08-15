import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * FR-16 提示词管理（V1 壳侧面板逻辑，纯函数便于测试）。
 *
 * 稳定边界（只碰两处，均属 DSH 官方机制）：
 * ① `userData/desktop.patch.yml` —— spawn 时 `--patch` overlay（晚于 DSH 内置 patch 应用，
 *    覆盖 `system-prompt` 行时按 patch 语义**整体替换**该行 config，故须重述全部键）。
 *    基线值取自 DSH `packages/bundle/web-app/cordis.patch.yml`：
 *    includeHarnessIdentity:false、includeRuntimeContext:false、persona=编码 agent 模板。
 * ② `<dshHome>/AGENTS.md` —— agent-instructions 全局指令文件（[FR-16.7] 所见即所注入），
 *    dshHome 由壳 spawn 环境 `DSH_HOME=userData/dsh-home` 决定（[D80]）。
 *
 * 不做的事（V1 遗留，[FR-16.4] 的机制假设不成立）：DSH 无终端用户模板编辑 API
 * （settings 的 `agent-loop` 段只暴露 maxParallelToolCalls），子 agent 派发/汇总、
 * 计划模式模板留在 preset 内，面板不假装可编辑。
 */

export const WEB_BASE_INCLUDE_IDENTITY = false;
export const WEB_BASE_INCLUDE_RUNTIME_CONTEXT = false;
export const WEB_BASE_PERSONA =
  'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.';

export interface PromptUserConfig {
  includeHarnessIdentity: boolean;
  persona: string;
}

export function defaultPromptUserConfig(): PromptUserConfig {
  return { includeHarnessIdentity: WEB_BASE_INCLUDE_IDENTITY, persona: WEB_BASE_PERSONA };
}

/** 兼容旧配置/脏数据：非布尔与非字符串一律回默认 */
export function normalizePromptConfig(raw: unknown): PromptUserConfig {
  const fallback = defaultPromptUserConfig();
  if (typeof raw !== 'object' || raw === null) return fallback;
  const obj = raw as Record<string, unknown>;
  return {
    includeHarnessIdentity:
      typeof obj.includeHarnessIdentity === 'boolean' ? obj.includeHarnessIdentity : fallback.includeHarnessIdentity,
    persona: typeof obj.persona === 'string' ? obj.persona : fallback.persona,
  };
}

/** 与 DSH web 基线一致 = overlay 无需写 system-prompt 行（少写即少耦合基线） */
export function isPromptCustomized(config: PromptUserConfig): boolean {
  return (
    config.includeHarnessIdentity !== WEB_BASE_INCLUDE_IDENTITY ||
    config.persona.trim() !== WEB_BASE_PERSONA
  );
}

/**
 * 生成 userData/desktop.patch.yml 内容。
 * `agent-instructions` 行始终保留（桌面基线 [D75]：web 面默认禁用它，壳重新打开）。
 */
export function buildDesktopPatchYaml(config: PromptUserConfig): string {
  const lines: string[] = ['- id: agent-instructions', '  disabled: false'];
  if (isPromptCustomized(config)) {
    lines.push('- id: system-prompt', '  config:');
    lines.push(`    includeHarnessIdentity: ${config.includeHarnessIdentity}`);
    lines.push(`    includeRuntimeContext: ${WEB_BASE_INCLUDE_RUNTIME_CONTEXT}`);
    // 块标量 |-：保留内部换行、剥掉末尾换行，内容行缩进 6 格，任意字符安全；
    // 先生成内容再剥末尾空行，避免多写一行空白
    const body = config.persona.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (body.trim() === '') {
      // 空 persona = 渲染时删除该段（DSH system-prompt README：空段消失）
      lines.push("    persona: ''");
    } else {
      lines.push('    persona: |-');
      for (const line of body.split('\n')) lines.push(`      ${line}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** 壳自拉实例的 DSH_HOME（[D80]，与 spawn.ts 的 buildSpawnEnv 保持一致） */
export function desktopDshHome(userDataDir: string): string {
  return join(userDataDir, 'dsh-home');
}

/** 全局指令文件路径（[FR-16.7]：GUI 编辑 = 全局注入，所见即所注入） */
export function globalAgentsPath(userDataDir: string): string {
  return join(desktopDshHome(userDataDir), 'AGENTS.md');
}

/** 复用模式下外部服务的 DSH_HOME：默认 ~/.deepseek-harness，用户可在设置里指定 */
export function resolveExternalDshHome(configured?: string): string {
  const c = (configured ?? '').trim();
  return c !== '' ? c : join(homedir(), '.deepseek-harness');
}

/** 复用模式下外部服务的全局指令文件路径（= 运行中服务真实读取的那份 AGENTS.md） */
export function externalAgentsPath(configured?: string): string {
  return join(resolveExternalDshHome(configured), 'AGENTS.md');
}
