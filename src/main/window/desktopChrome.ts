/**
 * 桌面外观注入（[D83]/[D84]/[D85] + 用户拍板：无标题栏）——壳与截屏验证脚本共用，防止两处漂移。
 * - FLOATING_CONTROLS_SCRIPT：右上角悬浮窗口按钮（设置齿轮 + 最小化/最大化/关闭），
 *   配色走 --dsh-desktop-* 变量，整窗随主题无缝换肤（深色=白鲸风暖色、浅色=暖沙）。
 * - DSH_HEADER_DRAG_SCRIPT：DSH 页面无标题栏后的拖拽区 = 其自身顶部 header
 *   （Codex 同款思路：应用头部就是拖拽区；header 内交互元素 no-drag，右侧留出悬浮按钮位）。
 * - PAGE_DRAG_SCRIPT：壳本地页（file://）顶部透明拖拽条（避开右上角按钮）。
 * - DESKTOP_CSS：DSH 页面注入（深色细滚动条变量化；不再下移内容——标题栏已删除）。
 * - PAGE_THEME_SCRIPT / PAGE_THEME_CSS：壳本地页面的主题初始化（按 ?uiTheme= 落 html[data-dsh-theme]）。
 */

export const DESKTOP_CSS =
  '::-webkit-scrollbar{width:10px;height:10px;}'
  + '::-webkit-scrollbar-thumb{background:var(--dsh-desktop-scroll-thumb,oklch(0.32 0.03 50 / 0.4));border-radius:6px;border:2px solid transparent;background-clip:padding-box;}'
  + '::-webkit-scrollbar-thumb:hover{background:var(--dsh-desktop-scroll-thumb-hover,oklch(0.32 0.03 50 / 0.6));background-clip:padding-box;}'
  + '::-webkit-scrollbar-track{background:transparent;}'
  + '::-webkit-scrollbar-corner{background:transparent;}';

/** 右上角悬浮窗口按钮（用户拍板：删除标题栏，原窗口按钮直接放右上角；设置入口在 DSH 官方设置内） */
export const FLOATING_CONTROLS_SCRIPT = `(function () {
  if (document.getElementById('dsh-float-controls')) return;
  var box = document.createElement('div');
  box.id = 'dsh-float-controls';
  box.innerHTML =
    '<button data-act="minimize" title="\\u6700\\u5c0f\\u5316">\\u2013</button>' +
    '<button data-act="toggle-maximize" title="\\u6700\\u5927\\u5316/\\u8fd8\\u539f">\\u25a1</button>' +
    '<button data-act="close" title="\\u5173\\u95ed\\uff08\\u7f29\\u5230\\u6258\\u76d8\\uff09">\\u00d7</button>';
  box.style.cssText =
    'position:fixed;top:6px;right:8px;z-index:2147483647;display:flex;gap:2px;-webkit-app-region:no-drag;';
  document.documentElement.appendChild(box);
  var style = document.createElement('style');
  style.textContent =
    '#dsh-float-controls button{all:unset;width:32px;height:24px;text-align:center;cursor:default;' +
    'font:400 13px/24px system-ui,"Segoe UI",sans-serif;color:var(--dsh-desktop-titlebar-fg,oklch(85% .02 90));' +
    'border-radius:6px;background:transparent;}' +
    '#dsh-float-controls button:hover{background:var(--dsh-desktop-titlebar-hover,oklch(29% .01 40));}' +
    '#dsh-float-controls button[data-act="close"]:hover{background:var(--dsh-desktop-titlebar-close-hover,oklch(65% .15 30));}';
  document.head.appendChild(style);
  box.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      var w = window.dshShell;
      if (!w) return;
      try { if (w.windowControl) w.windowControl(b.getAttribute('data-act')); } catch (e) { /* 忽略 */ }
    });
  });
})();`;

/**
 * DSH 页面拖拽区（无标题栏后）：应用自身顶部 header = 拖拽区，
 * header 内交互元素 no-drag；右侧留 140px 给悬浮按钮。MutationObserver 兜底 SPA 视图切换。
 */
export const DSH_HEADER_DRAG_SCRIPT = `(function () {
  function apply() {
    var h = document.querySelector('header');
    if (!h || h.dataset.dshDrag === '1') return;
    h.dataset.dshDrag = '1';
    h.style.setProperty('-webkit-app-region', 'drag');
    var pr = parseInt(h.style.paddingRight || window.getComputedStyle(h).paddingRight, 10) || 0;
    h.style.setProperty('padding-right', Math.max(pr, 140) + 'px');
    h.querySelectorAll('button,[role=button],a,input,select,textarea').forEach(function (el) {
      el.style.setProperty('-webkit-app-region', 'no-drag');
    });
  }
  apply();
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
})();`;

/** 壳本地页（file://）顶部透明拖拽条（右上角让出悬浮按钮） */
export const PAGE_DRAG_SCRIPT = `(function () {
  if (document.getElementById('dsh-page-drag')) return;
  var s = document.createElement('div');
  s.id = 'dsh-page-drag';
  s.style.cssText =
    'position:fixed;top:0;left:0;right:160px;height:28px;z-index:2147483646;-webkit-app-region:drag;';
  document.documentElement.appendChild(s);
})();`;

/** 壳本地页面主题初始化（file:// 页面注入）：按 ?uiTheme= 落 html[data-dsh-theme]（缺省深色） */
export const PAGE_THEME_SCRIPT = `(function () {
  if (document.documentElement.hasAttribute('data-dsh-theme')) return;
  var theme = 'dark';
  try {
    var p = new URLSearchParams(location.search).get('uiTheme');
    if (p === 'light') theme = 'light';
  } catch (e) { /* 缺省深色 */ }
  document.documentElement.setAttribute('data-dsh-theme', theme);
})();`;

/**
 * 壳本地页面主题 CSS（file:// 页面注入）：深浅两套 --dsh-desktop-* 变量 + 滚动条 + color-scheme。
 * 页面自身 :root 的 --bg/--card 等 token 已按深色定义；浅色由页面各自的
 * html[data-dsh-theme="light"] 覆写块提供（各页样式表自带）。
 */
export const PAGE_THEME_CSS =
  'html[data-dsh-theme="dark"]{color-scheme:dark;'
  + '--dsh-desktop-titlebar-bg:oklch(0.16 0.01 30);'
  + '--dsh-desktop-titlebar-border:oklch(0.31 0.01 35);'
  + '--dsh-desktop-titlebar-fg:oklch(0.85 0.02 90);'
  + '--dsh-desktop-titlebar-fg-dim:oklch(0.75 0.02 80);'
  + '--dsh-desktop-titlebar-hover:oklch(0.29 0.01 40);'
  + '--dsh-desktop-titlebar-close-hover:oklch(0.65 0.15 30);'
  + '--dsh-desktop-scroll-thumb:oklch(0.32 0.03 50 / 0.4);'
  + '--dsh-desktop-scroll-thumb-hover:oklch(0.32 0.03 50 / 0.6);}'
  + 'html[data-dsh-theme="light"]{color-scheme:light;'
  + '--dsh-desktop-titlebar-bg:oklch(0.97 0.02 85);'
  + '--dsh-desktop-titlebar-border:oklch(0.85 0.02 70);'
  + '--dsh-desktop-titlebar-fg:oklch(0.25 0.02 40);'
  + '--dsh-desktop-titlebar-fg-dim:oklch(0.45 0.02 50);'
  + '--dsh-desktop-titlebar-hover:oklch(0.92 0.02 80);'
  + '--dsh-desktop-titlebar-close-hover:oklch(0.65 0.15 30);'
  + '--dsh-desktop-scroll-thumb:oklch(0.32 0.03 50 / 0.3);'
  + '--dsh-desktop-scroll-thumb-hover:oklch(0.32 0.03 50 / 0.5);}'
  + '::-webkit-scrollbar{width:10px;height:10px;}'
  + '::-webkit-scrollbar-thumb{background:var(--dsh-desktop-scroll-thumb,oklch(0.32 0.03 50 / 0.4));border-radius:6px;border:2px solid transparent;background-clip:padding-box;}'
  + '::-webkit-scrollbar-thumb:hover{background:var(--dsh-desktop-scroll-thumb-hover,oklch(0.32 0.03 50 / 0.6));background-clip:padding-box;}'
  + '::-webkit-scrollbar-track{background:transparent;}'
  + '::-webkit-scrollbar-corner{background:transparent;}';
