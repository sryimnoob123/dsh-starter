/**
 * dshShell 桥契约（[D79] 外包包 §2 的最终签名，外包包 v0.2 起生效）。
 *
 * - 页面（外包 AI 交付的 HTML）只调用 window.dshShell 的方法，不直接碰 IPC。
 * - 本表的**方法名** = 页面契约：改名会破坏外包页面，必须先同步三处——
 *   ① preload.cjs ② 外包包 §2 ③ 需求文档变更记录；contract.test.ts 锁定本表。
 * - 校验器在主进程与 preload 两侧共用口径，防止页面传垃圾数据进主进程。
 */

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
  // ---- 端口 ----
  choosePort: 'dsh:choosePort',
  // ---- 安装向导 ----
  startInstall: 'dsh:startInstall',
  pickDir: 'dsh:pickDir',
  // ---- 首启向导（AI 接入） ----
  testConnection: 'dsh:testConnection',
  saveConnection: 'dsh:saveConnection',
  discoverModels: 'dsh:discoverModels',
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

/** 窗口控制动作（自绘标题栏：[D84]） */
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close';

export function parseWindowAction(raw: unknown): WindowAction | null {
  const actions: readonly string[] = ['minimize', 'toggle-maximize', 'close'];
  return typeof raw === 'string' && actions.includes(raw) ? (raw as WindowAction) : null;
}
