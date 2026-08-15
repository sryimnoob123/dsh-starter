import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ShellConfig {
  schemaVersion: 1;
  /** 智能端口记住的端口（[FR-25.3]）；未记住时用默认 3080 */
  port?: number;
  /** 安装向导装出的 DSH 目录（npm --prefix，[FR-22]）；存在且 bin 可用时启动优先用该目录的 dsh */
  installDir?: string;
  /** 已有 DSH checkout/克隆目录（guide 页"选择已有 DSH 目录"写入；服务掉线时自动从这里拉起，[D90] 服务生命周期归壳） */
  dshCheckout?: string;
  /** 历史遗留字段（复用外部服务时代的 DSH_HOME）；managed 模式已废弃，不再使用 */
  dshHome?: string;
  /** managed 模式：检测到本机已装 dsh 时用户的选择；existing=用已装的，download=重新下载（记一次，不再问） */
  dshChoice?: 'existing' | 'download';
  /** 首启向导是否已完成（[FR-21.1]）；未完成且服务就绪时显示 onboarding */
  onboardingDone?: boolean;
  /** 窗口状态记忆（细化文档 FR-1，V1+） */
  window?: { width: number; height: number; maximized: boolean };
  /** 通知类型开关（[FR-4.3] 扩展位，V1 只有 result 类型） */
  notifications?: { result: boolean };
  /** 提示词管理（[FR-16]：身份注入开关 + persona；语义与默认值见 src/main/prompt/promptSettings.ts） */
  prompt?: { includeHarnessIdentity?: boolean; persona?: string };
  /** 界面主题（[D83]/[D85] 扩展：跟随系统/深色/浅色；默认跟随系统） */
  uiTheme?: 'system' | 'dark' | 'light';
}

const DEFAULT_NOTIFICATIONS: { result: boolean } = { result: true };

export const DEFAULT_CONFIG: ShellConfig = {
  schemaVersion: 1,
  notifications: DEFAULT_NOTIFICATIONS,
  // 主题默认跟随系统（用户拍板：[D83]/[D85] 扩展三态）
  uiTheme: 'system',
};

/**
 * 壳配置持久化（架构文档 §3.2）：
 * 只写壳自己的 userData 目录，不写 $DSH_HOME（[D70]/[FR-32]）。
 * JSON + schemaVersion，未知字段保留、缺失字段回默认（向后兼容 [FR-28.3]）。
 */
export class ConfigStore {
  constructor(private readonly filePath: string) {}

  load(): ShellConfig {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ...DEFAULT_CONFIG };
      }
      const obj = parsed as Partial<ShellConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...obj,
        notifications: {
          result: obj.notifications?.result ?? DEFAULT_NOTIFICATIONS.result,
        },
        // 只认 light/dark/system，其余一律回跟随系统（防脏数据突变）
        uiTheme: obj.uiTheme === 'light' || obj.uiTheme === 'dark' ? obj.uiTheme : 'system',
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  save(config: ShellConfig): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf8');
  }
}
