/**
 * 版本比较（[D78] 自动检查更新 + 自动下载，安装由用户确认）。
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(version: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function needsUpdate(current: string, latest: string): boolean {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return false;
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}

/**
 * 安装版本守卫（[B1] 安装幂等）：仅当待装版本比当前版本新才允许安装。
 * 当前版本已 >= 待装版本（已装过 / 已是最新）→ 返回 false，避免重复安装。
 */
export function shouldInstallUpdate(current: string, pending: string): boolean {
  return needsUpdate(current, pending);
}

/**
 * 从 electron-updater 的 UpdateInfo.releaseNotes 提取可渲染的更新日志 HTML。
 * - 字符串：原样返回（GitHub provider 的 note 是 release body 转的 HTML）；
 * - 数组（多版本）：按版本从新到旧拼接各 note；
 * - 空/缺省：返回 ''（UI 不显示日志区）。
 * 信任边界（[审查 M4] 纵深防御）：releaseNotes 来自自己的发布源（GitHub release body），
 * 但仍剥掉 <script>/<iframe> 标签、事件属性（on*）与 javascript: URL——
 * 防发布源被攻破/typosquat 时经 innerHTML 直插获得渲染进程代码执行。
 */
export function extractReleaseNotes(
  releaseNotes: string | Array<{ version: string; note: string | null }> | null | undefined,
): string {
  if (!releaseNotes) return '';
  const raw =
    typeof releaseNotes === 'string'
      ? releaseNotes
      : releaseNotes.map((r) => r.note ?? '').join('\n');
  return sanitizeReleaseNotesHtml(raw);
}

/** 净化发布源 HTML：剥 script/iframe/object/embed 标签、事件属性、javascript: URL（M4 纵深防御）。
 *  embed 是自闭合元素（无结束标签），匹配到 `>` 为止；iframe/object 有闭合标签。
 *  另剥 <style>/<link>/<meta>/<base>（可携带外链/执行面）与 <math>（XML 命名空间变体）。 */
export function sanitizeReleaseNotesHtml(html: string): string {
  return html
    // 配对标签：script/iframe/object/style/math
    .replace(/<(script|iframe|object|style|math)\b[\s\S]*?<\/\1\s*>/gi, '')
    // 自闭合 void 元素：embed/link/meta/base（无结束标签）
    .replace(/<(?:embed|link|meta|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // javascript:/vbscript:/data: URL（引号或无引号两种形态；整段替换，保证引号闭合）
    .replace(/(href|src)\s*=\s*(["']?)\s*(?:javascript|vbscript|data)\s*:[^"'\s>]*\2?/gi, '$1="#"')
    .replace(/\s+style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/**
 * 「稍后」持久化抑制（[Codex Skip until next version]）：用户对某版本点过"稍后"，
 * 该版本不再自动弹窗打扰；新版本到来（版本号不同）才恢复弹窗。
 */
export function shouldSuppressPopup(
  dismissedVersion: string | null | undefined,
  incomingVersion: string,
): boolean {
  return !!dismissedVersion && dismissedVersion === incomingVersion;
}
