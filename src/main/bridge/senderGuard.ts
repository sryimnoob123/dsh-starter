/**
 * IPC sender 校验（2026-08-24 安全审查 P0-2 修复）：
 * - 所有 ipcMain.handle 处理器先校验调用方是壳自己注册的窗口（主窗口/更新窗），
 *   拒绝任何其他 webContents（意外创建的窗口、开发者工具、被 XSS 的远程页）调用桥能力。
 * - 高敏感操作（写文件/改配置/装插件/重启服务）额外要求调用页是壳本地页（file://）。
 * - DSH 页面（http://127.0.0.1:port）只放行它 UI 真正需要的桥方法（插件管理），
 *   其余能力一律保留给壳本地页。
 *
 * 主窗口/更新窗创建时 registerTrustedSender，销毁时注销。
 */

/** 已注册的合法 webContents id（主窗口 + 更新窗） */
const trustedSenders = new Set<number>();

/** 注册一个可信 webContents；返回注销函数（窗口销毁时调用）。 */
export function registerTrustedSender(webContentsId: number): () => void {
  trustedSenders.add(webContentsId);
  return () => trustedSenders.delete(webContentsId);
}

/** sender 是否来自壳自己注册的窗口。 */
export function isTrustedSender(sender: Electron.WebContents): boolean {
  return trustedSenders.has(sender.id);
}

/** 调用页是否为壳本地页（file:// 指向壳 pages 目录）。 */
export function isShellLocalPage(sender: Electron.WebContents): boolean {
  return sender.getURL().startsWith('file://');
}

/** 高敏感桥方法：只允许壳本地页调用（DSH 页面 XSS 也拿不到）。 */
export const LOCAL_PAGE_ONLY_METHODS = new Set<string>([
  'quit',
  'choosePort',
  'startInstall',
  'pickDir',
  'selectDshDir',
  'testConnection',
  'saveConnection',
  'discoverModels',
  'savePromptSettings',
  'saveProjectInstruction',
  'filePathMenu',
  'filePathOpen',
  'troubleshoot',
]);

/**
 * DSH 页面（127.0.0.1）允许的桥方法（其 UI 真正需要的能力；插件管理在 DSH 页面内）。
 * 含右上角悬浮按钮（FLOATING_CONTROLS_SCRIPT 注入在 DSH 页面）依赖的窗口控制与更新检查：
 * 4.8 误把 windowControl 划进 LOCAL_PAGE_ONLY → DSH 页面点按钮 IPC 被拒 → 按钮点了没反应
 * （4.8 真实用户也踩到）。windowControl 为窗口控制，非文件/配置写操作，DSH 页面调用无敏感面。
 * checkForUpdates 原本就落在「其余方法放行」分支，这里显式列出以防未来收紧默认放行时误伤。
 */
export const DSH_PAGE_ALLOWED_METHODS = new Set<string>([
  'pluginList',
  'pluginSetEnabled',
  'pluginSetRemoved',
  'windowControl',
  'checkForUpdates',
]);

/** 校验调用：可信窗口 + 方法按页面来源分级。返回 null = 放行，字符串 = 拒绝原因。 */
export function checkIpcCall(
  method: string,
  sender: Electron.WebContents,
): string | null {
  if (!isTrustedSender(sender)) return `untrusted sender (webContents ${sender.id})`;
  const url = sender.getURL();
  const isLocal = url.startsWith('file://');
  const isDshPage = /^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(url);
  if (isLocal) return null; // 壳本地页：全部放行
  if (isDshPage) {
    if (DSH_PAGE_ALLOWED_METHODS.has(method)) return null;
    if (LOCAL_PAGE_ONLY_METHODS.has(method)) {
      return `method ${method} requires shell local page, got ${url}`;
    }
    return null; // 其余只读方法（readLog/readNotifications 等）放行
  }
  return `untrusted page url: ${url}`;
}
