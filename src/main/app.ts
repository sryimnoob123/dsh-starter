import { app, BrowserWindow, dialog, Menu, nativeTheme, Notification, shell, Tray } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { ConfigStore } from './config/store.js';
import { classifyProbe, parseReadyUrlLine } from './service/detect.js';
import { decidePort, nextFreeCandidates } from './service/port.js';
import { decideStartup } from './service/startup.js';
import { buildCommandArgs, buildNodeSpawnSpec, buildSpawnEnv, buildSpawnSpec, type SpawnSpec } from './service/spawn.js';
import { isNodeOk } from './service/nodeCheck.js';
import { Registry } from './extensions/registry.js';
import { classifyEvent, type MuxFrame } from './notify/classify.js';
import { diffJobs, type JobStatus } from './events/catchup.js';
import { redact, buildLogLine } from './logging/redact.js';
import { readLogTail } from './logging/readLog.js';
import { logFile } from './logging/paths.js';
import { setupAutoUpdater, checkForUpdatesManually } from './updater/index.js';
import { registerBridge, sendProgress, sendServiceStatus, type ShellOps } from './bridge/register.js';
import type { ShellStatus } from './bridge/contract.js';
import { discoverModels, testConnection } from './onboarding/connection.js';
import { saveConnectionToService } from './onboarding/dshConfig.js';
import { buildNpmInstallArgs, defaultInstallDir, dshBinPath, dshEntryJsPath } from './install/dshPackage.js';
import { ensureNodeRuntime } from './runtime/nodeProvision.js';
import { callRpc } from './service/rpc.js';
import {
  DESKTOP_CSS,
  DSH_HEADER_DRAG_SCRIPT,
  FLOATING_CONTROLS_SCRIPT,
  PAGE_DRAG_SCRIPT,
  PAGE_THEME_CSS,
  PAGE_THEME_SCRIPT,
} from './window/desktopChrome.js';
import { CODEX_SKIN_CSS } from './window/codexSkin.js';
import { SETTINGS_EXTENSION_SCRIPT } from './window/settingsExtension.js';
import { buildLocateSessionScript, isDshAppUrl } from './window/locate.js';
import { normalizeWindowBounds } from './window/bounds.js';
import { buildCompactPayload, describeCompactFeedback, parseCurrentSessionId } from './commands/compact.js';
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
import {
  buildDesktopPatchYaml,
  globalAgentsPath,
  normalizePromptConfig,
} from './prompt/promptSettings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 常量（架构文档 §4：稳定边界；§8.7：桌面基线经 --patch 传入）
// ---------------------------------------------------------------------------
const GUIDE_PAGE = join(__dirname, 'pages', 'guide.html');
const PORT_PROMPT_PAGE = join(__dirname, 'pages', 'port-prompt.html');
const INSTALL_PAGE = join(__dirname, 'pages', 'install-wizard.html');
const ONBOARDING_PAGE = join(__dirname, 'pages', 'onboarding.html');
const LOGS_PAGE = join(__dirname, 'pages', 'logs.html');
const PROMPT_SETTINGS_PAGE = join(__dirname, 'pages', 'prompt-settings.html');
const NOTIFICATIONS_PAGE = join(__dirname, 'pages', 'notifications.html');
const PRELOAD = join(__dirname, 'bridge', 'preload.cjs');
const DEFAULT_PATCH = join(__dirname, '..', '..', 'assets', 'desktop.patch.yml');
const ICON = join(__dirname, '..', '..', 'assets', 'icon.png');
/** 白鲸（深色主题用白鲸、浅色用黑鲸；用户拍板） */
const ICON_WHITE = join(__dirname, '..', '..', 'assets', 'icon-white.png');

interface TrayItem {
  id: string;
  title: string;
  order: number;
  click: (ctx: { window: BrowserWindow; stopService: () => void; quit: () => void }) => void;
}

let mainWindow: BrowserWindow | null = null;
let serviceProcess: ReturnType<typeof spawn> | null = null;
let reuseMode = false;
let eventSocket: WebSocket | null = null;
let configStore: ConfigStore | null = null;

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
  id: 'stop',
  title: '停止服务',
  order: 20,
  click: ({ stopService }) => stopService(),
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
  id: 'logs',
  title: '查看日志',
  order: 30,
  click: ({ window }) => {
    // [D21]：托盘"查看日志"= 壳内日志页（壳日志 + 服务日志），不是打开文件夹
    void loadLogsPage(window);
  },
});

trayItems.register({
  id: 'notifications',
  title: '通知',
  order: 32,
  click: ({ window }) => {
    // [D31] 通知历史中心：错过弹窗也能回看，可一键清空
    void loadNotificationsPage(window);
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
    // [FR-27] 手动检查更新：打包版走发布通道，结果以通知回执
    checkForUpdatesManually();
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
    .catch(() => classifyProbe({ status: 'refused' }))
    .finally(() => clearTimeout(timer));
}

async function stopService(): Promise<void> {
  if (reuseMode) {
    // 复用外部服务：不杀别人的进程（[FR-7.1] 并存），只提示
    new Notification({ title: 'deepseekharness', body: '服务由外部启动，请在原处停止。' }).show();
    return;
  }
  if (!serviceProcess || serviceProcess.killed) return;
  // 确认对话框（架构文档 §5.3 分档文案，[D72]）：硬停可能损坏正在写入的工作区文件
  const options = {
    type: 'warning' as const,
    title: '停止服务',
    message: '确定停止 DeepSeek Harness 服务？',
    detail:
      '任务执行中停止可能损坏正在写入的工作区文件，建议等任务完成或先用 agent 的停止指令。' +
      '会话记录已增量落盘（$DSH_HOME/sessions），重启后可接回。',
    buttons: ['停止服务', '取消'],
    defaultId: 1,
    cancelId: 1,
  };
  const { response } = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) return;
  // Windows 无分发 SIGTERM：V1 = 终止子进程（架构文档 §5.3）
  serviceProcess.kill();
  serviceProcess = null;
  if (mainWindow) emitServiceStatus(mainWindow, 'stopped', '服务已停止');
  updateTrayState();
}

function updateTrayState(): void {
  if (tray) {
    const running = reuseMode || serviceProcess !== null;
    tray.setToolTip(running ? 'deepseekharness — 服务运行中' : 'deepseekharness — 服务已停止');
  }
}

let tray: Tray | null = null;

function setupTray(win: BrowserWindow): void {
  tray = new Tray(themeIcon());
  const menu = Menu.buildFromTemplate(
    trayItems.list().map((item) => ({
      label: item.title,
      click: () => item.click({ window: win, stopService, quit: () => app.quit() }),
    })),
  );
  tray.setContextMenu(menu);
  tray.on('click', () => {
    win.show();
    win.focus();
  });
  updateTrayState();
}

// ---------------------------------------------------------------------------
// 事件流订阅 + 通知（§4.4/§8.2；WebSocket 主通道 [D71]，重连即对齐 catch-up）
// ---------------------------------------------------------------------------
function subscribeEvents(port: number): void {
  // 已订阅时跳过（retry 重跑启动序列会再次进入本函数，避免重复通知）
  if (eventSocket && eventSocket.readyState === WebSocket.OPEN) return;
  eventSocket = new WebSocket(`ws://127.0.0.1:${port}/api/events.mux`);
  const jobState = new Map<string, JobStatus>();

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
      const frame = JSON.parse(String(data)) as MuxFrame;
      trackFrame(frame);
      if (frame.type === 'session/jobs') {
        const terminal = diffJobs(jobState, frame);
        for (const job of terminal) {
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
    // 断开 → 2s 后自动重连（浏览器同款指数退避的简化，[FR-25.5]）
    setTimeout(() => {
      if (reuseMode || serviceProcess) subscribeEvents(port);
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

function notify(candidate: { type: 'result'; sessionId: string; title: string }): void {
  if (!Notification.isSupported()) return;
  // [FR-4.3] 通知类型开关：设置页"通知"组关闭后不再弹（默认开）
  if (getStore().load().notifications?.result === false) return;
  const n = new Notification({ title: 'deepseekharness', body: candidate.title });
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
      title: 'deepseekharness',
      body: redact(candidate.title),
    });
  } catch {
    // 历史落盘失败不影响通知本身
  }
}

/** 托盘快捷操作的反馈通知（用户主动点击的即时回执，不受任务结果通知开关影响） */
function showActionNotice(body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title: 'deepseekharness', body }).show();
  try {
    appendNotificationEntry(app.getPath('userData'), { time: Date.now(), title: 'deepseekharness', body: redact(body) });
  } catch {
    // 历史落盘失败不影响通知本身
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
    const text = describeCompactFeedback(value);
    // 已知脆弱点（评审确认）：'No compactable history yet.' 是 DSH command-compact
    // 的英文文案（未版本化的提示文字），仅做中文提示优化；匹配不上就原样展示或给通用文案
    const body =
      typeof text === 'string' && text.toLowerCase().includes('no compactable history')
        ? '还没有可压缩的历史。'
        : text
          ? `压缩完成：${text}`
          : '压缩指令已发送，结果会显示在会话里。';
    showActionNotice(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    writeLog('shell', `compact command failed: ${detail}`);
    showActionNotice(`压缩失败：${detail}`);
  }
}

// ---------------------------------------------------------------------------
// 启动序列（§5.1）
// ---------------------------------------------------------------------------
async function startShell(win: BrowserWindow): Promise<void> {
  const store = getStore();
  const config = store.load();

  const nodeOk = isNodeOk(process.versions.node);
  const dshCwd = process.env.DSH_CHECKOUT ?? '';
  const installedBin = config.installDir !== undefined ? dshBinPath(config.installDir) : null;
  const dshDetected =
    dshCwd !== '' ||
    existsSync(join(process.cwd(), 'package.json')) ||
    (installedBin !== null && existsSync(installedBin));

  emitServiceStatus(win, 'probing', '正在检查服务…');
  const port = config.port ?? 3080;
  const probe = await probePort(port);
  const decision = decidePort(probe, { remembered: config.port });
  writeLog('shell', `start: node=${process.versions.node} nodeOk=${nodeOk} port=${port} probe=${probe} action=${decision.action}`);

  // 启动门禁（startup.ts，测试锁定）：复用外部服务优先于本地检测——
  // 打包版无 DSH_CHECKOUT 环境变量时，只要端口上是 dsh 服务就直接复用
  const gate = decideStartup(decision, { nodeOk, dshDetected });
  switch (gate.kind) {
    case 'guide':
      emitServiceStatus(win, 'failed', gate.guidance === 'node-missing' ? '缺少可用的 Node.js' : '未检测到 DeepSeek Harness');
      return loadGuide(win, gate.guidance);
    case 'ask':
      emitServiceStatus(win, 'stopped', `端口 ${port} 被其他程序占用`);
      return loadPortPrompt(
        win,
        port,
        decision.action === 'ask' ? decision.candidatePorts : nextFreeCandidates(port),
      );
    case 'reuse': {
      reuseMode = true;
      writeLog('shell', `reuse service on port ${port}`);
      if (config.onboardingDone) {
        await loadUrl(win, `http://127.0.0.1:${port}`);
      } else {
        await loadOnboarding(win);
      }
      emitServiceStatus(win, 'running', `已连接本机服务（端口 ${port}）`);
      subscribeEvents(port);
      // 主题单一事实源 = DSH 官方"外观"设置：启动时读取并采用，壳（窗口底色/图标/本地页）跟随
      adoptThemeFromDsh(port);
      updateTrayState();
      return;
    }
    case 'spawn':
      break;
  }

  // spawn（桌面基线经 --patch 传入，§8.7；向导装出的实例用独立 DSH_HOME，[FR-22.4]）
  emitServiceStatus(win, 'starting', '正在启动服务…');
  // 用户改过提示词设置 → 用 userData/desktop.patch.yml；否则用打包基线 assets/desktop.patch.yml
  const userPatch = userPatchFile();
  const patchFile = existsSync(userPatch)
    ? userPatch
    : existsSync(DEFAULT_PATCH)
      ? DEFAULT_PATCH
      : undefined;
  const usingInstalled =
    process.env.DSH_COMMAND === undefined && installedBin !== null && existsSync(installedBin);
  let spec: SpawnSpec;
  if (usingInstalled && config.installDir !== undefined) {
    // 打包版：自备/自下载 Node 直跑安装出的 DSH CLI（不依赖系统 node/npm）
    const runtime = await ensureNodeRuntime({
      userData: app.getPath('userData'),
      onProgress: (detail) => emitServiceStatus(win, 'starting', detail),
    });
    spec = buildNodeSpawnSpec({
      nodeExe: runtime.nodeExe,
      dshEntry: dshEntryJsPath(config.installDir),
      port,
      patchFile,
    });
  } else {
    spec = buildSpawnSpec({
      port,
      patchFile,
      command: process.env.DSH_COMMAND,
    });
  }
  const child = spawn(spec.command, spec.args, {
    cwd: dshCwd || process.cwd(),
    env: buildSpawnEnv({
      base: process.env,
      dshHome: usingInstalled ? join(app.getPath('userData'), 'dsh-home') : undefined,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  serviceProcess = child;

  let ready = false;
  const readyPromise = new Promise<void>((resolve, reject) => {
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      writeLog('service', text);
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseReadyUrlLine(line);
        if (parsed && parsed.port === port) {
          ready = true;
          resolve();
          return;
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => writeLog('service', chunk.toString()));
    child.on('exit', (code) => {
      if (!ready) reject(new Error(`dsh exited with code ${code}`));
      serviceProcess = null;
      emitServiceStatus(win, 'stopped', '服务已停止');
      updateTrayState();
    });
    setTimeout(() => {
      if (!ready) reject(new Error('readiness timeout'));
    }, 30000);
  });

  try {
    await readyPromise;
    config.port = port;
    store.save(config);
    writeLog('shell', `service ready on port ${port}`);
    if (config.onboardingDone) {
      await loadUrl(win, `http://127.0.0.1:${port}`);
    } else {
      await loadOnboarding(win);
    }
    emitServiceStatus(win, 'running', `服务已启动（端口 ${port}）`);
    subscribeEvents(port);
    adoptThemeFromDsh(port);
    updateTrayState();
  } catch (error) {
    writeLog('shell', `spawn failed: ${String(error)}`);
    emitServiceStatus(win, 'failed', `启动失败：${String(error)}`);
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
    title: 'deepseekharness',
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
  // [FR-1] 窗口位置/尺寸记忆：启动套用上次状态，移动/缩放/最大化防抖落盘
  applySavedBounds(win);
  watchBounds(win);
  win.on('close', (event) => {
    // 关窗缩托盘（[FR-3.1]）：应用不退出、服务继续
    event.preventDefault();
    mainWindow?.hide();
  });
  // 导航护栏：文件拖放由 DSH 页面自己的 drop 区处理；拖到区外若被当导航会
  // 离开壳面，这里拦住（只放行 127.0.0.1；loadFile/loadURL 程序化加载不受影响）。
  // 开发调试（DSH_DEV_ALLOW_FILE=1，默认关闭）：页面导航到壳本地页时，由主进程
  // 代用 loadFile 加载（绕过 Chromium 对 http→file 导航的封锁），供自跑验收截图。
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigationUrl(url)) return;
    if (process.env.DSH_DEV_ALLOW_FILE === '1' && url.startsWith('file://')) {
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
    if (url.startsWith('file://')) {
      win.webContents.executeJavaScript(PAGE_THEME_SCRIPT).catch(() => undefined);
      win.webContents.executeJavaScript(FLOATING_CONTROLS_SCRIPT).catch(() => undefined);
      win.webContents.executeJavaScript(PAGE_DRAG_SCRIPT).catch(() => undefined);
      win.webContents.insertCSS(PAGE_THEME_CSS).catch(() => undefined);
    } else if (url.startsWith('http://127.0.0.1')) {
      win.webContents.executeJavaScript(FLOATING_CONTROLS_SCRIPT).catch(() => undefined);
      win.webContents.executeJavaScript(DSH_HEADER_DRAG_SCRIPT).catch(() => undefined);
      win.webContents.insertCSS(DESKTOP_CSS).catch(() => undefined);
      win.webContents.insertCSS(CODEX_SKIN_CSS).catch(() => undefined);
      // 官方设置扩展：所有壳新设置都作为选项放进 DSH 自带设置（用户拍板）
      win.webContents.executeJavaScript(SETTINGS_EXTENSION_SCRIPT).catch(() => undefined);
    }
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

/** 通知历史页（[D31]：回看/清空） */
function loadNotificationsPage(win: BrowserWindow): Promise<void> {
  return win.loadFile(NOTIFICATIONS_PAGE, { query: pageQuery() }).catch(() => undefined);
}

/** 返回对话主界面（设置/通知/日志页"返回对话"；未完成首启向导时回向导） */
function loadMain(win: BrowserWindow): Promise<void> {
  const config = getStore().load();
  if (config.onboardingDone) {
    return loadUrl(win, `http://127.0.0.1:${config.port ?? 3080}`);
  }
  return loadOnboarding(win);
}

/** 用户级 --patch overlay（[FR-16]：身份/persona 设置落这里；无则用打包默认基线） */
function userPatchFile(): string {
  return join(app.getPath('userData'), 'desktop.patch.yml');
}

/**
 * 重启壳拉起的服务以应用新 --patch（[FR-16] 保存并重启）。
 * 复用外部服务时不接管；等退出事件或超时后重跑启动序列（端口探测复用同一路径）。
 */
async function restartService(win: BrowserWindow): Promise<void> {
  if (reuseMode) return;
  const child = serviceProcess;
  serviceProcess = null;
  if (child && !child.killed) {
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

/** npm install --prefix <目录> @deepseek-ai/dsh；stdout 尾巴推给页面当进度文案 */
function runNpmInstall(dir: string, win: BrowserWindow, npmCmd: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(npmCmd, buildNpmInstallArgs(dir), {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let lastLine = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        lastLine = lines[lines.length - 1] ?? '';
        sendProgress(win, { phase: 'install', percent: -1, detail: `npm：${lastLine}` });
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => writeLog('shell', `npm: ${chunk.toString()}`));
    child.on('error', (error) => {
      writeLog('shell', `npm spawn failed: ${String(error)}`);
      resolve(null);
    });
    child.on('exit', (code) => resolve(code));
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
    const code = await runNpmInstall(dir, win, runtime.npmCmd);
    if (code !== 0) {
      // 页面 error 步自带"重新安装/查看日志"按钮，不再 reload 回 ask
      const detail =
        '安装失败。网络不通时可给 npm 配置镜像（registry.npmmirror.com）或开启代理后重试；详情见日志。';
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
    // 开发调试（DSH_DEV_ALLOW_FILE=1）：直接加载独立设置页，供自跑验收截图。
    const win = mainWindow ?? createWindow();
    if (process.env.DSH_DEV_ALLOW_FILE === '1') {
      void loadPromptSettings(win);
      return;
    }
    openInAppSettings(win);
  },
  openMain: () => {
    // 设置/通知/日志页的"返回对话"
    const win = mainWindow ?? createWindow();
    void loadMain(win);
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
    // ask 步"开始安装"→ 进入选目录步（页面显示 chooseDir，按钮调 pickDir）
    const win = mainWindow ?? createWindow();
    await loadInstallWizard(win, 'chooseDir');
  },
  pickDir: async () => {
    const win = mainWindow ?? createWindow();
    // 默认目录先建好并作为选择器初始位置：交付页"用默认目录就好"的承诺成立
    const defaultDir = defaultInstallDir(process.platform, process.env, app.getPath('home'));
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
  testConnection: (config) => testConnection(config),
  discoverModels: (input) => discoverModels(input),
  windowControl: (action) => {
    const win = mainWindow;
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close(); // close 事件 → 缩托盘（[FR-3.1]）
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
    if (reuseMode) {
      // 复用外部服务：路径由其环境决定，三项均不可接管（[D75] 显式提示，不静默）
      return {
        mode: 'reuse',
        includeHarnessIdentity: prompt.includeHarnessIdentity,
        persona: prompt.persona,
        globalPrompt: '',
        globalPromptPath: null,
        notifyResult,
        uiTheme,
        uiThemeResolved,
      };
    }
    const path = globalAgentsPath(app.getPath('userData'));
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
    if (reuseMode) {
      return notifyChanged || input.uiTheme !== undefined
        ? { ok: true, restarting: false, message: '已保存。通知开关与主题即时生效。' }
        : {
            ok: false,
            restarting: false,
            message:
              '当前复用外部 DSH 服务：身份注入 / persona / 全局指令由该服务的环境决定，桌面端无法接管。' +
              '如需接管：在原处停止外部服务，再回到桌面重新启动（会自动拉起自己的服务）。',
          };
    }
    try {
      const store = getStore();
      const config = store.load();
      config.prompt = { includeHarnessIdentity: input.includeHarnessIdentity, persona: input.persona };
      store.save(config);
      const agentsPath = globalAgentsPath(app.getPath('userData'));
      mkdirSync(dirname(agentsPath), { recursive: true });
      writeFileSync(agentsPath, input.globalPrompt, 'utf8');
      writeFileSync(
        userPatchFile(),
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
    if (input.restart) {
      const win = mainWindow;
      void restartService(win ?? createWindow());
      return { ok: true, restarting: true, message: '设置已保存，正在重启服务…' };
    }
    return {
      ok: true,
      restarting: false,
      message: '已保存。全局指令由 DSH 自动同步；身份注入与 persona 在服务重启后生效。',
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
      writeFileSync(projectAgentsPath(path), input.content, 'utf8');
      writeLog('shell', `project instruction saved for ${input.workspaceId} (${path})`);
      return { ok: true, message: '已保存。DSH 会自动同步到该工作区的会话。' };
    } catch (error) {
      return {
        ok: false,
        message: `保存失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 入口（单实例锁，§3.3）
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.whenReady().then(() => {
    const win = createWindow();
    setupTray(win);
    registerBridge(shellOps);
    setupAutoUpdater(); // [D78] 自动检查更新 + 自动下载（安装用户确认）
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
