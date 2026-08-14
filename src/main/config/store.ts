import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ShellConfig {
  schemaVersion: 1;
  /** 智能端口记住的端口（[FR-25.3]）；未记住时用默认 3080 */
  port?: number;
  /** 安装向导装出的 DSH 目录（npm --prefix，[FR-22]）；存在且 bin 可用时启动优先用该目录的 dsh */
  installDir?: string;
  /** 首启向导是否已完成（[FR-21.1]）；未完成且服务就绪时显示 onboarding */
  onboardingDone?: boolean;
  /** 窗口状态记忆（细化文档 FR-1，V1+） */
  window?: { width: number; height: number; maximized: boolean };
  /** 通知类型开关（[FR-4.3] 扩展位，V1 只有 result 类型） */
  notifications?: { result: boolean };
}

const DEFAULT_NOTIFICATIONS: { result: boolean } = { result: true };

export const DEFAULT_CONFIG: ShellConfig = {
  schemaVersion: 1,
  notifications: DEFAULT_NOTIFICATIONS,
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
