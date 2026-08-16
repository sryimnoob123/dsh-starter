import { app, dialog, Notification } from 'electron';
import electronUpdater from 'electron-updater';
import {
  closeUpdateWindow,
  isUpdateWindowVisible,
  resetUpdateDismissal,
  setUpdateActionHandler,
  showUpdateWindow,
  type UpdateAction,
} from './progressWindow.js';

const { autoUpdater } = electronUpdater;

/** 手动检查标记：'update-not-available' 只在用户主动点"检查更新"时提示，避免每次启动打扰 */
let manualCheckPending = false;
/** 已下载待安装的版本（托盘「安装更新」入口 + 进度窗「现在安装」共用） */
let pendingUpdateVersion: string | null = null;
/** 托盘菜单在待装版本变化时重建（app.ts 传入） */
let notifyTray: (() => void) | null = null;

/**
 * 自动更新（[D78]，取代 [D15]）：自动检查更新 + 自动下载；安装由用户确认。
 * 更新 UX（O1 用户拍板）：发现新版本/下载进度/下载完成/失败 → 独立 OpenChamber 进度小窗
 * （update.html），自动检查与手动检查都弹；用户隐藏后托盘「安装更新」入口兜底。
 * 无发布源/网络失败时静默，不影响正常使用（FR-21.3：不打断）。
 */
export function setupAutoUpdater(options?: { onPendingChange?: () => void }): void {
  notifyTray = options?.onPendingChange ?? null;
  autoUpdater.autoDownload = true; // 自动下载（[D78]）
  autoUpdater.autoInstallOnAppQuit = false; // 安装必须用户确认

  // 进度窗按钮回传（install → 确认安装、retry → 重新检查；dismiss 在 progressWindow 内处理）
  setUpdateActionHandler((action: UpdateAction) => {
    if (action === 'install') {
      if (pendingUpdateVersion) void promptInstall(pendingUpdateVersion);
    } else if (action === 'retry') {
      autoUpdater.checkForUpdates().catch(() => undefined);
    }
  });

  autoUpdater.on('update-available', (info) => {
    // 新会话：重置"用户隐藏过"，本次照常弹窗（自动+手动都弹，用户拍板）
    resetUpdateDismissal();
    showUpdateWindow({
      phase: 'downloading',
      version: info.version,
      percent: 0,
      transferred: 0,
      total: 0,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    showUpdateWindow({
      phase: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      speed: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateVersion = info.version;
    notifyTray?.();
    showUpdateWindow({ phase: 'downloaded', version: info.version });
    // 通知兜底：进度窗被隐藏/关闭时，用户仍能从这里点安装
    const notification = new Notification({
      title: app.getName(),
      body: `新版本 ${info.version} 已下载，点击安装（重启后自动接回会话）`,
    });
    notification.on('click', () => void promptInstall(info.version));
    notification.show();
  });

  autoUpdater.on('update-not-available', () => {
    closeUpdateWindow();
    if (!manualCheckPending) return;
    manualCheckPending = false;
    new Notification({ title: app.getName(), body: '已是最新版本。' }).show();
  });

  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (isUpdateWindowVisible()) {
      // 下载途中失败 → 进度窗里直接可见（error 阶段 + 重试按钮）
      showUpdateWindow({ phase: 'error', error: message });
    } else if (manualCheckPending) {
      // 手动检查且无进度窗（还没发现新版本就失败）→ 通知回执
      new Notification({ title: app.getName(), body: `检查更新失败：${message}` }).show();
    }
    manualCheckPending = false;
  });

  autoUpdater.checkForUpdates().catch(() => undefined);
}

/** 托盘"检查更新"（[FR-27] 常用指令入口）：手动触发一次检查；结果以进度窗/通知回执 */
export function checkForUpdatesManually(): void {
  if (!app.isPackaged) {
    new Notification({ title: app.getName(), body: '开发模式不检查更新（发布通道仅打包版可用）。' }).show();
    return;
  }
  manualCheckPending = true;
  autoUpdater.checkForUpdates().catch(() => {
    manualCheckPending = false;
  });
}

/** 已下载待安装的版本（null = 没有）；托盘「安装更新 vX」入口据此显示/隐藏 */
export function getPendingUpdateVersion(): string | null {
  return pendingUpdateVersion;
}

/** 托盘「安装更新」点击：确认并安装已下载的版本 */
export function installPendingUpdate(): void {
  if (pendingUpdateVersion) void promptInstall(pendingUpdateVersion);
}

export async function promptInstall(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '安装更新',
    message: `新版本 ${version} 已下载`,
    detail: '安装会重启应用窗口。后台服务与任务不受影响，重启后自动接回。',
    buttons: ['现在安装', '稍后'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    autoUpdater.quitAndInstall();
  }
}