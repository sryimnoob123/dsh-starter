/**
 * 文件路径动作注入脚本（壳侧承接 DSH 对话里的文件路径，[FR-11.1] 引用路径的"打开/定位/复制"面）：
 * - 右键文件路径 → 弹壳菜单（复制路径 / 打开所在位置 / 直接打开文件）。
 * - 左键文件路径 → 由壳用 shell.openPath 打开（解决 DSH 用 Invoke-Item 打开时外部窗口不置顶）。
 * - 让路径文字可鼠标框选复制（拖选不触发打开）。
 *
 * 稳定性设计（与 settingsExtension 同一套）：
 * - 不依赖哈希类名：用可读类名子串 fileLink/fileMention + data-produced-files-row 锚点识别；
 *   监听挂在 document 捕获阶段（事件委托），DSH SPA 重渲染不需要重新绑定。
 * - 路径解析交给主进程（session.list 现查当前会话 cwd），页面只传路径文本。
 */
export const FILE_PATH_EXTENSION_SCRIPT = `(function () {
  if (window.__dshFilePathExt) return;
  window.__dshFilePathExt = true;

  var shell = window.dshShell;
  if (!shell || typeof shell.filePathMenu !== 'function' || typeof shell.filePathOpen !== 'function') return;

  function text(el) { return (el.textContent || '').replace(/\\s+/g, ' ').trim(); }

  /** 从事件目标向上找"文件路径"元素，返回其路径文本；找不到返回 null。 */
  function pathOf(target) {
    var el = target;
    while (el && el.nodeType === 1 && el !== document.body) {
      var cls = typeof el.className === 'string' ? el.className : '';
      if (el.tagName === 'BUTTON') {
        // 工具行 fileLink / markdown fileMention（可读类名子串，避开哈希类名）
        if (cls.indexOf('fileLink') !== -1 || cls.indexOf('fileMention') !== -1) {
          var t = text(el);
          if (t) return t;
        }
        // 产出文件 chip：title 携带完整路径（showFolder 按钮无 title，自然排除）
        if (el.closest && el.closest('[data-produced-files-row]')) {
          var title = el.getAttribute('title');
          if (title && title.trim()) return title.trim();
          var bt = text(el);
          if (bt) return bt;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  // 右键：弹壳菜单（复制路径 / 打开所在位置 / 直接打开文件）；preventDefault 同时压掉壳的通用右键菜单
  document.addEventListener('contextmenu', function (event) {
    var path = pathOf(event.target);
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    shell.filePathMenu(path);
  }, true);

  // 左键：改由壳打开（外部窗口置顶）；区分"点击"与"拖选复制"——拖选时不打开
  var downX = -1, downY = -1;
  document.addEventListener('mousedown', function (event) {
    if (event.button === 0) { downX = event.clientX; downY = event.clientY; }
  }, true);
  document.addEventListener('click', function (event) {
    var path = pathOf(event.target);
    if (!path) return;
    // 拖选（鼠标位移 > 4px）= 用户在选择文本，不是点击打开
    var dragged = downX >= 0 && (Math.abs(event.clientX - downX) > 4 || Math.abs(event.clientY - downY) > 4);
    if (dragged) return;
    event.preventDefault();
    event.stopPropagation();
    shell.filePathOpen(path);
  }, true);
})();`;

/** 让文件路径文字可鼠标框选（左键拖选复制）；不影响点击打开（点击与拖选由脚本区分） */
export const FILE_PATH_SELECTABLE_CSS = `
button[class*="fileLink"], button[class*="fileMention"], [data-produced-files-row] button[title] {
  user-select: text !important;
  -webkit-user-select: text !important;
}
`;
