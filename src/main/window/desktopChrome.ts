/**
 * 桌面外观注入（[D83]/[D84]/[D85] + 用户拍板：无标题栏）——壳与截屏验证脚本共用，防止两处漂移。
 * - FLOATING_CONTROLS_SCRIPT：右上角悬浮窗口按钮（设置齿轮 + 最小化/最大化/关闭），
 *   配色走 --dsh-desktop-* 变量，整窗随主题无缝换肤（深色=白鲸风暖色、浅色=暖沙）。
 * - DRAG_BAR_SCRIPT：顶部 6px 原生拖拽条（-webkit-app-region: drag）——替代旧 JS setPosition
 *   拖拽（旧方案在 150% 缩放下窗口会漂移变大、且无双击最大化；原生拖拽自带双击最大化）。
 * - DESKTOP_CSS：DSH 页面注入（深色细滚动条变量化；不再下移内容——标题栏已删除）。
 * - PAGE_THEME_SCRIPT / PAGE_THEME_CSS：壳本地页面的主题初始化（按 ?uiTheme= 落 html[data-dsh-theme]）。
 */

export const DESKTOP_CSS =
  '::-webkit-scrollbar{width:10px;height:10px;}'
  + '::-webkit-scrollbar-thumb{background:var(--dsh-desktop-scroll-thumb,oklch(0.32 0.03 50 / 0.4));border-radius:6px;border:2px solid transparent;background-clip:padding-box;}'
  + '::-webkit-scrollbar-thumb:hover{background:var(--dsh-desktop-scroll-thumb-hover,oklch(0.32 0.03 50 / 0.6));background-clip:padding-box;}'
  + '::-webkit-scrollbar-track{background:transparent;}'
  + '::-webkit-scrollbar-corner{background:transparent;}';

/** 右上角悬浮窗口按钮（用户拍板：删除标题栏，原窗口按钮直接放右上角；设置入口在 DSH 官方设置内）。
 *  新增"检查更新"按钮（[D78]，OpenChamber 风格图标）：点击即走自动更新（检查→自动下载→用户确认安装）。 */
export const FLOATING_CONTROLS_SCRIPT = `(function () {
  if (document.getElementById('dsh-float-controls')) return;
  var box = document.createElement('div');
  box.id = 'dsh-float-controls';
  box.innerHTML =
    '<button data-act="check-update" title="\\u68c0\\u67e5\\u66f4\\u65b0">' +
      '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5V6H10"/></svg>' +
    '</button>' +
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
    '#dsh-float-controls button[data-act="check-update"]{display:flex;align-items:center;justify-content:center;cursor:pointer;}' +
    '#dsh-float-controls button:hover{background:var(--dsh-desktop-titlebar-hover,oklch(29% .01 40));}' +
    '#dsh-float-controls button[data-act="close"]:hover{background:var(--dsh-desktop-titlebar-close-hover,oklch(65% .15 30));}';
  document.head.appendChild(style);
  box.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      // 只响应真实用户点击；合成 click（isTrusted=false）一律忽略——
      // 否则 DSH React 高频重渲染下会被反复自动触发，导致每 ~5s 刷一次"检查更新"
      if (ev && ev.isTrusted === false) return;
      var w = window.dshShell;
      if (!w) return;
      var act = b.getAttribute('data-act');
      try {
        if (act === 'check-update') { if (w.checkForUpdates) w.checkForUpdates(); }
        else if (w.windowControl) w.windowControl(act);
      } catch (e) { /* 忽略 */ }
    });
  });
})();`;

/**
 * 顶部原生拖拽条（-webkit-app-region: drag）——替代旧的 JS setPosition 拖拽。
 *
 * 为什么换掉 JS 拖拽：旧方案 16ms setPosition 跟随，在 150% 缩放下 DIP/物理像素换算漂移
 * → 按住标题区窗口"自己越变越大"；且旧方案没有双击最大化。原生 app-region:drag 由 Windows
 * 自己处理拖拽，无漂移、自带双击最大化、正确配合缩放边与 Aero 贴靠。
 *
 * 高度 24px：DSH 顶部是会话 header（面包屑/标签按钮），没有空白标题栏；拖拽条盖住顶部 24px，
 * 但脚本会把顶部 24px 内的交互元素（button/a/input/role=tab…）动态标 no-drag 并抬到拖拽条之上，
 * 让它们仍可点击；空白处仍是拖拽区。悬浮按钮 z-index 更高、no-drag，不受影响。
 */
export const DRAG_BAR_SCRIPT = `(function () {
  if (document.getElementById('dsh-drag-bar')) return;
  var DRAG_H = 24;
  var bar = document.createElement('div');
  bar.id = 'dsh-drag-bar';
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;height:' + DRAG_H + 'px;z-index:10;-webkit-app-region:drag;';
  document.documentElement.appendChild(bar);

  // 顶部 24px 内的交互元素标 no-drag 并抬到拖拽条之上，保持可点击
  var SEL = 'button,a,input,select,textarea,label,[role=button],[role=tab],[contenteditable="true"]';
  function patch() {
    var els = document.querySelectorAll(SEL);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.getAttribute('data-dsh-nodrag')) continue;
      var r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= DRAG_H) continue; // 不在顶部条内
      el.setAttribute('data-dsh-nodrag', '1');
      el.style.webkitAppRegion = 'no-drag';
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.style.zIndex = '11';
    }
    // 给右上角悬浮窗口按钮留位：顶部会话 header 的标题行加右 padding，
    // 避免 DSH 的「导出/下载对话」等按钮和悬浮按钮重叠
    var headers = document.querySelectorAll('header');
    for (var k = 0; k < headers.length; k++) {
      var h = headers[k];
      if (h.getAttribute('data-dsh-padded')) continue;
      var hr = h.getBoundingClientRect();
      if (hr.top > 8 || hr.bottom <= 0) continue; // 只处理贴顶的 header
      var row = h.firstElementChild;
      if (!row) continue;
      h.setAttribute('data-dsh-padded', '1');
      row.style.paddingRight = '150px';
    }
  }
  var timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; patch(); }, 120);
  }
  schedule();
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
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
