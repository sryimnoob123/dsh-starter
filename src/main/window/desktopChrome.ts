/**
 * 桌面外观注入（[D83]/[D84]：整窗 OpenChamber 化）——壳与截屏验证脚本共用，防止两处漂移。
 * - TITLEBAR_SCRIPT：自绘标题栏注入脚本（IIFE 字符串，executeJavaScript 用）
 * - DESKTOP_CSS：DSH 页面注入样式（深色 color-scheme + 细深色滚动条 + 内容下移让出标题栏）
 */

export const TITLEBAR_HEIGHT = 36;

export const DESKTOP_CSS =
  ':root{color-scheme:dark;}'
  + '::-webkit-scrollbar{width:10px;height:10px;}'
  + '::-webkit-scrollbar-thumb{background:oklch(33% .01 40);border-radius:6px;border:2px solid transparent;background-clip:padding-box;}'
  + '::-webkit-scrollbar-thumb:hover{background:oklch(45% .02 60);background-clip:padding-box;}'
  + '::-webkit-scrollbar-track{background:transparent;}'
  + '::-webkit-scrollbar-corner{background:transparent;}'
  // 标题栏挂在 html 上（fixed 顶部，不随 body 移动），body 用 transform 下移 36px 让出标题栏。
  // 高度必须用「html body」提高优先级，覆盖应用自身的 body{height:100%}（base.css 后加载）：
  // 否则 body 保持 100vh 高、translateY 后底部 36px 被 html 的 overflow:hidden 裁掉（统计条被挡）。
  // 保留 transform（不换 padding）：transform 让 body 成为 fixed 后代的包含块，
  // 弹层/灯箱/菜单整体下移 36px，其顶部控件不会被自绘标题栏压住。
  + 'html{height:100vh;overflow:hidden;}'
  + `html body{margin:0;height:calc(100vh - ${TITLEBAR_HEIGHT}px);transform:translateY(${TITLEBAR_HEIGHT}px);overflow:hidden;}`;

export const TITLEBAR_SCRIPT = `(function () {
  if (document.getElementById('dsh-titlebar')) return;
  var bar = document.createElement('div');
  bar.id = 'dsh-titlebar';
  bar.innerHTML =
    '<span class="dsh-title">deepseekharness</span>' +
    '<span class="dsh-controls">' +
    '<button data-act="minimize" title="最小化">&#9472;</button>' +
    '<button data-act="toggle-maximize" title="最大化/还原">&#9633;</button>' +
    '<button data-act="close" title="关闭（缩到托盘）">&#10005;</button>' +
    '</span>';
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;height:${TITLEBAR_HEIGHT}px;z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:space-between;' +
    'padding:0 6px 0 14px;background:#151313;border-bottom:1px solid oklch(31% .01 35);' +
    'color:oklch(85% .02 90);font:600 13px/36px system-ui,"Segoe UI",sans-serif;' +
    '-webkit-app-region:drag;user-select:none;';
  // 挂在 html 上（body 会被下移 36px，标题栏钉在最顶不受影响）
  document.documentElement.appendChild(bar);
  var style = document.createElement('style');
  style.textContent =
    '#dsh-titlebar .dsh-title{font-size:12.5px;letter-spacing:.3px;color:oklch(75% .02 80);}' +
    '#dsh-titlebar .dsh-controls{display:flex;gap:2px;}' +
    '#dsh-titlebar button{all:unset;width:42px;height:26px;text-align:center;cursor:default;' +
    'font:400 15px/26px system-ui,"Segoe UI",sans-serif;color:oklch(85% .02 90);' +
    'border-radius:6px;-webkit-app-region:no-drag;}' +
    '#dsh-titlebar button:hover{background:oklch(33% .01 40);}' +
    '#dsh-titlebar button[data-act="close"]:hover{background:oklch(65% .15 30);}';
  document.head.appendChild(style);
  bar.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      var w = window.dshShell;
      if (w && w.windowControl) {
        try { w.windowControl(b.getAttribute('data-act')); } catch (e) { /* 忽略 */ }
      }
    });
  });
})();`;
