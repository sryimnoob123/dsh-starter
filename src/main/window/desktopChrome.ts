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
 *  "检查更新"按钮为多态状态按钮（Codex/OpenChamber 式，新版本醒目可见 + 进度可视化 + 一键下载/安装）：
 *  - 无更新：普通刷新图标（title「检查更新」）；
 *  - 有新版本：图标右上角叠琥珀色醒目标记，点击即开始下载；
 *  - 下载中：图标下方显示百分比进度环/数字，点击忽略；
 *  - 下载完成：图标换对勾 + 按钮高亮，点击即确认安装。
 *  主进程经 window.__dshSetUpdateState(state) 推状态（app.ts → executeJavaScript）；页面加载晚于状态变化时，
 *  主进程在 did-finish-load 后补推 getUpdateUiState()。状态切换不新增悬浮按钮、不占额外空间、不挡其他 UI。 */
export const FLOATING_CONTROLS_SCRIPT = `(function () {
  if (window.__dshUpdateBtnInstalled) return;
  window.__dshUpdateBtnInstalled = true;

  // ---- 更新状态提示条的渲染状态（由主进程推送；缺省 = 无提示）----
  var state = 'none';
  var updateVersion = '';
  var updatePercent = 0;

  // 提示条文案（available=发现新版本可下载 / downloading=下载中带进度 / downloaded=下载完可安装 / checking=检查中）
  function toastLabel() {
    if (state === 'checking') return '\\u68c0\\u67e5\\u66f4\\u65b0\\u4e2d\\u2026';
    if (state === 'downloading') return '\\u6b63\\u5728\\u4e0b\\u8f7d\\u65b0\\u7248\\u672c\\uff08' + Math.round(updatePercent) + '%\\uff09';
    if (state === 'downloaded') return '\\u4e0b\\u8f7d\\u5df2\\u5b8c\\u6210\\uff0c\\u8bf7\\u70b9\\u51fb\\u5b89\\u88c5';
    if (state === 'available') return '\\u53d1\\u73b0\\u65b0\\u7248\\u672c\\uff0c\\u70b9\\u6b64\\u4e0b\\u8f7d';
    return '';
  }
  function render() {
    var toast = document.getElementById('dsh-float-update-toast');
    if (!toast) return;
    var active = state === 'available' || state === 'downloaded';
    var show = active || state === 'downloading' || state === 'checking';
    toast.hidden = !show;
    if (show) {
      toast.textContent = toastLabel();
      toast.dataset.phase = state;
      toast.disabled = !active; // 下载中/检查中不可点，防重复触发
      toast.title = active ? '\\u70b9\\u51fb\\u540e\\u5b89\\u88c5\\u6216\\u4e0b\\u8f7d' : '';
    } else {
      toast.textContent = '';
      delete toast.dataset.phase;
      toast.disabled = false;
      toast.title = '';
    }
  }
  window.__dshSetUpdateState = function (s) {
    if (!s) return;
    // 空对象 = 复位（主进程 pushUi 初始态 {phase:'none'}；防御空对象不清 → 残留旧角标/提示条）
    state = (s.phase && s.phase !== 'none') ? s.phase : 'none';
    updateVersion = s.version || '';
    updatePercent = typeof s.percent === 'number' ? s.percent : 0;
    render();
  };

  // ---- DOM 注入（幂等：同一窗口只建一次）----
  if (document.getElementById('dsh-float-controls')) return;
  var box = document.createElement('div');
  box.id = 'dsh-float-controls';
  box.innerHTML =
    '<button id="dsh-float-update-toast" hidden class="dsh-update-toast" data-act="check-update"></button>' +
    '<button data-act="minimize" title="\\u6700\\u5c0f\\u5316">\\u2013</button>' +
    '<button data-act="toggle-maximize" title="\\u6700\\u5927\\u5316/\\u8fd8\\u539f">\\u25a1</button>' +
    '<button data-act="close" title="\\u5173\\u95ed\\uff08\\u7f29\\u5230\\u6258\\u76d8\\uff09">\\u00d7</button>';
  box.style.cssText =
    'position:fixed;top:6px;right:8px;z-index:2147483647;display:flex;align-items:center;gap:2px;-webkit-app-region:no-drag;';
  document.documentElement.appendChild(box);
  var style = document.createElement('style');
  style.textContent =
    '#dsh-float-controls button{all:unset;width:44px;height:36px;text-align:center;cursor:default;' +
    'font:400 13px/36px system-ui,"Segoe UI",sans-serif;color:var(--dsh-desktop-titlebar-fg,oklch(85% .02 90));' +
    'border-radius:6px;background:transparent;position:relative;}' +
    '#dsh-float-controls button:hover{background:var(--dsh-desktop-titlebar-hover,oklch(29% .01 40));}' +
    '#dsh-float-controls button[data-act="close"]:hover{background:var(--dsh-desktop-titlebar-close-hover,oklch(65% .15 30));}' +
    // 「新版本已发布，点此更新」提示条：琥珀胶囊，唯一更新入口（available/downloaded 可点，下载中/检查中禁点）
    '#dsh-float-controls .dsh-update-toast{all:unset;cursor:pointer;display:inline-flex;align-items:center;' +
    'white-space:nowrap;padding:0 12px;height:30px;border-radius:999px;margin-right:4px;' +
    'font:600 12px/1 system-ui,"Segoe UI",sans-serif;letter-spacing:0.2px;' +
    'color:var(--dsh-desktop-titlebar-fg,oklch(92% .03 90));' +
    'background:oklch(0.77 0.17 85 / 0.18);' +
    'border:1px solid var(--dsh-desktop-update-badge,oklch(0.77 0.17 85));' +
    'box-shadow:0 2px 10px oklch(0.16 0.05 60 / 0.35);' +
    'animation:dsh-update-toast-in 160ms ease-out;}' +
    '#dsh-float-controls .dsh-update-toast:hover{background:oklch(0.77 0.17 85 / 0.28);}' +
    '#dsh-float-controls .dsh-update-toast[disabled]{cursor:default;opacity:0.75;}' +
    '#dsh-float-controls .dsh-update-toast[hidden]{display:none;}' +
    '@keyframes dsh-update-toast-in{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){#dsh-float-controls .dsh-update-toast{animation:none}}';
  document.head.appendChild(style);
  box.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      // 只响应真实用户点击；合成 click（isTrusted=false）一律忽略——
      // 否则 DSH React 高频重渲染下会被反复自动触发，导致每 ~5s 刷一次"检查更新"
      if (ev && ev.isTrusted === false) return;
      if (b.disabled) return; // 下载中/检查中：不可点
      var w = window.dshShell;
      if (!w) return;
      var act = b.getAttribute('data-act');
      try {
        if (act === 'check-update') {
          // 一键下载/安装统一入口：主进程侧自动判断（有待装版本 → 安装；否则检查+下载）
          if (w.checkForUpdates) w.checkForUpdates();
        }
        else if (w.windowControl) w.windowControl(act);
      } catch (e) { /* 忽略 */ }
    });
  });
  render(); // 首次注入：按当前 state 初始化（缺省隐藏）
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
      row.style.paddingRight = '190px';
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
