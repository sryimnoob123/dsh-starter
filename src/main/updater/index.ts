import { dialog, Notification } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

/**
 * 自动更新（[D78]，取代 [D15]）：自动检查更新 + 自动下载；安装由用户确认。
 * 无发布源/网络失败时静默，不影响正常使用（FR-21.3：不打断）。
 */
export function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true; // 自动下载（[D78]）
  autoUpdater.autoInstallOnAppQuit = false; // 安装必须用户确认

  autoUpdater.on('update-downloaded', (info) => {
    const notification = new Notification({
      title: 'deepseekharness',
      body: `新版本 ${info.version} 已下载，点击安装（重启后自动接回会话）`,
    });
    notification.on('click', () => void promptInstall(info.version));
    notification.show();
  });

  autoUpdater.on('error', () => {
    // 静默：发布源未配置或网络失败时不影响使用
  });

  autoUpdater.checkForUpdates().catch(() => undefined);
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
