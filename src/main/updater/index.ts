import { app, dialog, Notification } from 'electron';
import electronUpdater from 'electron-updater';
import {
  closeUpdateWindow,
  isUpdateWindowVisible,
  resetUpdateDismissal,
  setDismissedHandler,
  setUpdateActionHandler,
  showUpdateWindow,
  type UpdateAction,
} from './progressWindow.js';
import { shouldInstallUpdate, extractReleaseNotes, shouldSuppressPopup } from './version.js';
import type { ConfigStore } from '../config/store.js';

const { autoUpdater } = electronUpdater;

/** 手动检查标记：'update-not-available' 只在用户主动点"检查更新"时提示，避免每次启动打扰 */
let manualCheckPending = false;
/** 已下载待安装的版本（托盘「安装更新」入口 + 进度窗「现在安装」共用） */
let pendingUpdateVersion: string | null = null;
/** 检查发现的待下载新版本（available 态；用户点「下载/更新」后才真正开始下载） */
let availableUpdateVersion: string | null = null;
/** 托盘菜单在待装版本变化时重建（app.ts 传入） */
let notifyTray: (() => void) | null = null;
/** 本次检查是否真的发生了下载（download-progress 触发过）：区分「新下载」与「重启后缓存待装」 */
let downloadedFreshly = false;
/** 进度窗应跟随应用内 uiTheme（用户可能在壳里强制浅/深色，而非系统色）；app.ts 传入 */
let getUiTheme: (() => 'dark' | 'light') | null = null;
/** 界面更新按钮状态回调（app.ts 注入：推给 DSH 右上角按钮做醒目提示 + 进度环） */
let onUiUpdate: ((state: UpdateUiState) => void) | null = null;
/** 壳配置（app.ts 注入：持久化"稍后"的版本号，跨会话抑制同版本弹窗 [稍后持久化]） */
let configStore: ConfigStore | null = null;

/** 右上角按钮界面状态（Codex/OpenChamber 式：新版本可见、进度可见、可一键下载/安装） */
export interface UpdateUiState {
  /** none=已最新（无提示）；checking=检查中；available=有新版本；downloading=下载中；downloaded=可安装；error=失败 */
  phase: 'none' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  error?: string;
  /** 更新日志 HTML（releaseNotes，来自发布源；available/downloaded 阶段展示） */
  releaseNotes?: string;
}

let latestUiState: UpdateUiState = { phase: 'none' };

function pushUi(state: UpdateUiState): void {
  latestUiState = state;
  onUiUpdate?.(state);
}

/** 供 app.ts 在页面加载完成后补推一次（did-finish-load 晚于状态变化的兜底） */
export function getUpdateUiState(): UpdateUiState {
  return latestUiState;
}

/**
 * 自动更新（[D78]，取代 [D15]）：自动检查更新 + 自动下载；安装由用户确认。
 * 更新 UX（O1 用户拍板）：发现新版本/下载进度/下载完成/失败 → 独立 OpenChamber 进度小窗
 * （update.html），自动检查与手动检查都弹；用户隐藏后托盘「安装更新」入口兜底。
 * 无发布源/网络失败时静默，不影响正常使用（FR-21.3：不打断）。
 */
export function setupAutoUpdater(options?: {
  onPendingChange?: () => void;
  uiTheme?: () => 'dark' | 'light';
  onUiUpdate?: (state: UpdateUiState) => void;
  configStore?: ConfigStore;
}): void {
  notifyTray = options?.onPendingChange ?? null;
  getUiTheme = options?.uiTheme ?? null;
  onUiUpdate = options?.onUiUpdate ?? null;
  configStore = options?.configStore ?? null;
  autoUpdater.autoDownload = false; // 不自动下载（用户点「下载/更新」才下载，避免启动即拉流量）
  autoUpdater.autoInstallOnAppQuit = false; // 安装必须用户确认
  // 开发演示（DSH_DEV_FORCE_UPDATE=1，默认关闭）：非打包模式也启用更新通道，
  // 读项目根 dev-app-update.yml（本地演示源）。平时不设则保持"打包版才检查更新"。
  if (process.env.DSH_DEV_FORCE_UPDATE === '1') {
    autoUpdater.forceDevUpdateConfig = true;
  }

  // "稍后"持久化：把被忽略的版本号写进壳配置，跨会话抑制同版本弹窗（[Codex Skip until next version]）
  setDismissedHandler((version: string) => {
    if (!configStore) return;
    const config = configStore.load();
    configStore.save({ ...config, dismissedUpdateVersion: version });
  });

  // 进度窗按钮回传（install → 确认安装、download → 开始下载、retry → 重新检查；dismiss 在 progressWindow 内处理）
  setUpdateActionHandler((action: UpdateAction) => {
    if (action === 'install') {
      if (pendingUpdateVersion) void promptInstall(pendingUpdateVersion);
    } else if (action === 'download') {
      startDownload();
    } else if (action === 'retry') {
      // 重试的即时反馈：按钮转"检查中"，进度窗同步显示
      pushUi({ phase: 'checking' });
      showUpdateWindow({ phase: 'checking' }, getUiTheme?.());
      autoUpdater.checkForUpdates().catch(() => undefined);
    }
  });

  autoUpdater.on('update-available', (info) => {
    // 新会话：重置"用户隐藏过" + 本次尚未真正下载。
    // 不在此弹窗——electron-updater 在「重启后缓存已下载」时也会发 update-available，
    // 若这里弹窗会导致每次启动都弹。等 download-progress（真开始下载）再弹。
    resetUpdateDismissal();
    downloadedFreshly = false;
    availableUpdateVersion = info.version;
    pushUi({
      phase: 'available',
      version: info.version,
      releaseNotes: extractReleaseNotes(info.releaseNotes),
    });
    // 手动检查且进度窗可见（"正在检查更新…"）→ 推进到"发现新版本"，
    // 避免停在检查中；自动检查不推进（避免每次启动都弹窗打扰）
    if (manualCheckPending && isUpdateWindowVisible()) {
      showUpdateWindow({ phase: 'available', version: info.version }, getUiTheme?.());
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    downloadedFreshly = true;
    pushUi({ phase: 'downloading', version: availableUpdateVersion ?? pendingUpdateVersion ?? undefined, percent: progress.percent });
    // 用户"稍后"过该版本（[稍后持久化]）→ 不自动弹窗，按钮角标 + 托盘入口兜底；
    // 新版本（版本号不同）恢复弹窗。窗口已可见（用户主动检查）时不抑制，内容照常更新。
    if (!isUpdateWindowVisible() && shouldSuppressPopup(configStore?.load().dismissedUpdateVersion, pendingUpdateVersion ?? '')) return;
    showUpdateWindow(
      {
        phase: 'downloading',
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        speed: progress.bytesPerSecond,
      },
      getUiTheme?.(),
    );
  });

  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateVersion = info.version;
    availableUpdateVersion = null; // 已下载完，不再"待下载"
    manualCheckPending = false; // 手动检查已得到结果（已下载），不再等"最新版"回执
    notifyTray?.();
    pushUi({
      phase: 'downloaded',
      version: info.version,
      releaseNotes: extractReleaseNotes(info.releaseNotes),
    });
    // 只有真的新下载才弹「下载完成」；缓存待装（重启后再检测到）不弹窗，只走通知+托盘，避免每次启动打扰
    if (downloadedFreshly && !shouldSuppressPopup(configStore?.load().dismissedUpdateVersion, info.version)) {
      showUpdateWindow(
        { phase: 'downloaded', version: info.version, releaseNotes: extractReleaseNotes(info.releaseNotes) },
        getUiTheme?.(),
      );
    }
    // 通知兜底：进度窗被隐藏/关闭时，用户仍能从这里点安装。
    // 只在新下载时发——缓存待装（重启后）不重复打扰（update-downloaded 每次启动都会触发一次）。
    // 用户"稍后"过该版本 → 也不发（[稍后持久化]：同版本不再打扰）。
    if (downloadedFreshly && !shouldSuppressPopup(configStore?.load().dismissedUpdateVersion, info.version)) {
      const notification = new Notification({
        title: app.getName(),
        body: '更新已下载完成，点击安装（重启后自动接回会话）',
      });
      notification.on('click', () => void promptInstall(info.version));
      notification.show();
    }
  });

  autoUpdater.on('update-not-available', () => {
    availableUpdateVersion = null;
    closeUpdateWindow();
    pushUi({ phase: 'none' });
    if (!manualCheckPending) return;
    manualCheckPending = false;
    new Notification({ title: app.getName(), body: '已是最新版本。' }).show();
  });

  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (isUpdateWindowVisible()) {
      // 下载途中失败 → 进度窗里直接可见（error 阶段 + 重试按钮）
      showUpdateWindow({ phase: 'error', error: message }, getUiTheme?.());
    } else if (manualCheckPending) {
      // 手动检查且无进度窗（还没发现新版本就失败）→ 通知回执
      new Notification({ title: app.getName(), body: `检查更新失败：${message}` }).show();
    }
    pushUi({ phase: 'error', error: message });
    manualCheckPending = false;
  });

  autoUpdater.checkForUpdates().catch(() => undefined);
}

/** 托盘"检查更新"（[FR-27] 常用指令入口）：手动触发一次检查；结果以进度窗/通知回执 */
let lastManualCheckAt = 0;
export function checkForUpdatesManually(): void {
  if (!app.isPackaged && process.env.DSH_DEV_FORCE_UPDATE !== '1') {
    new Notification({ title: app.getName(), body: '开发模式不检查更新（发布通道仅打包版可用）。' }).show();
    return;
  }
  // 防抖：10s 内重复触发忽略（合成点击/误连点兜底，避免每几秒刷一次 latest.yml）
  const now = Date.now();
  if (now - lastManualCheckAt < 10_000) return;
  lastManualCheckAt = now;
  manualCheckPending = true;
  // 手动检查的即时反馈：右上角按钮转"检查中"，进度窗同步显示（不抢焦点）
  pushUi({ phase: 'checking' });
  showUpdateWindow({ phase: 'checking' }, getUiTheme?.());
  autoUpdater.checkForUpdates().catch(() => {
    manualCheckPending = false;
  });
}

/** 已下载待安装的版本（null = 没有）；托盘「安装更新」入口据此显示/隐藏 */
export function getPendingUpdateVersion(): string | null {
  return pendingUpdateVersion;
}

/** 检查发现的待下载新版本（null = 没有）；更新提示条 available 态据此知道"点一下开始下载" */
export function getAvailableUpdateVersion(): string | null {
  return availableUpdateVersion;
}

/** 托盘「安装更新」点击：确认并安装已下载的版本 */
export function installPendingUpdate(): void {
  if (pendingUpdateVersion) void promptInstall(pendingUpdateVersion);
}

/**
 * 开始下载已发现的更新（用户点「下载/更新」才触发，见 autoDownload=false）。
 * 若检查还没完成/没有可用版本则静默返回（防连点）。
 */
export function startDownload(): void {
  if (!availableUpdateVersion || pendingUpdateVersion) return;
  try {
    autoUpdater.downloadUpdate().catch(() => undefined);
  } catch {
    // downloadUpdate 抛错（如正在下载中）→ 忽略
  }
}

export async function promptInstall(version: string): Promise<void> {
  // 版本守卫 + 安装幂等（[B1]）：当前版本已 >= 待装版本（已装过 / 已是最新）→ 不重复安装
  if (!shouldInstallUpdate(app.getVersion(), version)) {
    pendingUpdateVersion = null;
    notifyTray?.();
    pushUi({ phase: 'none' });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '安装更新',
    message: `新版本 ${version} 已下载`,
    detail: '点击「现在安装」后应用窗口会关闭，安装程序接管并显示安装进度；安装完成会自动重新打开应用。后台服务与任务不受影响，重启后自动接回。',
    buttons: ['现在安装', '稍后'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    // setImmediate 延迟一拍再装（OpenChamber 实测经验）：避免与挂起中的 IPC invoke 竞态，
    // 否则可能出现"看起来重启了但安装没生效"。before-quit 会先杀掉壳拉起的 DSH 服务，
    // 安装器不会因文件锁失败。
    setImmediate(() => autoUpdater.quitAndInstall());
  }
}