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
 * DSH 页面拖拽区（无标题栏后）：JS 拖拽，不碰页面布局。
 * 旧方案 querySelector('header') + -webkit-app-region:drag 在 DSH 升级为三栏 AppFrame 后失效
 * （主界面无应用级 header）；padding-top 下移内容又会撑出滚动条。
 * 现改为：在窗口顶部 28px 区域按住鼠标 → 通过 dshShell.windowControl 通知主进程跟随移动窗口，
 * 完全不改变 DSH 页面布局（无滚动条、无遮挡）。
 */
export const DSH_HEADER_DRAG_SCRIPT = `(function () {
  var DRAG_ZONE = 28;
  var dragging = false;
  function inZone(e) {
    return e.clientY >= 0 && e.clientY <= DRAG_ZONE;
  }
  document.addEventListener('mousedown', function (e) {
    // 只有鼠标左键 + 顶部 28px 空白区 + 不落在按钮/链接/输入等交互元素上，才进入拖拽
    if (e.button !== 0) return;
    if (!inZone(e)) return;
    var t = e.target;
    if (t && t.closest && t.closest('button,a,input,select,textarea,[role=button],[role=tab],[contenteditable="true"]')) return;
    var w = window.dshShell;
    if (!w || typeof w.windowControl !== 'function') return;
    dragging = true;
    try { w.windowControl('drag-start'); } catch (err) { dragging = false; }
  });
  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    var w = window.dshShell;
    if (w && typeof w.windowControl === 'function') {
      try { w.windowControl('drag-end'); } catch (err) { /* 忽略 */ }
    }
  });
  // 失焦/离开窗口时兜底结束拖拽，避免窗口"粘住"鼠标
  window.addEventListener('blur', function () {
    if (!dragging) return;
    dragging = false;
    var w = window.dshShell;
    if (w && typeof w.windowControl === 'function') {
      try { w.windowControl('drag-end'); } catch (err) { /* 忽略 */ }
    }
  });
})();`;

/** 壳本地页（file://）顶部拖拽：与 DSH 页面同款 JS 拖拽（不碰布局，右上角让出悬浮按钮） */
export const PAGE_DRAG_SCRIPT = `(function () {
  var DRAG_ZONE = 28;
  var dragging = false;
  function inZone(e) {
    return e.clientY >= 0 && e.clientY <= DRAG_ZONE;
  }
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (!inZone(e)) return;
    var t = e.target;
    if (t && t.closest && t.closest('button,a,input,select,textarea,[role=button],[contenteditable="true"]')) return;
    var w = window.dshShell;
    if (!w || typeof w.windowControl !== 'function') return;
    dragging = true;
    try { w.windowControl('drag-start'); } catch (err) { dragging = false; }
  });
  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    var w = window.dshShell;
    if (w && typeof w.windowControl === 'function') {
      try { w.windowControl('drag-end'); } catch (err) { /* 忽略 */ }
    }
  });
  window.addEventListener('blur', function () {
    if (!dragging) return;
    dragging = false;
    var w = window.dshShell;
    if (w && typeof w.windowControl === 'function') {
      try { w.windowControl('drag-end'); } catch (err) { /* 忽略 */ }
    }
  });
})();`;

/**
 * 轨迹视图底部清理（用户拍板）：切到"轨迹"标签时，底部固定层（任务卡 + 输入框，
 * 都在 composerSeat 容器内）会挡住轨迹表格——选轨迹时隐藏该容器，回到"对话"时恢复。
 * 锚点：role=tab 的 aria-selected + composerSeat 语义后缀（不依赖哈希前缀）。
 */
export const VIEW_TAB_SCRIPT = `(function () {
  function seats() {
    // 有排队消息/任务卡时，底部固定层 = composerStack（含输入框 + 队列 dock）；
    // 无排队时 DSH 收成零高 composerSeat。两者任一在场都归它管，dock 再兜底。
    // dock 用 "_dock" 语义后缀（DSH 哈希类名 = 前缀_后缀），避免子串误伤 dashboard 等。
    return Array.prototype.slice.call(
      document.querySelectorAll('div[class*="composerStack"],div[class*="composerSeat"],div[class*="_dock"]'),
    );
  }
  function update() {
    var traj = Array.prototype.slice.call(document.querySelectorAll('[role=tab]')).some(function (t) {
      return /轨迹|Trajectory/.test(t.textContent || '') && t.getAttribute('aria-selected') === 'true';
    });
    seats().forEach(function (s) {
      s.style.display = traj ? 'none' : '';
    });
  }
  var timer = null;
  function schedule() {
    // 防抖：与拖拽区脚本同款——活跃会话高频重渲染时合并查询
    if (timer) return;
    timer = setTimeout(function () { timer = null; update(); }, 120);
  }
  schedule();
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-selected'],
  });
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
  + '::-webkit-scrollbar-corner{background:transparent;}'
  // OC 排版语言统一（壳本地页共享；提示词设置页已按 OC 原生重建，其 .oc-* 类优先级更高不受影响）：
  // 9px 圆角、18px 静音页题（OC L1 = 比 section 更安静）、36px 主按钮、输入 9px 圆角、柔和阴影。
  // 注意：insertCSS 是 inspector 表，在作者表里排序靠前，同特异性赢不了页面自身规则——
  // 用 body 前缀提高特异性（0,1,1 > 0,1,0），与顺序无关。
  + 'body .card{border-radius:9px;box-shadow:0 6px 20px rgba(0,0,0,0.22);}'
  + 'body h1{font-size:18px;font-weight:600;color:var(--text-2,oklch(0.75 0.02 80));}'
  + 'body .btn{min-height:36px;border-radius:9px;}'
  + 'body input,body select,body textarea{border-radius:9px;}';
