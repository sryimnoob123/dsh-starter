import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import {
  BRIDGE_API,
  parseConnectionConfig,
  parseFilePathInput,
  parseLogKind,
  parsePort,
  parseProjectInstructionInput,
  parsePromptSettingsInput,
  parseWindowAction,
  type ConnectionConfig,
  type ConnectionResult,
  type InstallProgressEvent,
  type ListProjectInstructionsResult,
  type NotificationHistoryEntry,
  type GetSessionUsageResult,
  type PromptSettingsState,
  type SavePromptSettingsResult,
  type ShellStatusEvent,
  type WindowAction,
} from './contract.js';

/**
 * 壳侧桥注册器（[D79] 外包包 §2）：
 * - ipcMain 处理器：页面通过 preload 的 window.dshShell 调用，主进程只认校验后的入参；
 * - 事件发送器：壳 → 页面（服务状态 / 安装进度）。
 * 所有业务动作委托给 app.ts 注入的 ShellOps，本文件不持有业务状态。
 */

export interface ShellOps {
  /** 重新探测服务：可复用则接上，否则拉起；成功后导航主界面 */
  retry(): Promise<void>;
  quit(): void;
  /** 打开日志目录（托盘"查看日志"同款） */
  openLogs(): void;
  readLog(kind: 'shell' | 'service'): string;
  /** 打开安装向导页（guide 页 dsh-missing 的"安装 DSH"按钮） */
  goInstall(): void;
  /** 打开设置页（标题栏齿轮入口） */
  openPromptSettings(): void;
  /** 返回对话主界面（设置/通知/日志页的"返回对话"） */
  openMain(): void;
  /** 手动检查更新（右上角"检查更新"按钮，[D78]） */
  checkForUpdates(): void;
  /** 用户选定端口：记住并重跑启动序列（[FR-25.3]） */
  choosePort(port: number): Promise<void>;
  /** 安装向导：开始安装（ask 步 → 进入选目录步） */
  startInstall(): Promise<void>;
  /** 安装向导：弹目录选择器；返回所选路径（取消返回 ''），选定后壳接续安装流程 */
  pickDir(): Promise<string>;
  /** 手动选择已有 dsh 目录（npm 安装版）：验证目录含 dsh 入口后存 installDir 并重跑启动序列 */
  selectDshDir(): Promise<{ ok: boolean; message?: string }>;
  /** 首启向导：测试连接（[FR-30.7] 手工路径） */
  testConnection(config: ConnectionConfig): Promise<ConnectionResult>;
  /** 首启向导：保存连接（调 DSH 服务 settings/credentials API） */
  saveConnection(config: ConnectionConfig): Promise<ConnectionResult>;
  /** 首启向导：自动获取模型列表（GET {baseUrl}/models，端点不支持时返回失败让用户手填） */
  discoverModels(input: { baseUrl: string; apiKey: string }): Promise<{ ok: boolean; models: string[]; message?: string }>;
  /** 提示词管理：读取当前设置与全局指令文件（[FR-16]） */
  getPromptSettings(): PromptSettingsState;
  /** 提示词管理：保存身份开关/persona/全局指令；restart=true 时重启壳拉起的服务；uiTheme（三态）即时生效 */
  savePromptSettings(input: { includeHarnessIdentity: boolean; persona: string; globalPrompt: string; restart: boolean; notifyResult?: boolean; uiTheme?: 'system' | 'dark' | 'light' }): Promise<SavePromptSettingsResult>;
  /** 通知历史（[D31]）：新→旧，最多 500 条 */
  readNotifications(): NotificationHistoryEntry[];
  /** 通知历史：清空 */
  clearNotifications(): void;
  /** 项目级指令（[FR-16.7] P1）：workspace.list 现查工作区 + 读各自 AGENTS.md */
  listProjectInstructions(): Promise<ListProjectInstructionsResult>;
  /** 项目级指令：按 workspaceId 现查路径并写 <path>/AGENTS.md（不接页面路径，防任意写） */
  saveProjectInstruction(input: { workspaceId: string; content: string }): Promise<{ ok: boolean; message: string }>;
  /** 用量统计（ZCode 式）：当前会话的 host 投影汇总 */
  getSessionUsage(): Promise<GetSessionUsageResult>;
  /** 文件路径右键菜单：弹出 复制路径 / 打开所在位置 / 直接打开文件（[FR-11.1]） */
  filePathMenu(path: string): void;
  /** 文件路径左键：直接打开（壳用 shell.openPath，解决外部窗口不置顶） */
  filePathOpen(path: string): Promise<void>;
  /** 窗口控制（自绘标题栏 [D84]：minimize / toggle-maximize / close=缩托盘） */
  windowControl(action: WindowAction): void;
}

export function registerBridge(ops: ShellOps): void {
  ipcMain.handle(BRIDGE_API.retry, () => ops.retry());
  ipcMain.handle(BRIDGE_API.quit, () => ops.quit());
  ipcMain.handle(BRIDGE_API.openLogs, () => ops.openLogs());

  ipcMain.handle(BRIDGE_API.readLog, (_event, raw: unknown) => {
    const kind = parseLogKind(raw);
    if (!kind) throw new Error(`readLog: 非法参数 ${String(raw)}`);
    return ops.readLog(kind);
  });

  ipcMain.handle(BRIDGE_API.goInstall, () => ops.goInstall());

  ipcMain.handle(BRIDGE_API.openPromptSettings, () => ops.openPromptSettings());

  ipcMain.handle(BRIDGE_API.openMain, () => ops.openMain());

  ipcMain.handle(BRIDGE_API.checkForUpdates, () => ops.checkForUpdates());

  ipcMain.handle(BRIDGE_API.choosePort, (_event, raw: unknown) => {
    const port = parsePort(raw);
    if (port === null) throw new Error('choosePort: 端口非法');
    return ops.choosePort(port);
  });

  ipcMain.handle(BRIDGE_API.startInstall, () => ops.startInstall());

  ipcMain.handle(BRIDGE_API.pickDir, () => ops.pickDir());

  ipcMain.handle(BRIDGE_API.selectDshDir, () => ops.selectDshDir());

  ipcMain.handle(BRIDGE_API.testConnection, (_event, raw: unknown) => {
    const config = parseConnectionConfig(raw);
    if (!config) return { ok: false, message: '配置不完整：请填写 API 地址、API 密钥与模型名。' };
    return ops.testConnection(config);
  });

  ipcMain.handle(BRIDGE_API.saveConnection, (_event, raw: unknown) => {
    const config = parseConnectionConfig(raw);
    if (!config) return { ok: false, message: '配置不完整：请填写 API 地址、API 密钥与模型名。' };
    return ops.saveConnection(config);
  });

  ipcMain.handle(BRIDGE_API.discoverModels, (_event, raw: unknown) => {
    const parsed = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    const baseUrl = typeof parsed?.baseUrl === 'string' ? parsed.baseUrl.trim() : '';
    const apiKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : '';
    if (!/^https?:\/\//i.test(baseUrl) || apiKey === '') {
      return { ok: false, models: [], message: '请先填写 API 地址与 API 密钥。' };
    }
    return ops.discoverModels({ baseUrl, apiKey });
  });

  ipcMain.handle(BRIDGE_API.getPromptSettings, () => ops.getPromptSettings());

  ipcMain.handle(BRIDGE_API.savePromptSettings, (_event, raw: unknown) => {
    const input = parsePromptSettingsInput(raw);
    if (!input) {
      return {
        ok: false,
        restarting: false,
        message: '保存失败：内容非法或超出长度上限（persona ≤ 2 万字符、全局指令 ≤ 1MB）。',
      } satisfies SavePromptSettingsResult;
    }
    return ops.savePromptSettings(input);
  });

  ipcMain.handle(BRIDGE_API.readNotifications, () => ops.readNotifications());

  ipcMain.handle(BRIDGE_API.clearNotifications, () => ops.clearNotifications());

  ipcMain.handle(BRIDGE_API.listProjectInstructions, () => ops.listProjectInstructions());

  ipcMain.handle(BRIDGE_API.saveProjectInstruction, (_event, raw: unknown) => {
    const input = parseProjectInstructionInput(raw);
    if (!input) return { ok: false, message: '保存失败：内容非法或超出长度上限（≤ 1MB）。' };
    return ops.saveProjectInstruction(input);
  });

  ipcMain.handle(BRIDGE_API.getSessionUsage, () => ops.getSessionUsage());

  ipcMain.handle(BRIDGE_API.filePathMenu, (_event, raw: unknown) => {
    const path = parseFilePathInput(raw);
    if (!path) throw new Error(`filePathMenu: 非法参数 ${String(raw)}`);
    ops.filePathMenu(path);
  });

  ipcMain.handle(BRIDGE_API.filePathOpen, (_event, raw: unknown) => {
    const path = parseFilePathInput(raw);
    if (!path) throw new Error(`filePathOpen: 非法参数 ${String(raw)}`);
    return ops.filePathOpen(path);
  });

  ipcMain.handle(BRIDGE_API.windowControl, (_event, raw: unknown) => {
    const action = parseWindowAction(raw);
    if (action === null) throw new Error(`windowControl: 非法动作 ${String(raw)}`);
    ops.windowControl(action);
  });
}

export function sendServiceStatus(win: BrowserWindow, event: ShellStatusEvent): void {
  if (!win.isDestroyed()) win.webContents.send(BRIDGE_API.onServiceStatus, event);
}

export function sendProgress(win: BrowserWindow, event: InstallProgressEvent): void {
  if (!win.isDestroyed()) win.webContents.send(BRIDGE_API.onProgress, event);
}
