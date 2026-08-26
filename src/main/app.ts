import { app, BrowserWindow, clipboard, dialog, globalShortcut, Menu, nativeTheme, Notification, shell, Tray } from 'electron';
import { accessSync, appendFileSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { ConfigStore } from './config/store.js';
import { classifyProbe, parseReadyUrlLine } from './service/detect.js';
import { scanHotMountLine } from './service/hotMount.js';
import { decideRenderGone, RENDER_GONE_WINDOW_MS, STATUS_BREAKPOINT, type RenderGoneState } from './window/renderGone.js';
import { decidePort } from './service/port.js';
import { decideStartup } from './service/startup.js';
import { checkDirWritable, isAdmin } from './service/writableCheck.js';
import { autoFixStoreDrift, detectStoreDrift } from './service/storeDrift.js';
import { buildNodeSpawnSpec, buildSpawnEnv, buildSpawnSpec, type SpawnSpec } from './service/spawn.js';
import { ensureProfilePnpmWorkspaces } from './service/profileWorkspace.js';
import { isNodeOk } from './service/nodeCheck.js';
import { Registry } from './extensions/registry.js';
import { classifyEvent, type MuxFrame } from './notify/classify.js';
import { unwrapMuxEnvelope } from './notify/mux.js';
import { JobTracker } from './events/catchup.js';
import { redact, buildLogLine } from './logging/redact.js';
import { maybeRotateLog } from './logging/rotate.js';
import { readLogTail, readDiagnosticLogTail } from './logging/readLog.js';
import { logFile } from './logging/paths.js';
import {
  checkForUpdatesManually,
  getAvailableUpdateVersion,
  getPendingUpdateVersion,
  getUpdateUiState,
  installPendingUpdate,
  setupAutoUpdater,
  startDownload,
  type UpdateUiState,
} from './updater/index.js';
import { registerBridge, sendProgress, sendServiceStatus, type ShellOps } from './bridge/register.js';
import { registerTrustedSender } from './bridge/senderGuard.js';
import type { ShellStatus } from './bridge/contract.js';
import { discoverModels, testConnection } from './onboarding/connection.js';
import { applyDefaultPermission, saveConnectionToService } from './onboarding/dshConfig.js';
import { buildNpmInstallArgs, DSH_NPM_REGISTRY, DSH_NPM_REGISTRY_FALLBACK, dshBinPath, dshEntryJsPath, findGlobalDsh, parseNpmFetchLine } from './install/dshPackage.js';
import { ensureWinTerminalInspector } from './install/winInspectorPlugin.js';
import { seedProfileFromBundled, finalizeSeedSettings } from './install/seedProfile.js';
import { extractRuntimes } from './install/extractRuntimes.js';
import { tryRestorePreservedDshHome, tryRestoreBackupDshHome } from './install/restorePreservedDshHome.js';
import { BUNDLED_DSH_PLUGINS, ensureBundledDshPlugins, isolatedBundledNames } from './install/bundledDshPlugins.js';
import { listPlugins, setPluginEnabled, setPluginRemoved } from './plugins/pluginManager.js';
import { createRescueEngine, runDiagnosers, type RescueEvent } from './vendor-rescue/index.js';
import { collectKnownPlugins, createDshIsolator, dshDiagnosers, sanitizePatchForRestore } from './vendor-rescue/dsh/index.js';
import { ensureNodeRuntime, type NodeRuntime } from './runtime/nodeProvision.js';
import { callRpc } from './service/rpc.js';
import {
  DESKTOP_CSS,
  DRAG_BAR_SCRIPT,
  FLOATING_CONTROLS_SCRIPT,
  PAGE_THEME_CSS,
  PAGE_THEME_SCRIPT,
  VIEW_TAB_SCRIPT,
} from './window/desktopChrome.js';
import { CODEX_SKIN_CSS } from './window/codexSkin.js';
import { FILE_PATH_EXTENSION_SCRIPT, FILE_PATH_SELECTABLE_CSS } from './window/filePathExtension.js';
import { resolveFilePath } from './files/path.js';
import { buildLocateSessionScript, isDshAppUrl } from './window/locate.js';
import { normalizeWindowBounds } from './window/bounds.js';
import { buildCompactPayload, describeCompactFeedback, parseCurrentSessionId } from './commands/compact.js';
import { openRepairSession, type RepairContext } from './commands/repairSession.js';
import { writeDiagnosticReport, reportDirFor } from './commands/diagnosticReport.js';
import { backupDshHome } from './backup/backup.js';
import { describeShortcutRegistration, GLOBAL_TOGGLE_SHORTCUT, matchShortcut } from './shortcuts/shortcuts.js';
import { isAllowedNavigationUrl } from './window/navigation.js';
import {
  freshTracker,
  markSent,
  stallDecision,
  updateTracker,
  type StallFrame,
  type StallTrackerState,
} from './watchdog/stall.js';
import {
  appendNotificationEntry,
  clearNotificationHistory,
  readNotificationHistory,
} from './notify/history.js';
import {
  normalizeWorkspaceRows,
  projectAgentsPath,
  resolveWorkspacePath,
} from './prompt/projectInstructions.js';
import { aggregateSessionUsage } from './usage/sessionUsage.js';
import {
  buildDesktopPatchYaml,
  cordisPatchPath,
  desktopDshHome,
  globalAgentsPath,
  normalizePromptConfig,
} from './prompt/promptSettings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 壳安装目录（exe 所在目录）；dsh-home 落这里，实现「壳 exe + dsh + 数据三样同目录」。
 * 打包版 = exe 目录；开发版（未打包）= 项目源码根（app.getAppPath），避免写进 electron dist 目录 */
function shellInstallDir(): string {
  return app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath();
}

/** 内置插件源目录：打包版用 app.asar.unpacked（真实文件系统，fs.cpSync 可复制）——
 *  Electron 的 asar 虚拟文件系统只支持只读操作，cpSync 从 app.asar 复制必然 ENOENT
 * （2026-08-23 真机：pre-sync failed → 内置插件没同步）。开发版回退源码树 plugins/。 */
function bundledPluginsSourceRoot(): string {
  if (app.isPackaged) {
    const unpacked = join(dirname(app.getAppPath()), 'app.asar.unpacked', 'plugins');
    return existsSync(unpacked) ? unpacked : join(app.getAppPath(), 'plugins');
  }
  return join(app.getAppPath(), 'plugins');
}

// [兼容] Chromium 沙箱在部分磁盘的 ACL 环境（如用户的 E 盘）会初始化失败，应用一启动就闪退（退出码 -36861）。
// 禁用沙箱以彻底兼容任意安装路径（实测：同一 exe 在 C 盘正常、E 盘崩；加 --no-sandbox 后 E 盘正常）。
// 本壳只加载本机 DSH 服务（127.0.0.1），contextIsolation + nodeIntegration:false 仍保留 renderer 隔离。
app.commandLine.appendSwitch('no-sandbox');

// [安全审查 P3 兜底] 全局导航护栏：所有 webContents（含未来新增的窗口）一律只放行
// 壳本地页（file:// 指向 pages）与本机 DSH 服务（127.0.0.1）；其余导航/弹窗全部拦截。
// 主窗口的局部 will-navigate 护栏更细（文件拖放、开发截图），全局护栏补「新窗口漏挂」的兜底。
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (isAllowedNavigationUrl(url)) return;
    if (url.startsWith('file://')) return; // 壳本地页（loadFile 程序化加载不走 will-navigate，这里只放行页面内导航）
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)([:\/]|$)/.test(url)) return { action: 'deny' };
    if (/^https?:\/\//.test(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });
});

// 开发模式（未打包）：壳数据（配置/日志/自备 Node 运行时）落源码树 dev-userdata，
// 与打包版 %APPDATA%/deepseek-harness-starter 完全隔离——测试不污染正式数据，改动全留在源码文件夹内。
if (!app.isPackaged) app.setPath('userData', join(app.getAppPath(), 'dev-userdata'));

// ---------------------------------------------------------------------------
// 常量（架构文档 §4：稳定边界；persona/身份经 home patch $DSH_HOME/cordis.patch.yml 热重载注入）
// ---------------------------------------------------------------------------
const GUIDE_PAGE = join(__dirname, 'pages', 'guide.html');
const PORT_PROMPT_PAGE = join(__dirname, 'pages', 'port-prompt.html');
const INSTALL_PAGE = join(__dirname, 'pages', 'install-wizard.html');
const ONBOARDING_PAGE = join(__dirname, 'pages', 'onboarding.html');
const LOGS_PAGE = join(__dirname, 'pages', 'logs.html');
const PROMPT_SETTINGS_PAGE = join(__dirname, 'pages', 'prompt-settings.html');
const PRELOAD = join(__dirname, 'bridge', 'preload.cjs');
const ICON = join(__dirname, '..', '..', 'assets', 'icon.png');
/** 白鲸（深色主题用白鲸、浅色用黑鲸；用户拍板） */
const ICON_WHITE = join(__dirname, '..', '..', 'assets', 'icon-white.png');

interface TrayItem {
  id: string;
  title: string;
  order: number;
  click: (ctx: { window: BrowserWindow; restartService: () => void; quit: () => void }) => void;
}

let mainWindow: BrowserWindow | null = null;
/** 应用显示名（窗口标题/托盘/通知；与 package.json productName 一致，[D91] 命名 deepseek-harness-starter） */
const APP_NAME = 'deepseek-harness-starter';
let serviceProcess: ReturnType<typeof spawn> | null = null;
/** 用户是否正在退出（服务自愈时避免退出过程中重启） */
let quitting = false;
/** 壳/用户主动 kill 服务（停止/重启/换端口）时置位：exit 回调据此不再触发崩溃自愈 */
let intentionalKill = false;
/** 服务死亡自愈重试次数（指数退避，就绪后清零） */
let restartAttempts = 0;
/** 坏 YAML 自动回退次数（对抗审查 C3：.bak 也坏/回退无效时防无限递归；就绪后清零） */
let badYamlRestoreAttempts = 0;

/** 插件自救：DSH 启动崩溃时累计 stderr 供诊断（截尾防膨胀），每轮 spawn 前清空 */
let crashStderrBuffer = '';
/** 插件自救：隔离器所需路径（startShell 解析 installDir 后更新，spawn 前有效） */
let rescuePaths: { dshHome: string; dshRuntimeRoot: string } | null = null;
/** 渲染进程崩溃台账（缺口 1：2 分钟窗口 3 次上限，STATUS_BREAKPOINT 杀软特征走 security-guard） */
let renderGoneState: RenderGoneState = { crashes: 0, lastCrashAt: 0 };
/** security-guard 通知节流时间戳（0 = 从未提示；2 分钟窗口内只提示一次） */
let renderGoneNotifiedAt = 0;
/** 插件自救：隔离器工厂（每次新建，纯路径对象；backupRoot 注入 userData 下独立目录——
 *  运行时数据归运行期动态目录，不进 dsh-home 种子）。壳侧持有引用供恢复按钮直调
 *  （恢复是用户手动动作，不经引擎——引擎只管"崩溃 → 处置"）。 */
function rescueIsolator() {
  return createDshIsolator({
    ...(rescuePaths ?? { dshHome: '', dshRuntimeRoot: '' }),
    backupRoot: join(app.getPath('userData'), 'rescue-backups'),
  });
}
/** 插件自救引擎（shell-rescue 独立库，产物由 npm run sync 同步进 vendor-rescue/）：
 *  诊断规则、滑动窗口预算、同插件去重、give-up 会话锁、会话内存隔离台账都在库内；
 *  壳只负责喂崩溃、用内存台账跳过肇事插件并递归恢复，以及用户通知。
 *  隔离不落盘——每次启动新会话重新尝试，插件修复后自动恢复。 */
/** 最近自救事件（[F2] 修复会话注入用；ring buffer 上限 20 条） */
const rescueEventLog: RescueEvent[] = [];
const rescueEngine = createRescueEngine({
  diagnosers: dshDiagnosers,
  isolator: {
    isolate: (plugin) => (rescuePaths
      ? rescueIsolator().isolate(plugin)
      : { ok: false, detail: 'rescue paths not ready' }),
    // [自救修复通道] 透传隔离器的 repair（如清 patch 双挂 insert 块）——不接上则引擎
    // hasRepair=false，duplicate-entry 这类配置错误走不了修复、落回 no-suspect give-up
    repair: (req) => (rescuePaths
      ? (rescueIsolator().repair?.(req) ?? { ok: false, detail: 'repair not supported' })
      : { ok: false, detail: 'rescue paths not ready' }),
    // [隔离=移走] 透传隔离器的 restore（把隔离前备份的插件实体/配置装回运行环境）。
    // 恢复是用户手动动作（弹窗按钮），不经引擎——引擎只管"崩溃 → 处置"。
    restore: (plugin) => (rescuePaths
      ? (rescueIsolator().restore?.(plugin) ?? { ok: false, detail: 'restore not supported' })
      : { ok: false, detail: 'rescue paths not ready' }),
  },
  // 实际重试由壳的递归 startShell 驱动（带窗口句柄），引擎的 restarter 留空
  restarter: { restart: () => undefined },
  // [F2] 修复按钮数据源：收集最近自救事件（诊断摘要），供修复会话注入
  onEvent: (event) => {
    rescueEventLog.push(event);
    if (rescueEventLog.length > 20) rescueEventLog.shift();
  },
});
let restartTimer: NodeJS.Timeout | null = null;

/** 本会话已隔离的内置插件包名（引擎台账 isolatedPluginIds 是会话内存级，不落盘；映射逻辑见 bundledDshPlugins.ts）。 */
function isolatedBundledPackageNames(): string[] {
  return isolatedBundledNames(rescueEngine.isolatedPluginIds);
}

/**
 * 自救隔离成功后的共同动作：跳过该插件并递归 startShell 恢复，让其余功能正常。
 * 不再写持久化隔离名单——隔离是引擎会话内存级的，下次启动自动重新尝试该插件
 * （修复后即可正常加载）。boot 崩溃与 post-ready 崩溃共用同一套收尾。
 */
function applyIsolationAndRestart(win: BrowserWindow, packageName: string): Promise<void> {
  writeLog('shell', `self-rescue isolated plugin: ${packageName} (isolated so far: ${rescueEngine.isolatedPluginIds.join('、')})`);
  emitServiceStatus(win, 'starting', `已自动跳过问题插件 ${packageName}，正在恢复启动…`);
  notifySelfRescue(`检测到插件 ${packageName} 导致运行崩溃，已自动停用并恢复服务`);
  void generateDiagnosticReport({ kind: 'isolated', problem: `插件 ${packageName} 导致运行崩溃，已自动停用（移走，未删除）并恢复服务。`, plugin: packageName });
  return startShell(win);
}

/** 同 startShellInner catch 内使用的变体：重入锁已在位，直调 Inner 避免被锁吞（[自救修复] 同类修复）。 */
function applyIsolationAndRestartInner(win: BrowserWindow, packageName: string): Promise<void> {
  writeLog('shell', `self-rescue isolated plugin: ${packageName} (isolated so far: ${rescueEngine.isolatedPluginIds.join('、')})`);
  emitServiceStatus(win, 'starting', `已自动跳过问题插件 ${packageName}，正在恢复启动…`);
  notifySelfRescue(`检测到插件 ${packageName} 导致启动失败，已自动停用并恢复启动`);
  void generateDiagnosticReport({ kind: 'isolated', problem: `插件 ${packageName} 导致启动失败，已自动停用（移走，未删除）并恢复启动。`, plugin: packageName });
  return startShellInner(win);
}

/**
 * [隔离=移走] 恢复本会话被隔离的插件（用户点弹窗「恢复插件」按钮触发）：
 * 逐个 restore（把隔离前备份的实体/配置装回运行环境）→ 全部成功则清引擎台账并重启服务。
 * 恢复后必须重启：DSH 启动时读 manifest bundles / patch / node_modules，不重启不生效。
 * 任一失败：提示明细、保留备份、不重启（状态未变更，服务照常跑）。
 */
async function restoreIsolatedPlugins(win: BrowserWindow): Promise<void> {
  const plugins = rescueEngine.isolatedPluginIds.map((id) => ({ id }));
  if (plugins.length === 0) return;
  const results: string[] = [];
  let allOk = true;
  for (const plugin of plugins) {
    const result = await (rescueIsolator().restore?.(plugin) ?? { ok: false, detail: 'restore not supported' });
    if (result.ok) {
      results.push(`${plugin.id} ✓`);
    } else {
      allOk = false;
      results.push(`${plugin.id} ✗ ${result.detail ?? 'unknown error'}`);
    }
  }
  if (!allOk) {
    writeLog('shell', `self-rescue restore failed: ${results.join('; ')}`);
    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: '恢复插件失败',
        message: '部分插件未能恢复，备份已保留，可稍后重试。',
        detail: results.join('\n'),
      })
      .catch(() => undefined);
    return;
  }
  writeLog('shell', `self-rescue restored: ${results.join('; ')}`);
  rescueEngine.markHealthy();
  notifySelfRescue(`已恢复 ${plugins.length} 个插件，正在重启服务…`);
  await restartService(win);
}

/** [热挂载失败盲区] 本会话已处理过的热挂载失败包名（防同一包反复触发刷屏）。 */
const hotMountHandled = new Set<string>();

/**
 * [热挂载失败盲区] 服务活着但单插件挂不上（日志 `[dsh-market] hot mount of X failed`）：
 * 进程级自救不触发（服务没死），但插件确实坏了。处置 = 自动隔离（移走，保留备份可恢复）
 * → 重启服务 → 系统通知提醒。隔离器内部有白名单 + 官方保护，失败安全收敛不炸宿主。
 */
async function handleHotMountFailure(win: BrowserWindow, packageName: string): Promise<void> {
  writeLog('shell', `hot mount failed detected: ${packageName}, isolating`);
  const result = await rescueIsolator().isolate({ id: packageName, packageName });
  if (!result.ok) {
    writeLog('shell', `hot mount isolate failed: ${result.detail ?? 'unknown error'}`);
    return;
  }
  notifySelfRescue(`检测到插件 ${packageName} 挂载失败，已自动停用并重启服务（可在弹窗中恢复）`);
  void generateDiagnosticReport({ kind: 'hot-mount-failed', problem: `插件 ${packageName} 热挂载失败（服务存活但插件挂不上），已自动停用（移走，未删除）并重启服务。`, plugin: packageName });
  await restartService(win);
}

/** 服务死亡自愈（[D90]）：曾就绪后崩溃 → 指数退避重启，最多 5 次；超过则回引导页 */
function scheduleServiceRestart(win: BrowserWindow): void {
  restartAttempts += 1;
  if (restartAttempts > 5) {
    writeLog('shell', 'auto-restart gave up after 5 attempts');
    restartAttempts = 0;
    emitServiceStatus(win, 'failed', '服务连续崩溃，已停止自动重试（查看日志排查问题）');
    notifySelfRescue('服务连续多次崩溃，已停止自动重试，请查看日志或使用修复功能');
    // [诊断报告] 最坏情况（插件全挂、DSH 被迫干净启动）：报告已复制到剪贴板 + 落盘，
    // 凭这段文本也能修复 + 恢复之前状态（用户可直接粘贴给 DSH 排错）
    void generateDiagnosticReport({ kind: 'gave-up', problem: '服务连续多次崩溃，已停止自动重试。请根据下方诊断数据定位根因并给出修复步骤。' });
    void loadGuide(win, 'spawn-crash');
    return;
  }
  const delay = Math.min(1000 * 2 ** (restartAttempts - 1), 30000);
  if (restartTimer) clearTimeout(restartTimer);
  emitServiceStatus(win, 'starting', `服务异常退出，正在自动重启（第 ${restartAttempts} 次）…`);
  notifySelfRescue(`服务异常退出，正在自动重启（第 ${restartAttempts} 次）…`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (quitting || win.isDestroyed()) return;
    writeLog('shell', `auto-restart service (attempt ${restartAttempts})`);
    void startShell(win);
  }, delay);
}
let eventSocket: WebSocket | null = null;
let configStore: ConfigStore | null = null;
/** job 状态跟踪器（跨重连存活，[FR-4.1] 断线补偿；评审 C1 修复） */
const moduleJobTracker = new JobTracker();

/** 壳配置（懒初始化：app ready 后才能取 userData 路径） */
function getStore(): ConfigStore {
  configStore ??= new ConfigStore(join(app.getPath('userData'), 'shell-config.json'));
  return configStore;
}

/** 服务状态广播（guide/port-prompt/onboarding 页面订阅 dshShell.onServiceStatus） */
function emitServiceStatus(win: BrowserWindow, status: ShellStatus, detail: string): void {
  sendServiceStatus(win, { status, detail });
}

/**
 * 整窗 Codex 主题（用户拍板：整窗像 Codex/OpenChamber；跟随系统/深色/浅色三态，默认跟随系统）：
 * 走 DSH 官方主题设置（ui-theme namespace，Appearance 行的同一条路），不硬改 DSH 的 CSS；
 * 换肤本身由壳注入的 codexSkin 变量表完成（深浅两套随主题属性切换）。
 * 图标：深色主题 = 白鲸、浅色 = 黑鲸。
 */
function currentUiTheme(): 'system' | 'dark' | 'light' {
  const t = getStore().load().uiTheme;
  return t === 'dark' || t === 'light' ? t : 'system';
}

/** 实际生效主题（system 按操作系统解析） */
function resolveUiTheme(): 'dark' | 'light' {
  const choice = currentUiTheme();
  if (choice === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return choice;
}

/** 主题对应的鲸鱼图标：深色 = 白鲸，浅色 = 黑鲸 */
function themeIcon(): string {
  return resolveUiTheme() === 'dark' ? ICON_WHITE : ICON;
}

/** 主题生效面：窗口底色 + 窗口图标 + 托盘图标（DSH 页面主题经 settings.update 同步） */
function applyDesktopTheme(): void {
  const resolved = resolveUiTheme();
  mainWindow?.setBackgroundColor(resolved === 'dark' ? '#151313' : '#f6f2e8');
  try {
    mainWindow?.setIcon(resolved === 'dark' ? ICON_WHITE : ICON);
    tray?.setImage(resolved === 'dark' ? ICON_WHITE : ICON);
  } catch {
    // 图标替换失败不影响主题
  }
}

function syncDesktopTheme(port: number): void {
  callRpc({
    port,
    method: 'settings.update',
    payload: { ns: 'ui-theme', patch: { preference: currentUiTheme() } },
  })
    .then(() => writeLog('shell', `theme synced to ${currentUiTheme()}`))
    .catch((error: unknown) => writeLog('shell', `theme sync failed: ${String(error)}`));
}

/**
 * 主题单一事实源 = DSH 官方"外观"设置（用户拍板：设置放官方设置里）：
 * 启动时读取 DSH 的 ui-theme 偏好并记住，壳的窗口底色/图标/本地页全部跟随它；
 * 用户在官方设置里改主题 → 下次启动壳自动采用（无需壳自己的外观选项）。
 */
function adoptThemeFromDsh(port: number): void {
  callRpc({ port, method: 'settings.describe', payload: { ns: 'ui-theme' } })
    .then((value) => {
      const described = value as { value?: { preference?: unknown } } | null | undefined;
      const preference = described?.value?.preference;
      if (preference === 'dark' || preference === 'light' || preference === 'system') {
        const store = getStore();
        const config = store.load();
        if (config.uiTheme !== preference) {
          config.uiTheme = preference;
          store.save(config);
          applyDesktopTheme();
          writeLog('shell', `theme adopted from DSH: ${preference}`);
        }
      }
    })
    .catch(() => undefined); // 读不到就保持壳自己的配置，不阻塞启动
}

// ---------------------------------------------------------------------------
// 日志落盘（§8.3：壳日志 + 服务 stdout/stderr；§8.5：凭据脱敏）
// ---------------------------------------------------------------------------
function writeLog(kind: 'shell' | 'service', text: string): void {
  try {
    const file = logFile(app.getPath('userData'), kind === 'shell' ? 'shell.log' : 'service.log');
    mkdirSync(dirname(file), { recursive: true });
    // 长驻托盘：日志超 5MB 轮转一次（.old 覆盖式），防止无限增长
    maybeRotateLog(file);
    for (const line of String(text).split(/\r?\n/)) {
      if (!line) continue;
      appendFileSync(file, `${redact(buildLogLine('info', line))}\n`, 'utf8');
    }
  } catch {
    // 日志失败不影响主流程
  }
}

// ---------------------------------------------------------------------------
// 壳扩展注册表（[FR-6.2]：内置项也走注册表，自证可增删改）
// ---------------------------------------------------------------------------
const trayItems = new Registry<TrayItem>();

trayItems.register({
  id: 'open',
  title: '打开窗口',
  order: 10,
  click: ({ window }) => {
    window.show();
    window.focus();
  },
});

trayItems.register({
  id: 'restart',
  title: '重启服务',
  order: 20,
  click: ({ restartService }) => restartService(),
});

trayItems.register({
  id: 'compact',
  title: '压缩上下文',
  order: 25,
  click: ({ window }) => {
    // [FR-27] 常用指令一键入口：/compact 斜杠命令（session.prompt 官方通道），结果回显在会话里
    void runCompactCommand(window);
  },
});

trayItems.register({
  id: 'backup',
  title: '备份数据',
  order: 28,
  click: ({ window }) => {
    // [整合包调研] 数据备份：一键把 dsh-home 配置层（含会话）备份到用户选择的位置
    void runBackup(window);
  },
});

trayItems.register({
  id: 'settings',
  title: '设置',
  order: 35,
  click: ({ window }) => {
    // [FR-16.1] 设置 = DSH 应用内设置（用户拍板：与 DSH 设置放一起）；打不开才回独立页
    void openInAppSettings(window);
  },
});

trayItems.register({
  id: 'quit',
  title: '退出',
  order: 50,
  click: ({ quit }) => quit(),
});

trayItems.register({
  id: 'check-updates',
  title: '检查更新',
  order: 45,
  click: () => {
    // [FR-27] 手动检查更新：打包版走发布通道，结果以进度窗/通知回执
    checkForUpdatesManually();
  },
});

// [O1] 已下载待安装版本时显示（rebuildTrayMenu 按 getPendingUpdateVersion() 过滤 + 动态标题）
trayItems.register({
  id: 'install-update',
  title: '安装更新',
  order: 44,
  click: () => {
    installPendingUpdate();
  },
});

trayItems.register({
  id: 'help',
  title: '帮助',
  order: 46,
  click: () => {
    // [FR-21] 帮助入口：打开 GitHub README（安装/使用/开发说明都在里面）
    void shell.openExternal('https://github.com/sryimnoob123/dsh-starter#readme');
  },
});

// ---------------------------------------------------------------------------
// 服务生命周期（§5）
// ---------------------------------------------------------------------------
function probePort(port: number): Promise<'dsh' | 'occupied' | 'free'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  return fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
    .then(async (res) => {
      const html = await res.text();
      return classifyProbe({ status: 'ok', html });
    })
    .catch((error: unknown) => {
      // 超时/半开端口（连接建立但无响应）= 不确定，按"占用"处理，避免误判 free 后 spawn 撞端口；
      // 只有连接被明确拒绝（ECONNREFUSED）才算真空闲
      const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      return classifyProbe({ status: aborted ? 'error' : 'refused' });
    })
    .finally(() => clearTimeout(timer));
}

function updateTrayState(): void {
  if (tray) {
    const running = serviceProcess !== null;
    tray.setToolTip(running ? `${APP_NAME} — 服务运行中` : `${APP_NAME} — 服务已停止`);
    // [O1] 待装版本变化时重建菜单（托盘「安装更新 vX」动态出现/消失）
    if (mainWindow && !mainWindow.isDestroyed()) rebuildTrayMenu(mainWindow);
  }
}

/** 把更新按钮界面状态推给 DSH 页面右上角按钮（新增/进度/可装）：
 *  页面加载晚于状态变化时，did-finish-load 后补推 getUpdateUiState()。 */
function pushUpdateUi(state: UpdateUiState): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents
    .executeJavaScript(`window.__dshSetUpdateState && window.__dshSetUpdateState(${JSON.stringify(state)})`)
    .catch(() => undefined);
}

let tray: Tray | null = null;

/** 托盘菜单模板：install-update 项仅在“有已下载待装版本”时出现 */
function buildTrayTemplate(win: BrowserWindow): Electron.MenuItemConstructorOptions[] {
  return trayItems
    .list()
    .filter((item) => item.id !== 'install-update' || getPendingUpdateVersion() !== null)
    .map((item) => ({
      label: item.id === 'install-update' ? '安装更新（已下载）' : item.title,
      click: () => item.click({ window: win, restartService: () => void restartService(win), quit: () => app.quit() }),
    }));
}

/** 重建托盘菜单（待装版本变化、服务状态变化时调用；[O1] 动态「安装更新」入口） */
function rebuildTrayMenu(win: BrowserWindow): void {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(buildTrayTemplate(win)));
}

function setupTray(win: BrowserWindow): void {
  tray = new Tray(themeIcon());
  rebuildTrayMenu(win);
  tray.on('click', () => {
    win.show();
    win.focus();
  });
  updateTrayState();
}

// ---------------------------------------------------------------------------
// 事件流订阅 + 通知（§4.4/§8.2；WebSocket 主通道 [D71]，重连即对齐 catch-up）
// ---------------------------------------------------------------------------
/** WebSocket 连接世代（重连去重：只有最新一代的 close 定时器才真正重连，防 socket 堆积） */
let eventSocketGen = 0;

function subscribeEvents(port: number): void {
  // 已订阅时跳过（retry 重跑启动序列会再次进入本函数，避免重复通知）
  if (eventSocket && eventSocket.readyState === WebSocket.OPEN) return;
  const gen = ++eventSocketGen;
  eventSocket = new WebSocket(`ws://127.0.0.1:${port}/api/events.mux`);
  // 连接失败/被拒（如服务重启空窗期 ECONNREFUSED）→ 交给 close 重连，别变未捕获异常
  eventSocket.on('error', () => { /* 忽略；close 事件会触发重连 */ });
  // job 状态跟踪器跨重连存活（评审 C1：重连后仍能补发断线期间终态的 job，
  // 首次连接才是基线回放）；jobState 不再在 subscribeEvents 内重建
  const jobState = moduleJobTracker;

  // [FR-17.8] 壳侧独立卡住看门狗：帧流即活动；有任务且 5 分钟无帧 → 一级提醒，
  // 3 分钟后二级升级；断线时清空状态（壳观察不到 = 不误报，重连后重新计时）
  const trackFrame = (frame: MuxFrame): void => {
    const sessionId = (frame as { sessionId?: string }).sessionId;
    if (typeof sessionId !== 'string') return;
    const now = Date.now();
    const prev = stallTrackersGlobal.get(sessionId) ?? freshTracker(now);
    const next = updateTracker(prev, frame as StallFrame, now);
    if (next.running) stallTrackersGlobal.set(sessionId, next);
    else stallTrackersGlobal.delete(sessionId); // 任务终态：回收，防 Map 无限增长
  };

  eventSocket.on('message', (data) => {
    try {
      // 新 mux 协议：所有帧包在 server-request 信封里，真正的帧在 payload（mux.ts）
      const frame = unwrapMuxEnvelope(JSON.parse(String(data))) as MuxFrame;
      trackFrame(frame);
      if (frame.type === 'session/jobs') {
        const terminal = jobState.apply(frame);
        for (const job of terminal) {
          writeLog('shell', `terminal job ${job.status} for ${frame.sessionId}`);
          notify({
            type: 'result',
            sessionId: frame.sessionId,
            title: job.status === 'failed' || job.status === 'killed' ? '任务失败' : '任务完成',
          });
        }
        return;
      }
      const candidate = classifyEvent(frame);
      if (candidate) notify(candidate);
    } catch {
      // 忽略无法解析的帧
    }
  });

  eventSocket.on('close', () => {
    stallTrackersGlobal.clear();
    // 断开 → 2s 后自动重连（浏览器同款指数退避的简化，[FR-25.5]）；
    // 世代守卫：期间若已有更新一代的 socket（重连/重跑启动），本定时器作废
    setTimeout(() => {
      if (serviceProcess && gen === eventSocketGen) subscribeEvents(port);
    }, 2000);
  });

  ensureStallWatchdog();
}

/** [FR-17.8] 每会话活动状态（订阅闭包与巡检共用；模块级唯一实例） */
const stallTrackersGlobal = new Map<string, StallTrackerState>();

/** 看门狗巡检（单例定时器，30s 判定一次；不随重连重复创建） */
let stallTimer: NodeJS.Timeout | null = null;
function ensureStallWatchdog(): void {
  if (stallTimer) return;
  stallTimer = setInterval(() => {
    void checkStalls();
  }, 30_000);
}

function checkStalls(): void {
  const now = Date.now();
  for (const [sessionId, state] of stallTrackersGlobal) {
    const decision = stallDecision(state, now);
    if (decision.kind === 'none') continue;
    stallTrackersGlobal.set(sessionId, markSent(state, decision.level));
    if (getStore().load().notifications?.result === false) continue;
    showActionNotice(
      decision.level === 1
        ? '任务可能卡住：会话已 5 分钟无活动，先看看是不是正常的长任务。'
        : '会话已 8 分钟无活动，请到窗口查看是否卡住。',
    );
  }
}

function nativePluginAllowsResultNotification(): boolean {
  const config = getStore().load();
  return config.notifications?.result !== false;
}

async function notify(candidate: { type: 'result'; sessionId: string; title: string }): Promise<void> {
  if (!Notification.isSupported()) return;
  if (!nativePluginAllowsResultNotification()) return;
  const n = new Notification({ title: APP_NAME, body: candidate.title });
  n.on('click', () => {
    // 唤起窗口；主界面已加载时定位到对应会话：写入 dsh.sessions.current 后 reload，
    // DSH 启动恢复契约会切到该会话（window/locate.ts）。壳本地页（file://）只唤起窗口。
    const win = mainWindow;
    if (!win) return;
    win.show();
    win.focus();
    if (candidate.sessionId && isDshAppUrl(win.webContents.getURL())) {
      win.webContents
        .executeJavaScript(buildLocateSessionScript(candidate.sessionId))
        .catch(() => undefined);
    }
  });
  n.show();
  // [D31] 通知历史：所有任务结果通知落盘（脱敏后），托盘"通知"可回看
  try {
    appendNotificationEntry(app.getPath('userData'), {
      time: Date.now(),
      title: APP_NAME,
      body: redact(candidate.title),
    });
  } catch {
    // 历史落盘失败不影响通知本身
  }
}

/** 托盘快捷操作的反馈通知（用户主动点击的即时回执，不受任务结果通知开关影响） */
function showActionNotice(body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title: APP_NAME, body }).show();
  try {
    appendNotificationEntry(app.getPath('userData'), { time: Date.now(), title: APP_NAME, body: redact(body) });
  } catch {
    // 历史落盘失败不影响通知本身
  }
}

/** 自救/自动重启提示节流：同一会话内至少间隔 8s，避免循环自救时刷屏 */
let lastRescueNoticeAt = 0;
function notifySelfRescue(body: string): void {
  const now = Date.now();
  if (now - lastRescueNoticeAt < 8000) return;
  lastRescueNoticeAt = now;
  if (!Notification.isSupported()) return;
  new Notification({ title: APP_NAME, body, silent: true }).show();
  try {
    appendNotificationEntry(app.getPath('userData'), { time: Date.now(), title: APP_NAME, body: redact(body) });
  } catch {
    // 历史落盘失败不影响通知本身
  }
}

/**
 * [诊断报告] 任何检测到的问题都生成三段式诊断报告（问题段 + 状态段 + 指令段）：
 * 自动复制到剪贴板 + 落盘 userData/diagnostic-reports/（环形保留 20 份）。
 * 最坏情况（插件全挂、DSH 被迫干净启动）下，凭这段文本也能修复 + 恢复之前状态。
 * 返回报告文本（供弹窗/通知引用），失败返回 null（不阻断自救主流程）。
 */
async function generateDiagnosticReport(input: {
  kind: string;
  problem: string;
  plugin?: string;
}): Promise<string | null> {
  try {
    const result = writeDiagnosticReport({
      ...input,
      ctx: await collectRepairContext(mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
      reportDir: reportDirFor(app.getPath('userData')),
      copy: (text) => clipboard.writeText(text),
    });
    if (result.ok) {
      writeLog('shell', `diagnostic report written: ${result.filePath}`);
      return result.text;
    }
    writeLog('shell', `diagnostic report failed: ${result.error}`);
    return null;
  } catch (error) {
    writeLog('shell', `diagnostic report error: ${String(error)}`);
    return null;
  }
}

/** 从 DSH 页面 localStorage 读当前会话 id（与通知定位同一契约；非 DSH 页面 → null） */
async function readCurrentSessionId(win: BrowserWindow): Promise<string | null> {
  try {
    if (!isDshAppUrl(win.webContents.getURL())) return null;
    const raw = (await win.webContents.executeJavaScript(
      'localStorage.getItem("dsh.sessions.current")',
    )) as unknown;
    return parseCurrentSessionId(typeof raw === 'string' ? raw : null);
  } catch {
    return null;
  }
}

/** 现查当前会话的工作区根 cwd（session.list 按 sessionId 匹配）；失败/缺失 → undefined */
async function resolveCurrentSessionCwd(win: BrowserWindow): Promise<string | undefined> {
  const sessionId = await readCurrentSessionId(win);
  if (!sessionId) return undefined;
  const port = getStore().load().port ?? 3080;
  try {
    const value = await callRpc({ port, method: 'session.list', payload: {} });
    const items = (value as { items?: unknown } | null | undefined)?.items;
    const list = Array.isArray(items) ? items : [];
    for (const item of list as Array<{ sessionId?: unknown; cwd?: unknown }>) {
      if (item?.sessionId === sessionId && typeof item.cwd === 'string' && item.cwd !== '') {
        return item.cwd;
      }
    }
  } catch {
    // session.list 失败：相对路径无法定位，调用方按"相对路径原样"兜底
  }
  return undefined;
}

/** [FR-27] 托盘"压缩上下文"：session.prompt 发 /compact 斜杠命令（DSH 宿主执行，不进模型轮次） */
async function runCompactCommand(win: BrowserWindow): Promise<void> {
  const sessionId = await readCurrentSessionId(win);
  if (!sessionId) {
    showActionNotice('没有当前会话：先打开一个会话，再执行压缩。');
    return;
  }
  const port = getStore().load().port ?? 3080;
  try {
    const value = await callRpc({ port, method: 'session.prompt', payload: buildCompactPayload(sessionId) });
    writeLog('shell', `compact command accepted for ${sessionId}`);
    const feedback = describeCompactFeedback(value);
    // 已知脆弱点（评审确认）：'No compactable history yet.' 是 DSH command-compact
    // 的英文文案（未版本化的提示文字），仅做中文提示优化；匹配不上就原样展示或给通用文案
    const text = feedback?.text ?? '';
    const body =
      feedback?.kind === 'error'
        ? /busy|忙/i.test(text)
          ? '当前会话正忙，稍后再试。'
          : `压缩未执行：${text}`
        : typeof feedback?.text === 'string' && text.toLowerCase().includes('no compactable history')
          ? '还没有可压缩的历史。'
          : typeof feedback?.text === 'string'
            ? `压缩完成：${text}`
            : '压缩指令已发送，结果会显示在会话里。';
    showActionNotice(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    writeLog('shell', `compact command failed: ${detail}`);
    showActionNotice(`压缩失败：${detail}`);
  }
}

/** [F2] 收集修复会话上下文：cwd + 自救事件摘要 + 隔离插件 + shell/service 日志尾部 + 环境摘要 */
async function collectRepairContext(win: BrowserWindow | null): Promise<RepairContext> {
  const port = getStore().load().port ?? 3080;
  const cwd = win && !win.isDestroyed() ? await resolveCurrentSessionCwd(win) : undefined;
  const rescueSummary = rescueEventLog
    .map((e) => `[${new Date(e.at).toLocaleTimeString()}] ${e.type}${'pluginId' in e ? ` ${e.pluginId}` : ''}${'reason' in e ? ` ${e.reason}` : ''}`)
    .join('\n');
  const isolated = isolatedBundledPackageNames().join('、');
  return {
    cwd,
    rescueSummary: rescueSummary || undefined,
    isolatedPlugins: isolated || undefined,
    // 诊断场景：剥 ANSI + 只留关键行 + 限行数（避免把 TUI 渲染字符和无关日志灌给 DSH）
    shellLogTail: readDiagnosticLogTail(logFile(app.getPath('userData'), 'shell.log')),
    serviceLogTail: readDiagnosticLogTail(logFile(app.getPath('userData'), 'service.log')),
    envSummary: `${APP_NAME} v${app.getVersion()} / 端口 ${port} / profile web`,
  };
}

/** [F2] 修复按钮：一键把诊断摘要 + 日志尾部 + 环境发给 DSH 新开会话，让 DSH 自修，不打断当前对话 */
async function runRepairSession(win: BrowserWindow): Promise<void> {
  const port = getStore().load().port ?? 3080;
  const result = await openRepairSession({
    port,
    ctx: await collectRepairContext(win),
  });
  if (result.ok) {
    showActionNotice(`修复会话已创建（${result.sessionId}），DSH 正在分析诊断数据。`);
  } else {
    showActionNotice(result.error);
  }
}

/** [整合包调研] 数据备份：一键把 dsh-home 配置层（含会话）备份到用户选择的位置 */
async function runBackup(win: BrowserWindow): Promise<void> {
  try {
    const picked = await dialog.showOpenDialog(win, {
      title: '选择备份位置',
      buttonLabel: '备份到此处',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) return;
    const targetRoot = picked.filePaths[0];
    const result = await backupDshHome({ dshHome: desktopDshHome(shellInstallDir()), targetRoot });
    if (result.ok) {
      showActionNotice(`备份完成：${result.backupRoot}（${result.copied} 个文件${result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 项` : ''}）`);
    } else {
      showActionNotice(result.error);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    showActionNotice(`备份失败：${detail}`);
  }
}

// ---------------------------------------------------------------------------
// 启动序列（§5.1）
// ---------------------------------------------------------------------------
/** startShell 重入锁（[审查 B-M2]）：托盘重启 + 设置页重启/连续点击并发时，
 *  只允许一路真正 spawn，其余直接返回——否则双服务实例/孤儿进程 + 端口漂移 */
let startShellInFlight = false;
async function startShell(win: BrowserWindow): Promise<void> {
  if (startShellInFlight) return;
  startShellInFlight = true;
  try {
    await startShellInner(win);
  } finally {
    startShellInFlight = false;
  }
}

async function startShellInner(win: BrowserWindow): Promise<void> {
  const store = getStore();
  const config = store.load();

  // [2026-08-25 修复] dsh-home 可写性检测：数据目录 = 安装目录，装进 Program Files 后
  // 普通用户无写权限，DSH 服务 mkdir 抛 EPERM 起不来（真实用户 v0.4.8 踩到）。
  // 试写探针（不用 accessSync——Windows 上不检查 ACL、管理员下恒通过）。
  // [2026-08-25 修复2] 首启时 dsh-home 可能还不存在（DSH 服务启动后才创建），探针直接
  // 试写会 ENOENT 误报"不可写"。先 mkdirSync 创建——能建出来 = 可写；建不出来抛 EPERM
  // 才是真不可写（VM 实测：per-user 安装首启误弹"数据目录不可写"，根因即此）。
  const dshHomeForWrite = desktopDshHome(shellInstallDir());
  try {
    mkdirSync(dshHomeForWrite, { recursive: true });
  } catch (error) {
    writeLog('shell', `dsh-home create failed: ${String(error)}`);
    emitServiceStatus(win, 'failed', '安装目录无写权限，服务无法启动');
    const admin = isAdmin();
    if (admin) {
      await dialog.showMessageBox(win, {
        type: 'error',
        title: '数据目录不可写',
        message: 'DeepSeek Harness 无法在数据目录创建文件夹。',
        detail: `dsh-home（${dshHomeForWrite}）创建失败，请检查目录权限或磁盘状态。\n\n原因：${String(error)}`,
        buttons: ['知道了'],
      });
    } else {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: '数据目录不可写',
        message: 'DeepSeek Harness 无法在数据目录创建文件夹，服务将无法启动。',
        detail: `dsh-home（${dshHomeForWrite}）位于受保护的系统目录（如 Program Files），普通用户无法写入。\n\n建议重新安装到用户目录（安装时选择「仅为我安装」），或右键本程序选择「以管理员身份运行」。\n\n原因：${String(error)}`,
        buttons: ['重新安装到用户目录', '以管理员身份运行', '退出'],
        defaultId: 0,
        cancelId: 2,
      });
      if (response === 0) {
        await dialog.showMessageBox(win, {
          type: 'info',
          title: '重新安装到用户目录',
          message: '请卸载后重新安装，安装时选择「仅为我安装」（默认目录为 %LOCALAPPDATA%\\Programs）。',
          detail: '重装不会丢失数据（更新/重装会自动备份 dsh-home）。',
        });
        return;
      }
      if (response === 1) {
        shell.openPath(shellInstallDir());
        return;
      }
      app.exit(1);
      return;
    }
    return;
  }
  const writable = checkDirWritable(dshHomeForWrite);
  if (!writable.ok) {
    writeLog('shell', `dsh-home not writable: ${writable.detail}`);
    emitServiceStatus(win, 'failed', '安装目录无写权限，服务无法启动');
    const admin = isAdmin();
    if (admin) {
      // 管理员都写不了：目录 ACL 异常或磁盘只读，直接报错
      await dialog.showMessageBox(win, {
        type: 'error',
        title: '数据目录不可写',
        message: 'DeepSeek Harness 无法在数据目录写入文件。',
        detail: `dsh-home（${dshHomeForWrite}）当前身份也无法写入，请检查目录权限或磁盘状态。\n\n原因：${writable.detail}`,
        buttons: ['知道了'],
      });
    } else {
      // 典型「装进 Program Files」场景：引导重装到用户目录（首选）或提权运行
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: '数据目录不可写',
        message: 'DeepSeek Harness 无法在数据目录写入文件，服务将无法启动。',
        detail: `dsh-home（${dshHomeForWrite}）位于受保护的系统目录（如 Program Files），普通用户无法写入。\n\n建议重新安装到用户目录（安装时选择「仅为我安装」），或右键本程序选择「以管理员身份运行」。\n\n原因：${writable.detail}`,
        buttons: ['重新安装到用户目录', '以管理员身份运行', '退出'],
        defaultId: 0,
        cancelId: 2,
      });
      if (response === 0) {
        // 打开安装器所在位置提示（用户手动重装）
        await dialog.showMessageBox(win, {
          type: 'info',
          title: '重新安装到用户目录',
          message: '请卸载后重新安装，安装时选择「仅为我安装」（默认目录为 %LOCALAPPDATA%\\Programs）。',
          detail: '重装不会丢失数据（更新/重装会自动备份 dsh-home）。',
        });
        return;
      }
      if (response === 1) {
        shell.openPath(shellInstallDir());
        return;
      }
      app.exit(1);
      return;
    }
    return;
  }

  const nodeOk = isNodeOk(process.versions.node);
  // [2026-08-23 调研修正] 生态共识：压缩载荷只在安装器里（NSIS 7z 解压带进度条），
  // 首启零解压。DSH 运行时与种子由安装器直接落到 <安装目录>/dsh 与 dsh-home-seed，
  // 无 bundle 无首启解压（弃用方案 B）。
  // 已装 dsh 的检测位置：优先 config.installDir（历史下载），否则默认「安装目录/dsh」（三样同目录）。
  // 打包内置的 dsh 就落在这里（electron-builder extraFiles → <安装目录>/dsh/node_modules），
  // 所以安装后无需联网下载、直接就能检测到并启动。
  const defaultDshDir = join(shellInstallDir(), 'dsh');
  // 优先 config.installDir（用户手动选过目录）；但若它已失效（目录里没有 dsh），回落内置/默认目录，
  // 避免旧配置指向已删除/损坏的目录、反而盖过打包内置的 dsh 导致误判「未安装」。
  let dshDir = config.installDir !== undefined ? config.installDir : defaultDshDir;
  if (!existsSync(dshBinPath(dshDir)) && existsSync(dshBinPath(defaultDshDir))) {
    dshDir = defaultDshDir;
  }
  const installedBin = dshBinPath(dshDir);
  // [2026-08-25 tgz 归档] 全新安装后 dsh 运行时尚未解压（安装器只带 2 个 tgz），
  // 必须先解压再检测 dsh——否则 dshDetected=false 走引导弹窗卡死（VM 实测 240s 无响应）。
  // 幂等：完成标记 + bin.js 就绪则跳过（零开销）；异步执行不阻塞窗口。
  emitServiceStatus(win, 'starting', '首次启动正在准备插件（约 1-2 分钟）…');
  try {
    const extractResult = await extractRuntimes({ installDir: shellInstallDir() });
    if (extractResult.extracted) writeLog('shell', `first-run archives extracted: ${extractResult.reason}`);
  } catch (error) {
    writeLog('shell', `first-run archives extract FAILED: ${String(error)}`);
  }
  // 检测本机已装 dsh：安装目录的 dsh（npm 安装版/打包内置版）/ PATH 里的全局 dsh。
  // 注意：不能看 process.cwd()/package.json——壳的 cwd 继承自启动它的进程，与 DSH 是否已装无关，会误判。
  const globalDsh = findGlobalDsh(process.platform, process.env.PATH ?? '', existsSync);
  // 本地 dsh 判据 = .bin shim 与真正用于启动的 lib/bin.js 都齐全（只认 .cmd 而 bin.js 缺失时 spawn 必失败）
  const hasLocalDsh = existsSync(installedBin) && existsSync(dshEntryJsPath(dshDir));
  const dshDetected = hasLocalDsh || globalDsh;

  // managed 模式：只有「本地（安装目录/内置）没有、但 PATH 里有全局 dsh」才弹窗问用哪个。
  // 内置 dsh 直接就用，不弹「检测到已装一份」的框（打包后每次启动都问会很烦）。
  if (dshDetected && !hasLocalDsh && config.installDir === undefined && config.dshChoice === undefined) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: '要用哪个 DeepSeek Harness？',
      message: '检测到你电脑上已经装了一份。',
      detail: '「用已装的」直接开始；「下载新的」会下载一份到本应用目录；也可以手动选择已有的安装目录。',
      buttons: ['用已装的', '下载新的到本应用目录', '选择其他目录'],
      defaultId: 0,
      cancelId: 0,
    });
    const store2 = getStore();
    const config2 = store2.load();
    if (response === 0) {
      config2.dshChoice = 'existing';
      store2.save(config2);
      writeLog('shell', 'user chose to reuse existing dsh');
    } else if (response === 1) {
      config2.dshChoice = 'download';
      store2.save(config2);
      writeLog('shell', 'user chose to download a fresh dsh');
      return loadInstallWizard(win);
    } else {
      // 选择其他目录：打开目录选择器，验证后存 installDir 并重跑启动序列
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: '选择已有的 DeepSeek Harness 目录',
        properties: ['openDirectory'],
      });
      if (canceled || filePaths.length === 0) return;
      const dir = filePaths[0] ?? '';
      const entry = dshEntryJsPath(dir);
      if (!existsSync(entry)) {
        await dialog.showMessageBox(win, {
          type: 'error',
          title: '没找到 DeepSeek Harness',
          message: '这个目录里没有 DeepSeek Harness。请选择包含 node_modules/@deepseek-ai/dsh 的目录。',
        });
        return loadInstallWizard(win);
      }
      const store3 = getStore();
      const config3 = store3.load();
      config3.installDir = dir;
      config3.dshChoice = 'existing';
      store3.save(config3);
      writeLog('shell', `manual dsh dir selected: ${dir}`);
      // 重入锁已在位，直调 startShellInner 走完这条启动路径（return startShell 会被锁吞掉）
      return startShellInner(win);
    }
  }

  // 先杀掉旧的壳服务（若有）：否则它占着记住的端口，每次重启都会被探测成"别人的 dsh"而漂到新端口
  let killedOldService = false;
  if (serviceProcess && !serviceProcess.killed) {
    // 主动换服务：exit 回调不再触发自愈（本次启动序列自己负责）
    intentionalKill = true;
    try {
      serviceProcess.kill();
    } catch {
      // 旧进程可能已退出
    }
    serviceProcess = null;
    killedOldService = true;
  }

  emitServiceStatus(win, 'probing', '正在检查服务…');
  let port = config.port ?? 3080;
  let probe = await probePort(port);
  // 刚杀的旧服务释放端口要一点时间；等它（最多 ~3s），避免把"自己的旧服务"误判成别人的 dsh 而漂端口
  if (killedOldService && probe !== 'free') {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      probe = await probePort(port);
      if (probe === 'free') break;
    }
  }
  let decision = decidePort(probe, { remembered: config.port });
  // managed 模式：端口上是别人的 dsh → 自动换空闲端口（不弹窗），逐个探测候选直到找到空闲
  if (decision.action === 'next-free') {
    const candidates = decision.candidatePorts;
    let found = false;
    for (const candidate of candidates) {
      if ((await probePort(candidate)) === 'free') {
        port = candidate;
        decision = { action: 'spawn', port };
        found = true;
        break;
      }
    }
    // 候选全部被占（罕见：多个 dsh / 连续端口被占）→ 回落到询问弹窗，不能静默 spawn 到仍被占的端口
    if (!found) decision = { action: 'ask', candidatePorts: candidates };
  }
  writeLog('shell', `start: node=${process.versions.node} nodeOk=${nodeOk} port=${port} probe=${probe} action=${decision.action}`);

  // 启动门禁（startup.ts，测试锁定）：managed 模式统一过环境门禁，不再复用外部服务
  const gate = decideStartup(decision, { nodeOk, dshDetected });
  switch (gate.kind) {
    case 'guide':
      if (gate.guidance === 'dsh-missing') {
        // 未检测到 DSH → 弹窗给选择：下载新的 / 选择已有目录（不强制下载）
        emitServiceStatus(win, 'stopped', '未检测到 DeepSeek Harness，需要先安装');
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          title: '需要 DeepSeek Harness',
          message: '没有检测到 DeepSeek Harness。',
          detail: '「下载新的」自动下载到本应用目录（需联网）；若你已在别处安装，可选「选择已有目录」指向它。',
          buttons: ['下载新的', '选择已有目录'],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 0) {
          return loadInstallWizard(win);
        }
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
          title: '选择已有的 DeepSeek Harness 目录',
          properties: ['openDirectory'],
        });
        if (canceled || filePaths.length === 0) return;
        const dir = filePaths[0] ?? '';
        const entry = dshEntryJsPath(dir);
        if (!existsSync(entry)) {
          await dialog.showMessageBox(win, {
            type: 'error',
            title: '没找到 DeepSeek Harness',
            message: '这个目录里没有 DeepSeek Harness。请选择包含 node_modules/@deepseek-ai/dsh 的目录。',
          });
          return loadInstallWizard(win);
        }
        const storeMissing = getStore();
        const configMissing = storeMissing.load();
        configMissing.installDir = dir;
        configMissing.dshChoice = 'existing';
        storeMissing.save(configMissing);
        writeLog('shell', `manual dsh dir selected: ${dir}`);
        // 重入锁已在位，直调 startShellInner 走完这条启动路径（return startShell 会被锁吞掉）
        return startShellInner(win);
      }
      emitServiceStatus(win, 'failed', '缺少可用的 Node.js');
      return loadGuide(win, gate.guidance);
    case 'ask':
      emitServiceStatus(win, 'stopped', `端口 ${port} 被其他程序占用`);
      return loadPortPrompt(
        win,
        port,
        decision.action === 'ask' ? decision.candidatePorts : [port + 1, port + 2, port + 3],
      );
    case 'spawn':
      break;
  }

  // spawn（managed 模式：persona 经 home patch `$DSH_HOME/cordis.patch.yml` 注入，热重载即生效，
  // 无需 --patch；$DSH_HOME 统一指向壳自己的 dsh-home，保证提示词/persona 一定被服务读到）
  emitServiceStatus(win, 'starting', '正在启动服务…');
  // [F1 首启播种·阶段1] 必须先于 ensureBundledDshPlugins：ensure 会在 profile 缺失时先建骨架
  // （写 package.json），播种检测到 profile 存在就跳过——顺序反了首启拿不到 106 插件种子。
  // settings 不在本阶段补：DSH 启动会写自己的默认 settings 覆盖（2026-08-23 实测），
  // 阶段2（service ready 后）由 finalizeSeedSettings 补。
  // [P0 数据丢失兜底] 更新可能把 dsh-home（含用户 skill）移进 %TEMP%\dsh-home-preserve；
  // 先尝试恢复，再走种子播种（避免种子覆盖掉找回的数据）。
  // 双通道：NSIS preserve（宏生效时）→ 壳侧备份（宏失效时，2026-08-25 止血补丁）。
  const dshHomeForRestore = desktopDshHome(shellInstallDir());
  const preserveRestore = tryRestorePreservedDshHome(dshHomeForRestore);
  if (preserveRestore.restored) {
    writeLog('shell', `user data restored from preserve: ${preserveRestore.detail}`);
  } else {
    const backupRestore = tryRestoreBackupDshHome(dshHomeForRestore);
    if (backupRestore.restored) {
      writeLog('shell', `user data restored from backup: ${backupRestore.detail}`);
    }
  }
  // [2026-08-25 修复] 首启播种改异步（fs.promises.cp），主进程不被阻塞、窗口保持响应；
  // 播种期间给用户进度提示，避免"无响应"误判（真实用户"win11 打不开"根因）。
  // 解压（extractRuntimes）已前移到 startShellInner 开头 dsh 检测之前——全新安装时
  // 必须先解压出 dsh 运行时，dshDetected 才能判 true（否则走引导弹窗卡死）。
  const firstRunSeed = await seedProfileFromBundled({ installDir: shellInstallDir() });
  if (firstRunSeed.seeded) writeLog('shell', `first-run seed applied: ${firstRunSeed.reason}`);
  // [2026-08-26 修复] pnpm store 漂移检测必须放在播种（seedProfileFromBundled）**之后**：
  // 全新安装时播种才把 web profile（含 .modules.yaml，带打包机盘符 storeDir/virtualStoreDir）
  // 落盘——在此之前检测 profileDir 不存在 → 判"不漂移" → autoFix 不触发 → 带 E:\ 路径的
  // 种子直接进 DSH → 两个插件市场（dshmarket/webui-market）跑 pnpm 全崩（2026-08-26 实测）。
  // autoFix 无条件执行（不依赖盘符漂移判断——storeDir 是用户目录路径不随安装盘变化，且目标机
  // pnpm 默认 store 由用户全局配置决定；autoFix 内部比对 storeDir ≠ 目标默认才改写 + 删
  // virtualStoreDir）。弹窗只在 autoFix 无法安全修复（有异盘链接）且用户未点过"不再提示"时出。
  {
    const profileDir = join(desktopDshHome(shellInstallDir()), 'profiles', 'web');
    const autoFixed = autoFixStoreDrift(profileDir);
    if (autoFixed) {
      writeLog('shell', `pnpm store drift auto-fixed (storeDir rewritten + virtualStoreDir removed)`);
    } else {
      const drift = detectStoreDrift(profileDir);
      if (drift.drifted && !config.storeDriftDismissed) {
        writeLog('shell', `pnpm store drift detected: old=${drift.oldStore} currentDrive=${drift.currentDrive}`);
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          title: '检测到应用目录已迁移',
          message: '插件安装可能无法使用（pnpm store 路径已变化）。',
          detail: `检测到应用从 ${drift.oldDrive}: 盘迁移到了 ${drift.currentDrive}: 盘，插件依赖的 pnpm store 路径已变化，安装插件会报错。\n\n修复方法：在设置 → 插件市场里重装插件，或手动在 profile 目录执行 \`pnpm install --force\` 重建依赖。`,
          buttons: ['知道了', '不再提示'],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 1) {
          const storeDrift = getStore();
          const configDrift = storeDrift.load();
          configDrift.storeDriftDismissed = true;
          storeDrift.save(configDrift);
        }
      }
    }
  }
  // Plugins must be synchronized before DSH boots; its client plugin table is read only at startup.
  try {
    ensureBundledDshPlugins({
      dshHome: desktopDshHome(shellInstallDir()),
      dshRuntimeRoot: dshDir, quarantined: isolatedBundledPackageNames(),
      sourceRoot: bundledPluginsSourceRoot(),
    });
    writeLog('shell', 'bundled DSH plugins synchronized before service spawn');
  } catch (error) {
    writeLog('shell', `bundled DSH plugin pre-sync failed: ${String(error)}`);
  }
  const usingInstalled =
    // [安全审查 P1] DSH_COMMAND 是开发调试注入面（可被环境变量指向任意命令 + shell:true 放大）：
    // 打包版一律忽略，只认安装目录/内置 dsh（process.env.DSH_COMMAND 仅开发模式生效）
    (process.env.DSH_COMMAND === undefined || !app.isPackaged) && existsSync(installedBin);
  let spec: SpawnSpec;
  if (usingInstalled) {
    // npm 安装版（快启动）：自备/自下载 Node 直跑编译好的 DSH CLI（不依赖系统 node/npm）
    const runtime = await ensureNodeRuntime({
      userData: app.getPath('userData'),
      onProgress: (detail) => emitServiceStatus(win, 'starting', detail),
    });
    spec = buildNodeSpawnSpec({
      nodeExe: runtime.nodeExe,
      dshEntry: dshEntryJsPath(dshDir),
      port,
    });
  } else {
    // PATH 全局 dsh（若用户选了"用已装的"）：走系统 PATH 的 dsh 命令
    spec = buildSpawnSpec({
      port,
      command: process.env.DSH_COMMAND,
    });
  }
  const child = spawn(spec.command, spec.args, {
    cwd: process.cwd(),
    env: buildSpawnEnv({
      base: process.env,
      // managed 统一 DSH_HOME = 壳安装目录下的 dsh-home（壳 exe + dsh + 数据三样同目录），即改即用、不依赖外部 ~/.dsh
      dshHome: desktopDshHome(shellInstallDir()),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    // shell 由 SpawnSpec 决定：node 直跑 false（kill 杀得到真进程），dsh.cmd/pnpm 才 true
    shell: spec.shell ?? false,
  });
  // spawn 本身失败（node 被占用/杀软拦截/路径被删/cmd 缺失）→ Node emit 'error'（exit 可能不触发）。
  // 无监听会抛未捕获异常闪退，击穿自愈链（rescue/scheduleServiceRestart 都依赖 exit/readyPromise）。
  // 这里只做立即清理；readyPromise 的 reject 在 executor 内（error 时 fail），避免挂到硬超时才判失败。
  const handleSpawnError = (error: Error): void => {
    writeLog('shell', `dsh spawn failed: ${error.message}`);
    if (serviceProcess === child) {
      serviceProcess = null;
      emitServiceStatus(win, 'failed', `启动失败：${error.message}`);
      updateTrayState();
    }
  };
  child.on('error', handleSpawnError);
  serviceProcess = child;
  crashStderrBuffer = '';
  // profile 缺 pnpm-workspace.yaml 会让 pnpm 解析进壳根 workspace，market 装插件必炸
  // （ERR_PNPM_UNEXPECTED_VIRTUAL_STORE）；预置/分发来的 profile 跳过了 dsh 的 init，启动时兜底补齐
  const installDir = shellInstallDir();
  const healedProfiles = ensureProfilePnpmWorkspaces(desktopDshHome(installDir));
  if (healedProfiles.length > 0) writeLog('shell', `profile pnpm-workspace healed: ${healedProfiles.join('、')}`);
  // 自救引擎的隔离器路径随本轮 installDir 解析结果更新
  rescuePaths = { dshHome: desktopDshHome(installDir), dshRuntimeRoot: dshDir };

  let ready = false;
  let probeTimer: NodeJS.Timeout | null = null;
  let readyTimeout: NodeJS.Timeout | null = null;
  let hardTimeout: NodeJS.Timeout | null = null;
  const readyPromise = new Promise<void>((resolve, reject) => {
    let buffer = '';
    const markReady = (): void => {
      if (ready) return;
      ready = true;
      if (probeTimer) {
        clearInterval(probeTimer);
        probeTimer = null;
      }
      if (readyTimeout) {
        clearTimeout(readyTimeout);
        readyTimeout = null;
      }
      if (hardTimeout) {
        clearTimeout(hardTimeout);
        hardTimeout = null;
      }
      resolve();
    };
    const fail = (error: Error): void => {
      if (ready) return;
      if (probeTimer) {
        clearInterval(probeTimer);
        probeTimer = null;
      }
      if (readyTimeout) {
        clearTimeout(readyTimeout);
        readyTimeout = null;
      }
      if (hardTimeout) {
        clearTimeout(hardTimeout);
        hardTimeout = null;
      }
      reject(error);
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      writeLog('service', text);
      crashStderrBuffer = (crashStderrBuffer + text).slice(-8000);
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseReadyUrlLine(line);
        if (parsed && parsed.port === port) {
          markReady();
          return;
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      writeLog('service', text);
      crashStderrBuffer = (crashStderrBuffer + text).slice(-8000);
      // [热挂载失败盲区] 服务活着但单插件挂不上（如撞槽/版本不兼容）：进程级自救不触发，
      // 用户只看到 HARNESS 横幅报错。检测日志特征 → 自动隔离（移走）→ 重启 → 提醒。
      // 同一包只处理一次（防刷屏）；隔离器内部有白名单+官方保护，失败安全收敛。
      // 缺口 2 扩展：scanHotMountLine 覆盖 hot mount / client-modules loaded without
      // registering / loader entry 三种形态（纯函数，白名单防穿越）。
      for (const line of text.split(/\r?\n/)) {
        const hit = scanHotMountLine(line);
        if (hit && !hotMountHandled.has(hit.packageName)) {
          hotMountHandled.add(hit.packageName);
          void handleHotMountFailure(win, hit.packageName);
        }
      }
    });
    // spawn 失败立即判失败（不挂到 5 分钟硬超时）：error 与 exit 都可能触发，双双接线到 fail
    child.on('error', (error) => {
      if (!ready) fail(new Error(`dsh spawn failed: ${error.message}`));
    });
    child.on('exit', (code) => {
      const intentional = intentionalKill;
      intentionalKill = false;
      if (!ready) fail(new Error(`dsh exited with code ${code}`));
      // 竞态防护：只有"自己仍是当前服务"时才清全局引用/改状态——
      // startShell/restartService 杀掉旧服务并 spawn 新服务后，旧进程的 exit 不能清掉新服务的引用
      if (serviceProcess === child) {
        serviceProcess = null;
        emitServiceStatus(win, 'stopped', '服务已停止');
        updateTrayState();
      }
      // 服务死亡自愈（[D90]）：曾就绪后崩溃 → 指数退避自动重启；启动期崩溃走上面的 reject。
      // 壳/用户主动 kill（停止/重启）不算崩溃，不重启。
      if (ready && !quitting && !intentional) {
        // [自救扩展] post-ready 崩溃（端口 ready 但插件树加载阶段崩，如 dsh-mobile 版本不兼容）：
        // 先前置诊断——只有命中并认得出肇事插件才喂引擎，避免非插件崩溃（no-diagnosis）锁死会话，
        // 阻断后续所有自救。隔离成功则持久化名单 + 递归恢复，否则回落到退避重启。
        const knownPlugins = collectKnownPlugins({
          bundled: BUNDLED_DSH_PLUGINS,
          dshHome: desktopDshHome(shellInstallDir()),
        });
        const crash = { phase: 'post-ready', stderr: crashStderrBuffer, knownPlugins } as const;
        if (runDiagnosers(dshDiagnosers, crash)?.suspect) {
          void (async () => {
            const outcome = await rescueEngine.reportCrash(crash);
            writeLog('shell', `self-rescue (post-ready) outcome: ${JSON.stringify(outcome)}`);
            if (outcome.action === 'isolated' && outcome.packageName !== undefined) {
              writeLog('shell', `post-ready crash isolated: ${outcome.packageName}, restarting shell`);
              await applyIsolationAndRestart(win, outcome.packageName);
              return;
            }
            // 未隔离（预算耗尽/已隔离过/诊断无肇事）→ 维持原退避重启
            scheduleServiceRestart(win);
          })();
        } else {
          scheduleServiceRestart(win);
        }
      }
    });
    // 端口就绪兜底：服务可能早就监听并响应了，但 ready URL 行晚到/被截断 → 直接探端口，更快更可靠。
    // 只要端口上能取到 DSH 首页（__DSH_BOOT__）就视为就绪。
    probeTimer = setInterval(() => {
      if (ready) return;
      void probePort(port)
        .then((p) => {
          if (p === 'dsh') markReady();
        })
        .catch(() => undefined);
    }, 500);
    // 冷启动（首次建 dsh-home 要下载/链接 profiles 依赖）可能超过 90s，但服务仍在跑、只是慢，
    // 所以 90s 不判失败，只提示"仍在启动"，继续靠端口探测兜底；只有进程真的退出才判失败。
    // 硬上限 5 分钟（真卡死才失败），避免"上来报失败、过一会又恢复"的误报。
    readyTimeout = setTimeout(() => {
      if (!ready) {
        writeLog('shell', `service still starting after 90s (port ${port}), keep probing`);
        emitServiceStatus(win, 'starting', '服务仍在启动中，请稍候…');
      }
    }, 90_000);
    hardTimeout = setTimeout(() => {
      if (!ready) fail(new Error('readiness timeout (5 min)'));
    }, 300_000);
  });

  try {
    await readyPromise;
    config.port = port;
    store.save(config);
    writeLog('shell', `service ready on port ${port}`);
    restartAttempts = 0;
    badYamlRestoreAttempts = 0;
    // [F1 首启播种·阶段2] DSH 已完成初始化（不会再覆盖 settings）→ 补种子的完整配置
    // （皮肤/主题/权限/模型引用/插件配置；API key 用户自配）→ 删 dsh-home-seed 残留。
    const seedFinal = finalizeSeedSettings({ installDir: shellInstallDir() });
    if (seedFinal.applied) writeLog('shell', `first-run settings seeded: ${seedFinal.reason}`);
    // [2026-08-26 瘦身] 播种完成后删 dsh-archives（2 个 tgz + 校验文件，~124M）：
    // runtime 已解压到 dsh/node_modules、seed 已播种，归档不再需要。删除后下次启动
    // extractRuntimes 走 no-archives 分支（幂等标记缺失但归档也缺失 → 静默跳过，不重解）。
    // 必须放在 finalizeSeedSettings 之后（seed 播种完成才删），且只删归档不碰 dsh-home。
    try {
      rmSync(join(shellInstallDir(), 'dsh-archives'), { recursive: true, force: true });
      writeLog('shell', 'dsh-archives removed after seeding (slim)');
    } catch (error) {
      writeLog('shell', `dsh-archives cleanup failed: ${String(error)}`);
    }
    try {
      ensureBundledDshPlugins({
        dshHome: desktopDshHome(shellInstallDir()),
        dshRuntimeRoot: dshDir, quarantined: isolatedBundledPackageNames(),
        sourceRoot: bundledPluginsSourceRoot(),
      });
      writeLog('shell', 'bundled DSH plugins synchronized into runtime node_modules and web profile');
    } catch (error) {
      writeLog('shell', `bundled DSH plugin sync failed: ${String(error)}`);
    }

    // [bugfix] win32 首次启动：把捆绑的 win-terminal-inspector 插件装进 web profile，
    // 修掉 DSH 在 Windows 上 spawnTerminal 抛 "terminal inspection is unsupported on platform win32" 的缺口。
    // 服务就绪后 profile 已初始化；patch 写入走 DSH 的 HMR 热加载，无需重启。装一次记一次（可逆、不打扰）。
    if (process.platform === 'win32' && !config.winTerminalInspectorInstalled) {
      try {
        const installed = ensureWinTerminalInspector({
          dshHome: desktopDshHome(shellInstallDir()),
          sourceDir: join(app.getAppPath(), 'vendor', 'win-terminal-inspector'),
        });
        if (installed) writeLog('shell', 'win-terminal-inspector plugin installed into web profile');
        config.winTerminalInspectorInstalled = true;
        store.save(config);
      } catch (error) {
        // 装失败不阻塞启动；下次启动会重试（flag 未置位）
        writeLog('shell', `win-terminal-inspector install failed: ${String(error)}`);
      }
    }
    // [O2-A] 新会话默认权限 = danger-full-access（持久终端开箱即用，用户拍板）。
    // 服务就绪后 settings 可用；只写一次（permissionDefaultApplied 记账），失败下次启动重试，
    // 成功后用户手改（回 workspace-write/其它）壳不再覆盖。
    if (!config.permissionDefaultApplied) {
      applyDefaultPermission(port)
        .then((changed) => {
          config.permissionDefaultApplied = true;
          store.save(config);
          writeLog('shell', changed ? 'permission default set to danger-full-access' : 'permission default already set, recorded');
        })
        .catch((error: unknown) => {
          writeLog('shell', `permission default apply failed: ${String(error)}`);
        });
    }
    if (config.onboardingDone) {
      await loadUrl(win, `http://127.0.0.1:${port}`);
    } else {
      await loadOnboarding(win);
    }
    // 自救成功：若本次启动隔离过肇事插件，通知用户（其余功能正常），随后清空引擎窗口状态
    if (rescueEngine.isolatedPluginIds.length > 0) {
      const names = rescueEngine.isolatedPluginIds.join('、');
      writeLog('shell', `self-rescue recovered after isolating: ${names}`);
      rescueEngine.markHealthy();
      void dialog
        .showMessageBox(win, {
          type: 'warning',
          title: '已自动修复启动问题',
          message: `已自动跳过导致崩溃的插件：${names}`,
          detail: '软件其余功能正常。插件已从运行环境移走（未删除），可立即恢复；若仍崩溃建议重装或卸载。\n\n点「复制诊断报告」把诊断信息复制到剪贴板，粘贴给 AI 即可排错。',
          buttons: ['知道了', '恢复插件', '复制诊断报告'],
          defaultId: 0, // 安全默认：不误触恢复/复制
        })
        .then(({ response }) => {
          if (response === 1) void restoreIsolatedPlugins(win);
          else if (response === 2) {
            // [排错] 复制诊断报告到剪贴板，用户自己粘贴给 AI（不自动发会话）
            void generateDiagnosticReport({ kind: 'isolated', problem: `插件 ${names} 导致启动失败，已自动停用（移走，未删除）并恢复启动。` })
              .then((text) => {
                showActionNotice(text ? '诊断报告已复制到剪贴板，粘贴给 AI 即可排错。' : '诊断报告生成失败，请查看日志。');
              });
          }
        })
        .catch(() => undefined);
    }
    emitServiceStatus(win, 'running', `服务已启动（端口 ${port}）`);
    subscribeEvents(port);
    adoptThemeFromDsh(port);
    updateTrayState();
  } catch (error) {
    writeLog('shell', `spawn failed: ${String(error)}`);
    // 插件自救（shell-rescue）：诊断 → 窗口预算决策 → 隔离 → 自动重试；放弃则走原回落
    const knownPlugins = collectKnownPlugins({
      bundled: BUNDLED_DSH_PLUGINS,
      dshHome: desktopDshHome(shellInstallDir()),
    });
    const outcome = await rescueEngine.reportCrash({ phase: 'boot', stderr: crashStderrBuffer, knownPlugins });
    writeLog('shell', `self-rescue outcome: ${JSON.stringify(outcome)}`);
    if (outcome.action === 'repaired') {
      // [自救修复通道] 配置错误（如 patch 双挂）已自动修复：直接重启服务，不弹引导页。
      // 此处仍处于 startShellInner 的 catch（重入锁已在位），直调 startShellInner 而非
      // startShell——否则被 startShellInFlight 吞掉，修复后的重启静默丢弃
      writeLog('shell', `self-rescue repaired ${outcome.repairKind} (${outcome.target}), restarting shell`);
      emitServiceStatus(win, 'starting', `已自动修复启动问题（${outcome.target}），正在恢复启动…`);
      notifySelfRescue(`已自动修复启动问题（${outcome.target}），正在恢复启动…`);
      return startShellInner(win);
    }
    if (outcome.action === 'isolated' && outcome.packageName !== undefined) {
      // 同 catch 内：直调 applyIsolationAndRestart 内部用 startShellInner 重启（重入锁已在持有）
      writeLog('shell', `self-rescue isolated: ${outcome.packageName}, restarting shell`);
      emitServiceStatus(win, 'starting', `已自动隔离问题插件 ${outcome.packageName}，正在恢复启动…`);
      notifySelfRescue(`检测到插件 ${outcome.packageName} 导致启动失败，已自动停用并恢复启动`);
      return applyIsolationAndRestartInner(win, outcome.packageName);
    }
    // [坏 YAML 自动回退] 插件问题/管理操作可能写坏 cordis.patch.yml（YAML 解析失败 → DSH 起不来）。
    // 检测到 YAML 错误特征 → 用写前备份（cordis.patch.yml.bak）自动恢复 → 重启。
    // 备份由独立库隔离器/repair 每次改写前生成；回退前净化（剔除已隔离插件的 insert 块，
    // 防 module-not-found 继续崩）；无备份则走原 give-up 回落。
    if (/YAMLException|failed to parse overlay|bad indentation|unexpected end of the stream/i.test(crashStderrBuffer)) {
      const dshHome = desktopDshHome(shellInstallDir());
      const patchPath = join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
      const bakPath = `${patchPath}.bak`;
      // 对抗审查 C3 防护：.bak 也坏/恢复无效时（坏的是其他 overlay 等），最多回退 3 次，
      // 超限转 give-up 引导页——否则 return startShellInner 无限递归，restartAttempts 不覆盖此路径
      badYamlRestoreAttempts += 1;
      if (existsSync(bakPath) && badYamlRestoreAttempts <= 3) {
        writeLog('shell', `bad yaml detected, restoring from backup: ${bakPath} (attempt ${badYamlRestoreAttempts})`);
        const bakText = readFileSync(bakPath, 'utf8');
        const sanitized = sanitizePatchForRestore({ dshHome, dshRuntimeRoot: dshDir }, bakText);
        writeFileSync(patchPath, sanitized ?? bakText, 'utf8');
        emitServiceStatus(win, 'starting', '检测到配置文件损坏，已自动恢复备份，正在重启…');
        notifySelfRescue('检测到配置文件损坏，已自动恢复备份，正在重启…');
        return startShellInner(win);
      }
      writeLog('shell', `bad yaml restore gave up after ${badYamlRestoreAttempts} attempts (backup exists: ${existsSync(bakPath)})`);
    }
    if (rescueEngine.isolatedPluginIds.length > 0) {
      emitServiceStatus(win, 'failed', `启动失败（已自动停用 ${rescueEngine.isolatedPluginIds.length} 个问题插件仍无法启动）：${String(error)}`);
    } else {
      emitServiceStatus(win, 'failed', `启动失败：${String(error)}`);
    }
    // [最坏场景] DSH 起不来、壳进不去：也要生成诊断报告（剪贴板 + 落盘），
    // 用户凭报告文本就能发给 AI 排错——不依赖 DSH 服务
    void generateDiagnosticReport({ kind: 'spawn-crash', problem: `服务启动失败：${String(error)}` });
    loadGuide(win, 'spawn-crash');
  }
}

/** 窗口位置/尺寸记忆（细化文档 FR-1）：套用上次持久化的状态（脏数据经 bounds.ts 归一） */
function applySavedBounds(win: BrowserWindow): void {
  const saved = getStore().load().window;
  const bounds = normalizeWindowBounds(saved, { width: 1280, height: 800, maximized: false });
  win.setBounds({ width: bounds.width, height: bounds.height });
  if (bounds.maximized) win.maximize();
}

/** 移动/缩放/最大化 → 500ms 防抖后落盘（normalBounds 记录还原尺寸，maximized 记录状态） */
function watchBounds(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const persist = (): void => {
    timer = null;
    if (win.isDestroyed()) return;
    const store = getStore();
    const config = store.load();
    const normal = win.getNormalBounds();
    config.window = { width: normal.width, height: normal.height, maximized: win.isMaximized() };
    store.save(config);
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, 500);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: APP_NAME,
    icon: themeIcon(), // 官方鲸鱼图标（[D14]；深色主题 = 白鲸、浅色 = 黑鲸）
    // [D83]/[D84] 深色无边框 + 整体自绘标题栏（Codex 同款结构）；三态主题：
    // 窗口底色跟随实际生效主题，避免加载/切换瞬间出现突兀色块
    backgroundColor: resolveUiTheme() === 'dark' ? '#151313' : '#f6f2e8',
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  // [IPC sender 校验] 注册主窗口为可信 sender（安全审查 P0-2）；窗口关闭时注销
  const unregisterSender = registerTrustedSender(win.webContents.id);
  win.on('closed', () => unregisterSender());
  // [FR-1] 窗口位置/尺寸记忆：启动套用上次状态，移动/缩放/最大化防抖落盘
  applySavedBounds(win);
  watchBounds(win);
  win.on('close', (event) => {
    // 关窗缩托盘（[FR-3.1]）：应用不退出、服务继续；
    // 但用户从托盘「退出」（app.quit）时 quitting=true，必须放行——否则 quit 被这里的
    // preventDefault 拦下、进程残留占用文件（删不掉/打包锁的根因）。
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  // 导航护栏：文件拖放由 DSH 页面自己的 drop 区处理；拖到区外若被当导航会
  // 离开壳面，这里拦住（只放行 127.0.0.1；loadFile/loadURL 程序化加载不受影响）。
  // 开发调试（DSH_DEV_ALLOW_FILE=1，默认关闭）：页面导航到壳本地页时，由主进程
  // 代用 loadFile 加载（绕过 Chromium 对 http→file 导航的封锁），供自跑验收截图。
  win.webContents.on('will-navigate', (event, url) => {
    writeLog('shell', `will-navigate: ${url}`);
    if (isAllowedNavigationUrl(url)) return;
    // 开发调试（DSH_DEV_ALLOW_FILE=1，默认关闭；打包版强制忽略——安全审查 P1）：
    // 壳本地页之间互跳放行，供自跑验收逐页截图（http→file 仍被 Chromium 拦，由下方主进程代载）
    const devAllowFile = !app.isPackaged && process.env.DSH_DEV_ALLOW_FILE === '1';
    if (
      devAllowFile &&
      url.startsWith('file://') &&
      win.webContents.getURL().startsWith('file://')
    ) {
      return;
    }
    if (devAllowFile && url.startsWith('file://')) {
      event.preventDefault();
      try {
        const target = new URL(url);
        const query: Record<string, string> = {};
        for (const [key, value] of target.searchParams) query[key] = value;
        void win.loadFile(fileURLToPath(target), { query });
      } catch {
        // 解析失败：保持拦截
      }
      return;
    }
    event.preventDefault();
  });
  // 弹窗护栏：DSH 页面里的 window.open / target=_blank 一律不弹系统浏览器或额外壳窗口。
  // 内部 web UI（127.0.0.1/localhost）静默关闭——内容已在壳窗口，不重复弹出（对应「webui 藏起来」）；
  // 外部 http(s) 链接走系统默认浏览器（只有用户主动点击才到这里）。
  win.webContents.setWindowOpenHandler(({ url }) => {
    writeLog('shell', `window-open intercepted: ${url}`);
    if (/^https?:\/\/(127\.0\.0\.1|localhost)([:\/]|$)/.test(url)) return { action: 'deny' };
    if (/^https?:\/\//.test(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });
  // 右键菜单：Electron 默认不提供原生右键菜单，这里补上复制/粘贴/剪切/全选/撤销重做
  win.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      );
    } else if (params.selectionText.trim().length > 0) {
      template.push({ role: 'copy', label: '复制' });
    }
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: win });
    }
  });
  // 无标题栏（用户拍板）：右上角悬浮窗口按钮（设置/最小化/最大化/关闭）统一注入所有页面；
  // DSH 页面：应用自身 header 做拖拽区 + 深色细滚动条 + Codex 换肤变量表（深浅两套）。
  // 壳本地页：顶部透明拖拽条 + 主题初始化脚本（?uiTheme=）+ 深浅滚动条/悬浮按钮变量。
  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    writeLog('shell', `did-finish-load: ${url}`);
    if (url.startsWith('file://')) {
      win.webContents.executeJavaScript(PAGE_THEME_SCRIPT).catch(() => undefined);
      win.webContents.executeJavaScript(FLOATING_CONTROLS_SCRIPT).catch(() => undefined);
      win.webContents.executeJavaScript(DRAG_BAR_SCRIPT).catch(() => undefined);
      win.webContents.insertCSS(PAGE_THEME_CSS).catch(() => undefined);
    } else if (url.startsWith('http://127.0.0.1')) {
      // 先注入悬浮控制脚本（定义 window.__dshSetUpdateState），完成后补推更新按钮当前状态——
      // 页面加载晚于 update-available/download 的兜底，保证右上角"新版本"可见
      win.webContents
        .executeJavaScript(FLOATING_CONTROLS_SCRIPT)
        .catch(() => undefined)
        .then(() => pushUpdateUi(getUpdateUiState()));
      win.webContents.executeJavaScript(DRAG_BAR_SCRIPT).catch(() => undefined);
      win.webContents.executeJavaScript(VIEW_TAB_SCRIPT).catch(() => undefined);
      win.webContents.insertCSS(DESKTOP_CSS).catch(() => undefined);
      win.webContents.insertCSS(CODEX_SKIN_CSS).catch(() => undefined);
      // 文件路径动作（右键菜单/直接打开/框选复制，[FR-11.1] 壳承接）
      win.webContents.executeJavaScript(FILE_PATH_EXTENSION_SCRIPT).catch(() => undefined);
      win.webContents.insertCSS(FILE_PATH_SELECTABLE_CSS).catch(() => undefined);
    }
  });
  // [缺口 1] 渲染进程崩溃：自动 reload（2 分钟内最多 3 次）→ 停手提示；
  // STATUS_BREAKPOINT（0x80000003）是安全软件/调试器打断特征 → 提示杀软类文案、不自动 reload。
  // 退出路径（quitting/窗口已销毁）一律不干预——webContents.reload 在销毁后调用会抛异常（审查 C1）
  win.webContents.on('render-process-gone', (_event, details) => {
    if (quitting || win.isDestroyed()) return;
    const { decision, nextState } = decideRenderGone(renderGoneState, details, Date.now());
    renderGoneState = nextState;
    if (decision.kind === 'ignore') return;
    if (decision.kind === 'security-guard') {
      writeLog('shell', `renderer gone (security guard suspect, exit ${details.exitCode}): ${details.reason}`);
      // 节流：2 分钟窗口内只提示一次，防杀软持续断点刷屏（审查 I1）
      if (renderGoneNotifiedAt === 0 || Date.now() - renderGoneNotifiedAt > RENDER_GONE_WINDOW_MS) {
        renderGoneNotifiedAt = Date.now();
        notifySelfRescue('界面渲染进程被安全软件/调试器打断，已停止自动恢复。请检查杀毒软件是否拦截，或重新打开窗口。');
      }
      return;
    }
    if (decision.kind === 'give-up') {
      writeLog('shell', `renderer gone ${nextState.crashes} times in 2min, giving up auto reload: ${details.reason}`);
      notifySelfRescue('界面连续多次崩溃，已停止自动恢复。请使用修复功能或查看日志。');
      return;
    }
    writeLog('shell', `renderer gone, reloading: ${details.reason}`);
    win.webContents.reload();
  });
  return win;
}

function loadUrl(win: BrowserWindow, url: string): Promise<void> {
  return win.loadURL(url).catch(() => loadGuide(win, 'spawn-crash'));
}

/** 壳本地页统一 query：lang + uiTheme（实际生效主题，页面据此初始化） */
function pageQuery(): Record<string, string> {
  return { lang: 'zh', uiTheme: resolveUiTheme() };
}

function loadGuide(win: BrowserWindow, guidance: string): Promise<void> {
  return win.loadFile(GUIDE_PAGE, { query: { ...pageQuery(), guidance } }).catch(() => undefined);
}

/** 端口冲突询问页（[FR-25.3]：候选端口 + 用户选择后记住） */
function loadPortPrompt(win: BrowserWindow, occupied: number, candidates: number[]): Promise<void> {
  return win
    .loadFile(PORT_PROMPT_PAGE, {
      query: { ...pageQuery(), port: String(occupied), candidates: candidates.join(',') },
    })
    .catch(() => loadGuide(win, 'port-occupied'));
}

/** 安装向导页（[FR-22.5]；页面由外包交付，占位版保证入口可达） */
function loadInstallWizard(win: BrowserWindow, step = 'ask'): Promise<void> {
  return win
    .loadFile(INSTALL_PAGE, { query: { ...pageQuery(), step } })
    .catch(() => loadGuide(win, 'dsh-missing'));
}

/** 首启向导页（[FR-21.1]：首次服务就绪后显示；页面缺失时退回主界面） */
function loadOnboarding(win: BrowserWindow): Promise<void> {
  return win
    .loadFile(ONBOARDING_PAGE, { query: { ...pageQuery(), step: 'welcome' } })
    .catch(() => loadUrl(win, `http://127.0.0.1:${getStore().load().port ?? 3080}`));
}

/** 日志页（[D21] 托盘入口；页面缺失时退回打开日志目录） */
function loadLogsPage(win: BrowserWindow): Promise<void> {
  return win
    .loadFile(LOGS_PAGE, { query: { ...pageQuery(), log: 'shell' } })
    .catch(() => {
      shell.openPath(join(app.getPath('userData'), 'logs')).catch(() => undefined);
    });
}

/** 设置页（[FR-16.1] 提示词管理分组；独立页仅作 DSH 应用内设置打不开时的回落） */
function loadPromptSettings(win: BrowserWindow): Promise<void> {
  return win.loadFile(PROMPT_SETTINGS_PAGE, { query: pageQuery() }).catch(() => undefined);
}

/** 打开 DSH 应用内设置（用户拍板：设置与 DSH 自身设置放一起）；失败回落独立设置页 */
function openInAppSettings(win: BrowserWindow): void {
  if (!isDshAppUrl(win.webContents.getURL())) {
    void loadPromptSettings(win);
    return;
  }
  win.webContents
    .executeJavaScript(
      `(function () {
        const hit = [...document.querySelectorAll('button,[role=button],a')].find(
          (b) => /^\\s*(设置|Settings)\\s*$/.test(b.textContent || ''),
        );
        if (hit) { hit.click(); return true; }
        return false;
      })()`,
    )
    .then((opened) => {
      if (!opened) void loadPromptSettings(win);
    })
    .catch(() => void loadPromptSettings(win));
}

/** 返回对话主界面（设置/日志页"返回对话"；未完成首启向导时回向导） */
function loadMain(win: BrowserWindow): Promise<void> {
  writeLog('shell', 'loadMain called');
  const config = getStore().load();
  if (config.onboardingDone) {
    return loadUrl(win, `http://127.0.0.1:${config.port ?? 3080}`);
  }
  return loadOnboarding(win);
}

/**
 * 重启壳拉起的服务以应用新 patch（[FR-16] 保存并重启）。
 * managed 模式：壳自己拉起，随时可重启；等退出事件或超时后重跑启动序列（端口探测复用同一路径）。
 */
async function restartService(win: BrowserWindow): Promise<void> {
  const child = serviceProcess;
  serviceProcess = null;
  if (child && !child.killed) {
    // 主动重启：exit 回调不再触发自愈（否则与下面的 startShell 竞态出双服务实例）
    intentionalKill = true;
    child.kill();
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      child.once('exit', done);
      setTimeout(done, 2000);
    });
  }
  // 端口释放确认（评审建议）：退出事件后最多再等 5s，让端口真正空闲，
  // 减少 startShell 把刚杀掉的端口误判为占用；仍未空闲时走正常探测分流
  const port = getStore().load().port ?? 3080;
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await probePort(port)) === 'free') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await startShell(win);
}

// ---------------------------------------------------------------------------
// 安装向导流程（[FR-22.5]：询问 → 选目录 → npm 下载安装 → 配置 → 启动）
// 壳驱动：页面按 query step 渲染，按钮回调桥；进度经 onProgress 事件推送
// ---------------------------------------------------------------------------
let installRunning = false;

/**
 * npm install --prefix <目录> @deepseek-ai/dsh。
 * 用 `--loglevel=http` 让 npm 把每次真实下载打到 stderr（`npm http fetch GET 200 <url> … (cache miss)`），
 * 解析它 = 真实进度：每下载一个包 +1，同时显示正在下载的包名（不再用假进度条）。
 * 总量无法预先知道，进度条保持「不确定」动画，但「已下载 N 个包」是真实且单调增长的。
 *
 * 启动方式：优先 node 直跑 npm-cli.js（shell:false）——Windows 下 npm.cmd 经 cmd.exe 按 GBK
 * 解析命令行，中文/空格的前缀路径会被拆坏（实测 `Invalid tag name "测试"`）；node 直跑则 Unicode 安全。
 * npmCli 拿不到时回退 npm.cmd + shell（非中文路径仍可用）。
 */
function runNpmInstall(
  dir: string,
  win: BrowserWindow,
  runtime: NodeRuntime,
  registry: string,
): Promise<number | null> {
  return new Promise((resolve) => {
    const args = [...buildNpmInstallArgs(dir, registry), '--loglevel=http'];
    const useCli = runtime.npmCli !== '' && existsSync(runtime.npmCli);
    const command = useCli ? runtime.nodeExe : runtime.npmCmd;
    const spawnArgs = useCli ? [runtime.npmCli, ...args] : args;
    const child = spawn(command, spawnArgs, {
      shell: useCli ? false : process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let fetched = 0; // 依赖清单（manifest）请求数
    let downloaded = 0; // 实际下载的包（tarball）数
    let currentPkg = '';
    let stderrBuf = '';
    let settled = false;
    const settle = (code: number | null): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(code);
    };
    // 网络挂起兜底（[复查 B-2]）：npm 长时间无输出（断网/镜像卡死）时不永久卡住安装流程，
    // 杀子进程并返回非零（页面 error 步可重试）；超时窗口 10 分钟（npm 全量装 dsh 依赖）
    const timeout = setTimeout(() => {
      writeLog('shell', 'npm install timed out, killing child');
      if (!child.killed) child.kill();
      settle(1);
    }, 10 * 60 * 1000);
    sendProgress(win, { phase: 'install', percent: -1, detail: '正在解析依赖清单…' });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      writeLog('shell', `npm: ${text}`);
      stderrBuf += text;
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() ?? ''; // 最后一段可能跨 chunk，留到下一段拼接
      for (const line of lines) {
        const evt = parseNpmFetchLine(line);
        if (!evt) continue;
        currentPkg = evt.name;
        if (evt.tarball) {
          downloaded += 1;
          sendProgress(win, { phase: 'install', percent: -1, detail: `已下载 ${downloaded} 个包：${currentPkg}` });
        } else {
          fetched += 1;
          sendProgress(win, { phase: 'install', percent: -1, detail: `正在解析依赖清单…已获取 ${fetched} 个包信息` });
        }
      }
    });
    child.stdout?.on('data', (chunk: Buffer) => writeLog('shell', `npm: ${chunk.toString()}`));
    child.on('error', (error) => {
      writeLog('shell', `npm spawn failed: ${String(error)}`);
      settle(null);
    });
    child.on('exit', (code) => {
      settle(code);
    });
  });
}

async function runInstallFlow(win: BrowserWindow, dir: string): Promise<void> {
  if (installRunning) return;
  installRunning = true;
  try {
    await win.loadFile(INSTALL_PAGE, { query: { ...pageQuery(), step: 'download' } });
    // 打包版先确保有可用 Node（没有就自动下载官方发行版），再用它跑 npm 装 DSH
    const runtime = await ensureNodeRuntime({
      userData: app.getPath('userData'),
      onProgress: (detail) => sendProgress(win, { phase: 'download', percent: -1, detail }),
    });
    sendProgress(win, { phase: 'download', percent: -1, detail: `正在下载 DSH 到 ${dir} …` });
    // 默认走 npmmirror（国内镜像，稳定）；失败自动回落官方 registry 重试一次
    let code = await runNpmInstall(dir, win, runtime, DSH_NPM_REGISTRY);
    if (code !== 0) {
      writeLog('shell', `npm install via npmmirror failed (code=${code}), falling back to official registry`);
      sendProgress(win, { phase: 'install', percent: 0, detail: '镜像源下载失败，切换到官方源重试…' });
      code = await runNpmInstall(dir, win, runtime, DSH_NPM_REGISTRY_FALLBACK);
    }
    if (code !== 0) {
      // 页面 error 步自带"重新安装/查看日志"按钮，不再 reload 回 ask
      const detail =
        '安装失败。网络不通时请开启代理后重试；详情见日志。';
      sendProgress(win, { phase: 'error', percent: -1, detail });
      return;
    }
    const store = getStore();
    const config = store.load();
    config.installDir = dir;
    store.save(config);
    writeLog('shell', `dsh installed to ${dir}`);
    sendProgress(win, { phase: 'configure', percent: -1, detail: '安装完成，已记录安装位置。' });
    await win.loadFile(INSTALL_PAGE, { query: { ...pageQuery(), step: 'launch' } });
    sendProgress(win, { phase: 'launch', percent: -1, detail: '正在启动 DSH 服务…' });
    await startShell(win);
    sendProgress(win, { phase: 'done', percent: 100, detail: '完成' });
  } finally {
    installRunning = false;
  }
}

// ---------------------------------------------------------------------------
// 桥操作实现（[D79] 外包包 §2：window.dshShell 的壳侧业务动作）
// ---------------------------------------------------------------------------
const shellOps: ShellOps = {
  retry: async () => {
    writeLog('shell', 'retry op called');
    const win = mainWindow ?? createWindow();
    // onboarding 的"开始使用"= retry：先落完成标记，再走启动序列进主界面
    if (win.webContents.getURL().includes('onboarding.html')) {
      const store = getStore();
      const config = store.load();
      config.onboardingDone = true;
      store.save(config);
      writeLog('shell', 'onboarding finished by user');
    }
    await startShell(win);
  },
  quit: () => app.quit(),
  openLogs: () => {
    shell.openPath(join(app.getPath('userData'), 'logs')).catch(() => undefined);
  },
  readLog: (kind) =>
    readLogTail(logFile(app.getPath('userData'), kind === 'shell' ? 'shell.log' : 'service.log')),
  goInstall: () => {
    const win = mainWindow ?? createWindow();
    void loadInstallWizard(win);
  },
  openPromptSettings: () => {
    // [FR-21] 标题栏齿轮：打开 DSH 应用内设置（功能设置与 DSH 设置放一起）。
    // 开发调试（DSH_DEV_ALLOW_FILE=1，打包版强制忽略——安全审查 P1）：直接加载独立设置页。
    const win = mainWindow ?? createWindow();
    if (!app.isPackaged && process.env.DSH_DEV_ALLOW_FILE === '1') {
      void loadPromptSettings(win);
      return;
    }
    openInAppSettings(win);
  },
  openMain: () => {
    // 设置/通知/日志页的"返回对话"
    writeLog('shell', 'openMain op called');
    const win = mainWindow ?? createWindow();
    void loadMain(win);
  },
  checkForUpdates: () => {
    writeLog('shell', 'checkForUpdates op called');
    // 更新提示条"一键下载/安装"统一入口：已有待装版本 → 确认安装；
    // 有可下载新版本 → 开始下载；都没有 → 检查更新（下载不再自动触发，见 autoDownload=false）
    if (getPendingUpdateVersion()) {
      void installPendingUpdate();
    } else if (getAvailableUpdateVersion()) {
      startDownload();
    } else {
      checkForUpdatesManually();
    }
  },
  choosePort: async (port) => {
    const store = getStore();
    const config = store.load();
    config.port = port;
    store.save(config);
    writeLog('shell', `user chose port ${port}`);
    const win = mainWindow ?? createWindow();
    await startShell(win);
  },
  startInstall: async () => {
    // ask 步"开始安装"→ 直接下载到默认目录（安装目录/dsh，三样同目录），不再让用户选目录
    const win = mainWindow ?? createWindow();
    const defaultDir = join(shellInstallDir(), 'dsh');
    try {
      mkdirSync(defaultDir, { recursive: true });
    } catch {
      // 建不出默认目录不阻塞
    }
    void runInstallFlow(win, defaultDir);
  },
  pickDir: async () => {
    const win = mainWindow ?? createWindow();
    // 默认目录 = 壳安装目录下的 dsh（壳 exe + dsh + 数据三样同目录）；先建好并作为选择器初始位置
    const defaultDir = join(shellInstallDir(), 'dsh');
    try {
      mkdirSync(defaultDir, { recursive: true });
    } catch {
      // 建不出默认目录（权限等）不阻塞：仍可手选
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择 DSH 安装目录',
      defaultPath: defaultDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return '';
    void runInstallFlow(win, filePaths[0] ?? '');
    return filePaths[0] ?? '';
  },
  selectDshDir: async () => {
    // 手动选择已有 dsh 目录（npm 安装版）：用户把 dsh 装在了任意自定义路径时，手动指给壳
    const win = mainWindow ?? createWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择已有的 DeepSeek Harness 目录',
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return { ok: false, message: '已取消。' };
    const dir = filePaths[0] ?? '';
    // 验证目录里有 npm 安装版的 dsh 入口（node_modules/@deepseek-ai/dsh/lib/bin.js）
    const entry = dshEntryJsPath(dir);
    if (!existsSync(entry)) {
      return {
        ok: false,
        message: '这个目录里没找到 DeepSeek Harness。请选择包含 node_modules/@deepseek-ai/dsh 的目录。',
      };
    }
    const store = getStore();
    const config = store.load();
    config.installDir = dir;
    config.dshChoice = 'existing';
    store.save(config);
    writeLog('shell', `manual dsh dir selected: ${dir}`);
    await startShell(win);
    return { ok: true, message: '已使用所选目录的 DeepSeek Harness。' };
  },
  testConnection: (config) => testConnection(config),
  discoverModels: (input) => discoverModels(input),
  windowControl: (action) => {
    const win = mainWindow;
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close(); // close 事件 → 缩托盘（[FR-3.1]）
  },
  pluginList: () => listPlugins(shellInstallDir()),
  pluginSetEnabled: (input) => setPluginEnabled(shellInstallDir(), input.id, input.enabled),
  pluginSetRemoved: (input) => setPluginRemoved(shellInstallDir(), input.id, input.removed),
  troubleshoot: async () => {
    // 引导页「复制诊断报告」：生成三段式诊断报告（剪贴板 + 落盘），用户自己粘贴给 AI 排错。
    // 引导页场景主窗可能是自身（已销毁时用 null，cwd 定位自动跳过）。
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    try {
      const text = await generateDiagnosticReport({ kind: 'spawn-crash', problem: '服务启动失败，请根据下方诊断数据定位根因并给出修复步骤。' });
      return text ? { ok: true } : { ok: false, error: '诊断报告生成失败，请查看日志。' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `复制诊断报告失败：${detail}` };
    }
  },
  saveConnection: async (cfg) => {
    const port = getStore().load().port ?? 3080;
    const result = await saveConnectionToService(port, cfg);
    writeLog('shell', `saveConnection ok=${String(result.ok)}`);
    return result;
  },
  getPromptSettings: () => {
    const config = getStore().load();
    const prompt = normalizePromptConfig(config.prompt);
    const notifyResult = config.notifications?.result ?? true;
    const uiTheme = currentUiTheme();
    const uiThemeResolved = resolveUiTheme();
    const path = globalAgentsPath(shellInstallDir());
    let globalPrompt = '';
    try {
      globalPrompt = readFileSync(path, 'utf8');
    } catch {
      // 文件不存在 = 尚无全局指令
    }
    return {
      mode: 'managed',
      includeHarnessIdentity: prompt.includeHarnessIdentity,
      persona: prompt.persona,
      globalPrompt,
      globalPromptPath: path,
      notifyResult,
      uiTheme,
      uiThemeResolved,
    };
  },
  savePromptSettings: async (input) => {
    // [FR-4.3] 通知开关是壳自己的配置：两种模式下都能保存、即时生效（notify() 每次读取）
    const notifyResult = input.notifyResult;
    const notifyChanged = notifyResult !== undefined;
    if (notifyChanged) {
      const notifyStore = getStore();
      const notifyConfig = notifyStore.load();
      notifyConfig.notifications = { result: notifyResult };
      notifyStore.save(notifyConfig);
    }
    // 主题是壳自己的配置：即时生效（DSH 走官方 ui-theme 三态；窗口/托盘图标同步）
    if (input.uiTheme !== undefined) {
      const themeStore = getStore();
      const themeConfig = themeStore.load();
      themeConfig.uiTheme = input.uiTheme;
      themeStore.save(themeConfig);
      syncDesktopTheme(themeConfig.port ?? 3080);
      applyDesktopTheme();
      writeLog('shell', `ui theme set to ${input.uiTheme} (resolved ${resolveUiTheme()})`);
    }
    try {
      const store = getStore();
      const config = store.load();
      config.prompt = { includeHarnessIdentity: input.includeHarnessIdentity, persona: input.persona };
      store.save(config);
      const agentsPath = globalAgentsPath(shellInstallDir());
      mkdirSync(dirname(agentsPath), { recursive: true });
      // 原子写（tmp + rename）：DSH 正监听 AGENTS.md，半截写入会让 agent 读到损坏指令
      writeFileSync(`${agentsPath}.tmp`, input.globalPrompt, 'utf8');
      renameSync(`${agentsPath}.tmp`, agentsPath);
      // persona 落点 = home patch（$DSH_HOME/cordis.patch.yml）：dsh watchUserPatches 热重载，改完即生效
      const patchPath = cordisPatchPath(shellInstallDir());
      mkdirSync(dirname(patchPath), { recursive: true });
      writeFileSync(
        patchPath,
        buildDesktopPatchYaml({ includeHarnessIdentity: input.includeHarnessIdentity, persona: input.persona }),
        'utf8',
      );
      writeLog(
        'shell',
        `prompt settings saved identity=${input.includeHarnessIdentity} ` +
          `personaBytes=${Buffer.byteLength(input.persona, 'utf8')} globalBytes=${Buffer.byteLength(input.globalPrompt, 'utf8')}`,
      );
    } catch (error) {
      return { ok: false, restarting: false, message: `写入失败：${String(error)}` };
    }
    // persona 写 home patch（cordis.patch.yml）热重载，改完即生效、无需重启；
    // 只有用户显式点「重启并加载」按钮（input.restart）才重启服务
    if (input.restart) {
      const win = mainWindow;
      void restartService(win ?? createWindow());
      return { ok: true, restarting: true, message: '已保存，正在重启服务（会话自动接回）…' };
    }
    return {
      ok: true,
      restarting: false,
      message: '已保存，立即生效。',
    };
  },
  readNotifications: () => readNotificationHistory(app.getPath('userData'), 500),
  clearNotifications: () => clearNotificationHistory(app.getPath('userData')),
  listProjectInstructions: async () => {
    // [FR-16.7] P1：workspace.list 现查工作区（路径/标题），读各自 <path>/AGENTS.md
    const port = getStore().load().port ?? 3080;
    try {
      const value = await callRpc({ port, method: 'workspace.list', payload: {} });
      const rows = normalizeWorkspaceRows(value);
      const items = rows.map((row) => {
        let content = '';
        try {
          content = readFileSync(projectAgentsPath(row.path), 'utf8');
        } catch {
          // 工作区还没有 AGENTS.md = 空内容
        }
        return { workspaceId: row.workspaceId, title: row.title, path: row.path, content };
      });
      return { ok: true, items };
    } catch (error) {
      return {
        ok: false,
        message: `读取工作区失败：${error instanceof Error ? error.message : String(error)}（需要服务在运行）`,
      };
    }
  },
  saveProjectInstruction: async (input) => {
    // 页面只传 workspaceId；路径每次从 workspace.list 现查，桥接不暴露任意文件写入
    const port = getStore().load().port ?? 3080;
    try {
      const value = await callRpc({ port, method: 'workspace.list', payload: {} });
      const path = resolveWorkspacePath(normalizeWorkspaceRows(value), input.workspaceId);
      if (!path) return { ok: false, message: '找不到对应工作区（可能已被删除），刷新后再试。' };
      // 原子写（tmp + rename）：DSH 正监听 AGENTS.md，半截写入会让 agent 读到损坏指令
      const agentsFile = projectAgentsPath(path);
      writeFileSync(`${agentsFile}.tmp`, input.content, 'utf8');
      renameSync(`${agentsFile}.tmp`, agentsFile);
      writeLog('shell', `project instruction saved for ${input.workspaceId} (${path})`);
      return { ok: true, message: '已保存。DSH 会自动同步到该工作区的会话。' };
    } catch (error) {
      return {
        ok: false,
        message: `保存失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  getSessionUsage: async () => {
    // 用量统计（ZCode 式界面）：全部会话累计（[FR-12.2] 全部 token，非单会话）。
    // 数据源 = session.list —— 每个会话行自带 projections（sessionStats + tokenUsage），
    // 遍历累加即可，零壳侧聚合，也无需逐个 session.history。
    const port = getStore().load().port ?? 3080;
    try {
      const value = await callRpc({ port, method: 'session.list', payload: {} });
      const items = (value as { items?: unknown } | null | undefined)?.items;
      const { usage, sessionCount } = aggregateSessionUsage(items);
      return { ok: true, usage, sessionCount };
    } catch (error) {
      return {
        ok: false,
        message: `读取用量失败：${error instanceof Error ? error.message : String(error)}（需要服务在运行）`,
      };
    }
  },
  filePathMenu: async (path) => {
    // [FR-11.1] 对话内文件路径右键：复制路径 / 打开所在位置 / 直接打开文件
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    const cwd = await resolveCurrentSessionCwd(win);
    const resolved = resolveFilePath(cwd, path);
    Menu.buildFromTemplate([
      {
        label: '复制路径',
        click: () => {
          clipboard.writeText(resolved);
        },
      },
      { type: 'separator' },
      {
        label: '打开所在位置',
        click: () => {
          void shell.showItemInFolder(resolved);
        },
      },
      {
        label: '直接打开文件',
        click: () => {
          void shell.openPath(resolved).then((err) => {
            if (err) showActionNotice(`无法打开文件：${err}`);
          });
        },
      },
    ]).popup({ window: win });
  },
  filePathOpen: async (path) => {
    // 左键直接打开：由壳用 shell.openPath（ShellExecute 源=前台壳进程），外部窗口能正常置顶
    // [安全审查 P1-2 纵深防御] 拒绝可执行/脚本扩展名——防「打开 .lnk/.exe 快捷方式 → 执行任意程序」向量
    // （收窄到 Windows 上真正的执行向量；.js/.jar/.sh 打开通常是编辑器/阅读器，不拦）
    const EXEC_EXT = /\.(exe|com|bat|cmd|ps1|vbs|lnk|msi|scr|hta|reg|pif)$/i;
    if (EXEC_EXT.test(path)) {
      writeLog('shell', `openPath blocked: executable extension (${path})`);
      return;
    }
    const win = mainWindow;
    const cwd = win && !win.isDestroyed() ? await resolveCurrentSessionCwd(win) : undefined;
    const resolved = resolveFilePath(cwd, path);
    const errorMessage = await shell.openPath(resolved);
    if (errorMessage) {
      writeLog('shell', `openPath failed: ${errorMessage} (${resolved})`);
      showActionNotice(`无法打开文件：${errorMessage}`);
    }
  },
};

// ---------------------------------------------------------------------------
// 入口（单实例锁，§3.3）
// ---------------------------------------------------------------------------
// 兜底：主进程未捕获异常 / 未处理拒绝 → 先写日志，再让进程按默认行为退出。
// 否则打包版会静默闪退、无法定位（用户反馈：窗口空白后无报错闪退）。
process.on('uncaughtException', (error) => {
  try {
    writeLog('shell', `UNCAUGHT EXCEPTION: ${error instanceof Error ? (error.stack || error.message) : String(error)}`);
  } catch { /* 忽略 */ }
});
process.on('unhandledRejection', (reason) => {
  try {
    writeLog('shell', `UNHANDLED REJECTION: ${reason instanceof Error ? (reason.stack || reason.message) : String(reason)}`);
  } catch { /* 忽略 */ }
});

app.on('before-quit', () => {
  quitting = true;
  // 壳退出时杀掉自己拉起的服务子进程，避免孤儿进程堆积（否则下次启动又起新实例、端口一路涨）
  const child = serviceProcess;
  if (child && !child.killed) {
    try {
      child.kill();
    } catch {
      // 服务进程可能已退出，忽略
    }
    serviceProcess = null;
  }
});

app.on('will-quit', () => {
  // 清理看门狗巡检定时器（应用生命周期结束，不留后台定时器）
  if (stallTimer) {
    clearInterval(stallTimer);
    stallTimer = null;
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // app.quit() 在 ready 前调用在 Windows 上不可靠（打包版实测会继续启动，
  // 造成多实例并存）；app.exit 立即退出，不等事件循环
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    // 已在运行时再次双击快捷方式：给明确提醒（而不是静默退出或报错）
    showActionNotice('应用已在运行');
  });
  app.whenReady().then(() => {
    // [通知] Windows toast 横幅需要「开始菜单快捷方式 + AUMID 注册」（安装版由 electron-builder/Squirrel 自动做）。
    // 免安装版没有快捷方式，toast 弹不出横幅；设一个稳定 AUMID 至少让通知进「通知中心」。安装版 Electron 会自动覆盖此值。
    app.setAppUserModelId('com.dshdesktop.app');
    const win = createWindow();
    setupTray(win);
    registerBridge(shellOps);
    setupAutoUpdater({ onPendingChange: updateTrayState, uiTheme: resolveUiTheme, onUiUpdate: pushUpdateUi, configStore: getStore() }); // [D78] 自动检查 + 自动下载（安装用户确认）；[O1] 托盘动态入口 + 进度窗随应用主题 + 右上角按钮状态；[稍后持久化] 壳配置注入
    // [整合包调研] 全局呼出快捷键：Ctrl+Shift+Space 呼出/聚焦窗口（注册失败只记日志，不影响启动）
    if (!globalShortcut.register(GLOBAL_TOGGLE_SHORTCUT, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    })) {
      writeLog('shell', describeShortcutRegistration(false, GLOBAL_TOGGLE_SHORTCUT));
    }
    // [整合包调研] 应用内快捷键：Ctrl+Shift+C/F/B/L → 压缩/修复/备份/日志（只在壳窗口聚焦时生效）
    win.webContents.on('before-input-event', (event, input) => {
      const action = matchShortcut(input);
      if (!action) return;
      // 壳快捷键吃掉按键，不冒泡给 DSH 页面（避免页面同时响应同名组合）
      event.preventDefault();
      if (action === 'compact') void runCompactCommand(win);
      else if (action === 'repair') void runRepairSession(win);
      else if (action === 'backup') void runBackup(win);
      else if (action === 'logs') void loadLogsPage(win);
    });
    // 三态主题：操作系统深浅色变化时只刷新壳自身外观（图标/窗口底色）。
    // 不向 DSH 推送——主题单一事实源是 DSH 官方设置，用户在官方设置里的选择
    // 不能被壳覆盖；DSH 在跟随系统模式下会自行响应 OS 变化。
    nativeTheme.on('updated', () => {
      applyDesktopTheme();
    });
    void startShell(win);
  });
  app.on('window-all-closed', () => {
    // 关窗 ≠ 退出（[FR-2.4]）：托盘驻留，保持运行
  });
}
