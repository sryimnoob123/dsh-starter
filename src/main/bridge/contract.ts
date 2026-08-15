/**
 * dshShell 桥契约（[D79] 外包包 §2 的最终签名，外包包 v0.2 起生效）。
 *
 * - 页面（外包 AI 交付的 HTML）只调用 window.dshShell 的方法，不直接碰 IPC。
 * - 本表的**方法名** = 页面契约：改名会破坏外包页面，必须先同步三处——
 *   ① preload.cjs ② 外包包 §2 ③ 需求文档变更记录；contract.test.ts 锁定本表。
 * - 校验器在主进程与 preload 两侧共用口径，防止页面传垃圾数据进主进程。
 */

/** 通知历史条目（[D31] 通知历史中心；与 notify/history.ts 的 NotificationEntry 同形） */
export interface NotificationHistoryEntry {
  time: number;
  title: string;
  body: string;
}

/** 项目级指令行（[FR-16.7] P1：工作区 AGENTS.md 编辑器） */
export interface ProjectInstructionRow {
  workspaceId: string;
  title: string;
  path: string;
  /** 该工作区 AGENTS.md 当前内容；不存在为空串 */
  content: string;
}

/** 用量统计（用户要求 ZCode 式；数据 = session.history 的 host 投影汇总） */
export interface SessionUsage {
  turns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type GetSessionUsageResult =
  | { ok: true; usage: SessionUsage; sessionCount: number }
  | { ok: false; message: string };

export type ListProjectInstructionsResult =
  | { ok: true; items: ProjectInstructionRow[] }
  | { ok: false; message: string };

/**
 * 校验项目级指令保存载荷：workspaceId 仅作查找键（路径由服务端现查），
 * content 上限 1MB（对齐 agent-instructions 单文件上限）。
 */
export function parseProjectInstructionInput(raw: unknown): { workspaceId: string; content: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.workspaceId !== 'string' || obj.workspaceId.trim() === '' || obj.workspaceId.length > 200) {
    return null;
  }
  if (typeof obj.content !== 'string' || Buffer.byteLength(obj.content, 'utf8') > 1_000_000) return null;
  return { workspaceId: obj.workspaceId.trim(), content: obj.content };
}

/** 日志类型（logs.html 的 log= 参数与 readLog 入参） */
export type LogKind = 'shell' | 'service';

/** 服务生命周期状态（guide/port-prompt/onboarding 页面渲染用） */
export type ShellStatus = 'probing' | 'starting' | 'running' | 'stopped' | 'failed';

export interface ShellStatusEvent {
  status: ShellStatus;
  /** 一句话补充（可选，页面可直接展示） */
  detail: string;
}

/** 安装向导阶段（install-wizard.html 渲染用） */
export type InstallPhase = 'download' | 'install' | 'configure' | 'launch' | 'done' | 'error';

export interface InstallProgressEvent {
  phase: InstallPhase;
  /** 0-100；无法确定时 -1 */
  percent: number;
  detail: string;
}

/** 首启向导"接入 AI"表单数据（onboarding.html） */
export interface ConnectionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 可选：自动获取到的全部模型 id（保存时全部登记进 DSH，模型选择器可多选） */
  models?: string[];
}

export interface ConnectionResult {
  ok: boolean;
  /** 给用户看的一句话结果/原因（中英双语由页面按 lang 处理，这里给中文） */
  message: string;
}

// ---------------------------------------------------------------------------
// 提示词管理（FR-16 V1：身份注入开关 + persona + 全局指令文件；设置页契约）
// ---------------------------------------------------------------------------

/** managed = 壳拉起服务（DSH_HOME 归壳管，三项都可编辑）；不再有 reuse 外部服务模式 */
export type PromptMode = 'managed';

export interface PromptSettingsState {
  mode: PromptMode;
  includeHarnessIdentity: boolean;
  persona: string;
  /** 全局指令文件当前内容 */
  globalPrompt: string;
  /** 全局指令文件路径 */
  globalPromptPath: string | null;
  /** 任务结果桌面通知开关（[FR-4.3] 类型开关；默认开） */
  notifyResult: boolean;
  /** 界面主题选择（[D83]/[D85] 扩展：跟随系统/深色/浅色；默认跟随系统） */
  uiTheme: 'system' | 'dark' | 'light';
  /** 实际生效的主题（system 已按操作系统解析为 dark/light；页面渲染用这个） */
  uiThemeResolved: 'dark' | 'light';
}

export interface SavePromptSettingsResult {
  ok: boolean;
  /** 一句话结果（页面直接展示） */
  message: string;
  /** 是否触发了服务重启（页面可提示"正在重启"） */
  restarting: boolean;
}

/**
 * 校验设置页保存载荷。上限：persona 2 万字符、全局指令 1MB UTF-8 字节
 * （对齐 agent-instructions 默认 maxSourceBytes ≈ 1MB，超限文件会被 DSH 忽略）。
 */
export function parsePromptSettingsInput(raw: unknown): {
  includeHarnessIdentity: boolean;
  persona: string;
  globalPrompt: string;
  restart: boolean;
  notifyResult?: boolean;
  uiTheme?: 'system' | 'dark' | 'light';
} | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.includeHarnessIdentity !== 'boolean') return null;
  if (typeof obj.persona !== 'string' || obj.persona.length > 20_000) return null;
  if (typeof obj.globalPrompt !== 'string' || Buffer.byteLength(obj.globalPrompt, 'utf8') > 1_000_000) {
    // 注：Buffer 依赖 Node 全局（仅主进程/测试导入本文件，preload 不引用它）
    return null;
  }
  if (typeof obj.restart !== 'boolean') return null;
  const input: {
    includeHarnessIdentity: boolean;
    persona: string;
    globalPrompt: string;
    restart: boolean;
    notifyResult?: boolean;
    uiTheme?: 'system' | 'dark' | 'light';
  } = {
    includeHarnessIdentity: obj.includeHarnessIdentity,
    persona: obj.persona,
    globalPrompt: obj.globalPrompt,
    restart: obj.restart,
  };
  // 通知开关可选（向后兼容旧页面不传）；类型不对 = 整个载荷非法
  if (obj.notifyResult !== undefined) {
    if (typeof obj.notifyResult !== 'boolean') return null;
    input.notifyResult = obj.notifyResult;
  }
  // 主题可选（向后兼容旧页面不传）；只认 system/dark/light
  if (obj.uiTheme !== undefined) {
    if (obj.uiTheme !== 'dark' && obj.uiTheme !== 'light' && obj.uiTheme !== 'system') return null;
    input.uiTheme = obj.uiTheme;
  }
  return input;
}

/**
 * window.dshShell 方法 ↔ IPC 通道映射。
 * 前 10 项是 invoke（页面 → 壳，返回 Promise）；后 2 项是事件订阅（壳 → 页面）。
 */
export const BRIDGE_API = {
  // ---- 通用 ----
  retry: 'dsh:retry',
  quit: 'dsh:quit',
  openLogs: 'dsh:openLogs',
  readLog: 'dsh:readLog',
  goInstall: 'dsh:goInstall',
  /** 打开设置页（标题栏齿轮入口，[FR-21]：功能设置从对话页面可直达） */
  openPromptSettings: 'dsh:openPromptSettings',
  /** 返回对话主界面（设置/通知/日志页的"返回对话"） */
  openMain: 'dsh:openMain',
  // ---- 端口 ----
  choosePort: 'dsh:choosePort',
  // ---- 安装向导 ----
  startInstall: 'dsh:startInstall',
  pickDir: 'dsh:pickDir',
  // ---- 首启向导（AI 接入） ----
  testConnection: 'dsh:testConnection',
  saveConnection: 'dsh:saveConnection',
  discoverModels: 'dsh:discoverModels',
  // ---- 提示词管理（FR-16） ----
  getPromptSettings: 'dsh:getPromptSettings',
  savePromptSettings: 'dsh:savePromptSettings',
  // ---- 通知历史（[D31]） ----
  readNotifications: 'dsh:readNotifications',
  clearNotifications: 'dsh:clearNotifications',
  // ---- 项目级指令（[FR-16.7] P1） ----
  listProjectInstructions: 'dsh:listProjectInstructions',
  saveProjectInstruction: 'dsh:saveProjectInstruction',
  // ---- 用量统计（ZCode 式） ----
  getSessionUsage: 'dsh:getSessionUsage',
  // ---- 文件路径动作（对话内文件路径的右键菜单 / 直接打开，壳承接 [FR-11.1]） ----
  filePathMenu: 'dsh:filePathMenu',
  filePathOpen: 'dsh:filePathOpen',
  // ---- 事件订阅（壳 → 页面） ----
  onServiceStatus: 'dsh:status',
  onProgress: 'dsh:progress',
  // ---- 窗口控制（自绘标题栏按钮，[D84]） ----
  windowControl: 'dsh:windowControl',
} as const;

export type BridgeMethod = keyof typeof BRIDGE_API;

export const STATUS_CHANNEL = BRIDGE_API.onServiceStatus;
export const PROGRESS_CHANNEL = BRIDGE_API.onProgress;

// ---------------------------------------------------------------------------
// 校验器（preload 先拦一道，主进程再拦一道；返回 null = 非法）
// ---------------------------------------------------------------------------

/** 合法端口 = 整数且落在 1024..65535（[FR-25.3] 智能端口范围） */
export function parsePort(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < 1024 || raw > 65535) return null;
  return raw;
}

export function parseLogKind(raw: unknown): LogKind | null {
  return raw === 'shell' || raw === 'service' ? raw : null;
}

/** 文件路径入参（右键菜单 / 直接打开）：trim、非空、上限 8192 字符（防垃圾数据进主进程） */
export function parseFilePathInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.trim();
  if (path === '' || path.length > 8192) return null;
  return path;
}

/** 校验 AI 接入表单：地址 http(s) 开头、密钥与模型名非空；models 可选（过滤空值/非字符串/去重，全非法则丢弃） */
export function parseConnectionConfig(raw: unknown): ConnectionConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const { baseUrl, apiKey, model } = obj;
  if (typeof baseUrl !== 'string' || typeof apiKey !== 'string' || typeof model !== 'string') return null;
  if (!/^https?:\/\//i.test(baseUrl.trim())) return null;
  if (apiKey.trim() === '' || model.trim() === '') return null;
  const config: ConnectionConfig = {
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
  };
  if (Array.isArray(obj.models)) {
    const models = [...new Set(
      (obj.models as unknown[]).filter((m): m is string => typeof m === 'string' && m.trim() !== '').map((m) => m.trim()),
    )].slice(0, 100);
    if (models.length > 0) config.models = models;
  }
  return config;
}

export function parseInstallPhase(raw: unknown): InstallPhase | null {
  const phases: readonly string[] = ['download', 'install', 'configure', 'launch', 'done', 'error'];
  return typeof raw === 'string' && phases.includes(raw) ? (raw as InstallPhase) : null;
}

/** 窗口控制动作（自绘标题栏：[D84]；drag-start/drag-end = 无边框窗口 JS 拖拽，[D84]） */
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close' | 'drag-start' | 'drag-end';

export function parseWindowAction(raw: unknown): WindowAction | null {
  const actions: readonly string[] = ['minimize', 'toggle-maximize', 'close', 'drag-start', 'drag-end'];
  return typeof raw === 'string' && actions.includes(raw) ? (raw as WindowAction) : null;
}
