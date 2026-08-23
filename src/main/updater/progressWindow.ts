import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM 下无 __dirname（项目 type:module）；与 app.ts 同款 shim，供下方页面/preload 路径定位
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 更新进度窗（O1 用户拍板：独立小窗、自动+手动检查都弹、OpenChamber 风）：
 * - 独立无边框小窗，置顶且不进任务栏，主窗口继续显示 DSH，不打断使用。
 * - **非阻塞推送**（[更新推送不挡 UI]）：小窗贴屏幕右下角（toast 式），`showInactive`
 *   显示但不抢键盘焦点——用户在主界面输入/操作时不被打断、不遮挡内容。
 * - 页面 = src/main/pages/update.html（OpenChamber token 同款，深浅两套随主题），
 *   渲染进程经 update-preload.cjs 的 window.dshUpdate 订阅状态/回传动作。
 * - 用户点 ✕ /「稍后」= 隐藏（本次更新会话不再自动弹出，托盘入口与下载完成通知兜底）；
 *   下次发现新版本（update-available）重置为会弹。
 */

export type UpdatePhase = 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

/** 推给进度窗页面的状态（与 update.html 渲染一一对应） */
export interface UpdateState {
  phase: UpdatePhase;
  /** 新版本号（available/downloaded 阶段） */
  version?: string;
  /** 下载进度 0-100（download-progress 的 percent 原样传） */
  percent?: number;
  /** 已下载字节数 */
  transferred?: number;
  /** 总字节数 */
  total?: number;
  /** 速度 字节/秒 */
  speed?: number;
  /** error 阶段的错误文案（用户可读） */
  error?: string;
  /** 更新日志 HTML（releaseNotes，来自发布源；downloaded 阶段展示） */
  releaseNotes?: string;
}

export type UpdateAction = 'install' | 'dismiss' | 'retry' | 'download';

const UPDATE_PAGE = join(__dirname, '..', 'pages', 'update.html');
const UPDATE_PRELOAD = join(__dirname, 'update-preload.cjs');
/** 主进程 → 渲染进程：状态推送（页面 onState 订阅） */
const STATE_CHANNEL = 'dsh:update-state';
/** 渲染进程 → 主进程：动作（页面 action() 调用） */
const ACTION_CHANNEL = 'dsh:update-action';

let updateWindow: BrowserWindow | null = null;
let latestState: UpdateState | null = null;
let lastPhase: UpdatePhase | null = null;
/** 用户本次更新会话里主动隐藏过（✕/稍后/关闭）→ 不再自动弹出；update-available 时重置 */
let dismissedSession = false;
/** 用户"稍后"时正在处理的版本（latestState.version 兜底）；供 updater/index.ts 持久化（[稍后持久化]） */
let dismissedVersion: string | null = null;
/** install/retry 动作交给更新逻辑处理（updater/index.ts 注册） */
let actionHandler: ((action: UpdateAction) => void) | null = null;
/** 用户"稍后"某版本时回调（updater/index.ts 注册：持久化到壳配置，跨会话抑制同版本弹窗） */
let dismissedHandler: ((version: string) => void) | null = null;

function currentUiTheme(): 'dark' | 'light' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/** 右下角非阻塞定位（[更新推送不挡 UI]）：贴工作区右下角（托盘上方），留 12px 边距，
 *  更新推送做 toast 式小角标，不居中、不盖主界面内容、不夺输入焦点。 */
function positionBottomRight(win: BrowserWindow): void {
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = win.getSize();
  win.setPosition(workArea.x + workArea.width - w - 12, workArea.y + workArea.height - h - 12, false);
}

function buildWindow(uiTheme?: 'dark' | 'light'): BrowserWindow {
  const theme = uiTheme ?? currentUiTheme();
  const win = new BrowserWindow({
    width: 400,
    height: 380, // 含 downloaded 阶段的更新日志区（releaseNotes）；其他阶段内容居中，底部留白
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: theme === 'dark' ? '#151313' : '#f6f2e8',
    webPreferences: {
      preload: UPDATE_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  positionBottomRight(win);
  // 页面加载完成前收到的状态推不进去，加载完成后补推最新一帧
  win.webContents.on('did-finish-load', () => {
    if (latestState) pushState(latestState);
  });
  win.on('closed', () => {
    updateWindow = null;
  });
  void win.loadFile(UPDATE_PAGE, { query: { uiTheme: theme } });
  return win;
}

function ensureWindow(uiTheme?: 'dark' | 'light'): BrowserWindow | null {
  if (updateWindow && !updateWindow.isDestroyed()) return updateWindow;
  try {
    updateWindow = buildWindow(uiTheme);
  } catch {
    return null;
  }
  return updateWindow;
}

function pushState(state: UpdateState): void {
  if (!updateWindow || updateWindow.isDestroyed()) return;
  updateWindow.webContents.send(STATE_CHANNEL, state);
}

/**
 * 推一帧状态。弹窗策略：
 * - 新会话第一次（phase 变化）且用户没主动隐藏过 → 显示并聚焦；
 * - 用户隐藏过（dismissedSession）→ 静默更新状态，不再弹出（托盘/通知兜底）；
 * - 同一 phase 的进度帧只更新内容，不反复 show/focus 打扰。
 */
export function showUpdateWindow(state: UpdateState, uiTheme?: 'dark' | 'light'): void {
  latestState = state;
  const win = ensureWindow(uiTheme);
  if (!win) return;
  const phaseChanged = lastPhase !== state.phase;
  if (phaseChanged) lastPhase = state.phase;
  const visible = win.isVisible();
  if (!visible && !dismissedSession && phaseChanged) {
    // showInactive：非阻塞推送，显示但不夺键盘焦点——用户在主界面输入/操作时不被打断
    win.showInactive();
  }
  pushState(state);
}

/** 新版本会话开始（update-available）：重置"用户隐藏过"，本次照常弹出 */
export function resetUpdateDismissal(): void {
  dismissedSession = false;
}

/** 用户主动隐藏（✕/稍后/关闭）：整次会话不再自动弹，托盘与通知兜底。
 *  "稍后"（dismiss 动作）额外记录版本号 → 持久化，跨会话抑制同版本弹窗（[稍后持久化]）。 */
export function dismissUpdateWindow(): void {
  dismissedSession = true;
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.hide();
  const version = latestState?.version ?? null;
  if (version) {
    dismissedVersion = version;
    dismissedHandler?.(version);
  }
}

/** 注册"稍后"回调（updater/index.ts 调用：把版本号持久化到壳配置） */
export function setDismissedHandler(handler: (version: string) => void): void {
  dismissedHandler = handler;
}

export function closeUpdateWindow(): void {
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.hide();
}

export function isUpdateWindowVisible(): boolean {
  return updateWindow !== null && !updateWindow.isDestroyed() && updateWindow.isVisible();
}

/** 注册窗口按钮回传动作（install → promptInstall、retry → 重新检查）；updater/index.ts 调用 */
export function setUpdateActionHandler(handler: (action: UpdateAction) => void): void {
  actionHandler = handler;
}

// 窗口按钮动作的单一注册点（模块加载时注册一次即可）
ipcMain.handle(ACTION_CHANNEL, (_event, raw: unknown) => {
  const action = typeof raw === 'string' ? (raw as UpdateAction) : null;
  if (action === 'dismiss') {
    dismissUpdateWindow();
    return;
  }
  if (action && actionHandler) actionHandler(action);
});