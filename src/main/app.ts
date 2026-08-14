import { app, BrowserWindow, dialog, Menu, Notification, shell, Tray } from 'electron';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
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
import { setupAutoUpdater } from './updater/index.js';
import { registerBridge, sendProgress, sendServiceStatus, type ShellOps } from './bridge/register.js';
import type { ShellStatus } from './bridge/contract.js';
import { discoverModels, testConnection } from './onboarding/connection.js';
import { saveConnectionToService } from './onboarding/dshConfig.js';
import { buildNpmInstallArgs, defaultInstallDir, dshBinPath, dshEntryJsPath } from './install/dshPackage.js';
import { ensureNodeRuntime } from './runtime/nodeProvision.js';
import { callRpc } from './service/rpc.js';
import { DESKTOP_CSS, TITLEBAR_SCRIPT } from './window/desktopChrome.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 常量（架构文档 §4：稳定边界；§8.7：桌面基线经 --patch 传入）
// ---------------------------------------------------------------------------
const GUIDE_PAGE = join(__dirname, 'pages', 'guide.html');
const PORT_PROMPT_PAGE = join(__dirname, 'pages', 'port-prompt.html');
const INSTALL_PAGE = join(__dirname, 'pages', 'install-wizard.html');
const ONBOARDING_PAGE = join(__dirname, 'pages', 'onboarding.html');
const LOGS_PAGE = join(__dirname, 'pages', 'logs.html');
const PRELOAD = join(__dirname, 'bridge', 'preload.cjs');
const DEFAULT_PATCH = join(__dirname, '..', '..', 'assets', 'desktop.patch.yml');
const ICON = join(__dirname, '..', '..', 'assets', 'icon.png');

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
 * 整窗深色（用户拍板：整体像 Codex/OpenChamber）：走 DSH 官方主题设置
 * （ui-theme namespace，Appearance 行的同一条路），不硬改 DSH 的 CSS。
 */
function syncDesktopTheme(port: number): void {
  callRpc({ port, method: 'settings.update', payload: { ns: 'ui-theme', patch: { preference: 'dark' } } })
    .then(() => writeLog('shell', 'theme synced to dark'))
    .catch((error: unknown) => writeLog('shell', `theme sync failed: ${String(error)}`));
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
  id: 'logs',
  title: '查看日志',
  order: 30,
  click: ({ window }) => {
    // [D21]：托盘"查看日志"= 壳内日志页（壳日志 + 服务日志），不是打开文件夹
    void loadLogsPage(window);
  },
});

trayItems.register({
  id: 'quit',
  title: '退出',
  order: 40,
  click: ({ quit }) => quit(),
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
  tray = new Tray(ICON);
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

  eventSocket.on('message', (data) => {
    try {
      const frame = JSON.parse(String(data)) as MuxFrame;
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
    // 断开 → 2s 后自动重连（浏览器同款指数退避的简化，[FR-25.5]）
    setTimeout(() => {
      if (reuseMode || serviceProcess) subscribeEvents(port);
    }, 2000);
  });
}

function notify(candidate: { type: 'result'; sessionId: string; title: string }): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: 'deepseekharness', body: candidate.title });
  n.on('click', () => {
    // V1 浅通知：只唤起窗口（定位会话为 V1+ 插件，[D72]）
    mainWindow?.show();
    mainWindow?.focus();
  });
  n.show();
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
      syncDesktopTheme(port);
      updateTrayState();
      return;
    }
    case 'spawn':
      break;
  }

  // spawn（桌面基线经 --patch 传入，§8.7；向导装出的实例用独立 DSH_HOME，[FR-22.4]）
  emitServiceStatus(win, 'starting', '正在启动服务…');
  const patchFile = existsSync(DEFAULT_PATCH) ? DEFAULT_PATCH : undefined;
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
    syncDesktopTheme(port);
    updateTrayState();
  } catch (error) {
    writeLog('shell', `spawn failed: ${String(error)}`);
    emitServiceStatus(win, 'failed', `启动失败：${String(error)}`);
    loadGuide(win, 'spawn-crash');
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'deepseekharness',
    icon: ICON, // 官方黑色鲸鱼图标（[D14]，assets/icon.png）
    // [D83]/[D84] 深色无边框 + 整体自绘标题栏（OpenChamber 同款结构，配色用我们的深色板）：
    // 原生标题栏与原生按钮全部去掉，标题栏由壳注入（最小化/最大化/关闭为自绘按钮）
    backgroundColor: '#151313',
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
  win.on('close', (event) => {
    // 关窗缩托盘（[FR-3.1]）：应用不退出、服务继续
    event.preventDefault();
    mainWindow?.hide();
  });
  // 所有页面统一注入自绘标题栏（壳本地页 + DSH 页面；拖拽区 = 标题栏本身）；
  // DSH 页面额外注入深色细滚动条样式 + 内容下移（去掉网页感，[D83]/[D84]）
  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    if (url.startsWith('file://') || url.startsWith('http://127.0.0.1')) {
      win.webContents.executeJavaScript(TITLEBAR_SCRIPT).catch(() => undefined);
    }
    if (url.startsWith('http://127.0.0.1')) {
      win.webContents.insertCSS(DESKTOP_CSS).catch(() => undefined);
    }
  });
  return win;
}

function loadUrl(win: BrowserWindow, url: string): Promise<void> {
  return win.loadURL(url).catch(() => loadGuide(win, 'spawn-crash'));
}

function loadGuide(win: BrowserWindow, guidance: string): Promise<void> {
  return win.loadFile(GUIDE_PAGE, { query: { guidance, lang: 'zh' } }).catch(() => undefined);
}

/** 端口冲突询问页（[FR-25.3]：候选端口 + 用户选择后记住） */
function loadPortPrompt(win: BrowserWindow, occupied: number, candidates: number[]): Promise<void> {
  return win
    .loadFile(PORT_PROMPT_PAGE, {
      query: { port: String(occupied), candidates: candidates.join(','), lang: 'zh' },
    })
    .catch(() => loadGuide(win, 'port-occupied'));
}

/** 安装向导页（[FR-22.5]；页面由外包交付，占位版保证入口可达） */
function loadInstallWizard(win: BrowserWindow, step = 'ask'): Promise<void> {
  return win
    .loadFile(INSTALL_PAGE, { query: { step, lang: 'zh' } })
    .catch(() => loadGuide(win, 'dsh-missing'));
}

/** 首启向导页（[FR-21.1]：首次服务就绪后显示；页面缺失时退回主界面） */
function loadOnboarding(win: BrowserWindow): Promise<void> {
  return win
    .loadFile(ONBOARDING_PAGE, { query: { step: 'welcome', lang: 'zh' } })
    .catch(() => loadUrl(win, `http://127.0.0.1:${getStore().load().port ?? 3080}`));
}

/** 日志页（[D21] 托盘入口；页面缺失时退回打开日志目录） */
function loadLogsPage(win: BrowserWindow): Promise<void> {
  return win
    .loadFile(LOGS_PAGE, { query: { log: 'shell', lang: 'zh' } })
    .catch(() => {
      shell.openPath(join(app.getPath('userData'), 'logs')).catch(() => undefined);
    });
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
    await win.loadFile(INSTALL_PAGE, { query: { step: 'download', lang: 'zh' } });
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
    await win.loadFile(INSTALL_PAGE, { query: { step: 'launch', lang: 'zh' } });
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
    void startShell(win);
  });
  app.on('window-all-closed', () => {
    // 关窗 ≠ 退出（[FR-2.4]）：托盘驻留，保持运行
  });
}
