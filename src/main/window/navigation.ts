/**
 * 窗口导航护栏（FR-11 归属评估的壳侧结论）：
 * 文件拖入对话是 DSH Web 应用自己的管线（页面 drop 处理区），壳不用实现；
 * 壳只堵一个口子——Electron 默认把文件拖放当成导航，若拖到页面处理区之外
 * 会把窗口导航去 file://。will-navigate 只对页面/用户发起的导航触发，
 * 不影响 loadFile/loadURL 程序化加载（壳自己的本地页照常打开）。
 */

export function isAllowedNavigationUrl(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(url);
}
