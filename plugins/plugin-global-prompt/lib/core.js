export function effectiveAgentsText(config) {
  return config.enabled ? String(config.globalPrompt ?? '') : '';
}

export function registeredWorkspacePath(registry, workspaceId) {
  const workspace = registry.get(String(workspaceId));
  return typeof workspace?.path === 'string' ? workspace.path : null;
}

/** persona 上限 2 万字符(对齐旧壳 contract 校验)。 */
const MAX_PERSONA_CHARS = 20000;
/** 指令文本上限 1 MiB UTF-8 字节(对齐 agent-instructions 默认 maxSourceBytes)。 */
const MAX_TEXT_BYTES = 1048576;

/**
 * 校验提示词设置载荷:persona ≤ 20000 字符,globalPrompt ≤ 1MiB UTF-8 字节。
 * 超限/类型错误返回错误信息字符串,通过返回 null。
 */
export function validatePromptConfig(config) {
  if (typeof config !== 'object' || config === null) return 'config must be an object';
  if (config.persona !== undefined && typeof config.persona !== 'string') return 'persona must be a string';
  if (typeof config.persona === 'string' && config.persona.length > MAX_PERSONA_CHARS) {
    return `persona exceeds ${MAX_PERSONA_CHARS} characters`;
  }
  if (config.globalPrompt !== undefined && typeof config.globalPrompt !== 'string') return 'globalPrompt must be a string';
  if (typeof config.globalPrompt === 'string' && Buffer.byteLength(config.globalPrompt, 'utf8') > MAX_TEXT_BYTES) {
    return `globalPrompt exceeds ${MAX_TEXT_BYTES} bytes`;
  }
  return null;
}

/** 校验项目指令文本:必须是字符串且 ≤ 1MiB UTF-8 字节。通过返回 null。 */
export function validateProjectText(text) {
  if (typeof text !== 'string') return 'project instruction text must be a string';
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    return `project instruction text exceeds ${MAX_TEXT_BYTES} bytes`;
  }
  return null;
}
