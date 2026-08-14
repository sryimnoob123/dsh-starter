/**
 * 窗口位置/尺寸记忆（细化文档 FR-1，V1+）：
 * 壳配置 `window: {width,height,maximized}` 的读写口径——只做校验与归一化，
 * 真实读写与防抖在 app.ts（BrowserWindow 事件）。
 */

export interface WindowBounds {
  width: number;
  height: number;
  maximized: boolean;
}

export const MIN_WIDTH = 400;
export const MIN_HEIGHT = 300;
export const MAX_DIMENSION = 10000;

/**
 * 校验持久化的窗口状态：非法/越界/非数字单项回默认（防脏数据把窗口开到屏幕外）。
 * 合法值取整（Electron setBounds 需要整数）。
 */
export function normalizeWindowBounds(raw: unknown, fallback: WindowBounds): WindowBounds {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const obj = raw as Record<string, unknown>;
  const width =
    typeof obj.width === 'number' && Number.isFinite(obj.width) && obj.width >= MIN_WIDTH && obj.width <= MAX_DIMENSION
      ? Math.round(obj.width)
      : fallback.width;
  const height =
    typeof obj.height === 'number' && Number.isFinite(obj.height) && obj.height >= MIN_HEIGHT && obj.height <= MAX_DIMENSION
      ? Math.round(obj.height)
      : fallback.height;
  const maximized = typeof obj.maximized === 'boolean' ? obj.maximized : fallback.maximized;
  return { width, height, maximized };
}
