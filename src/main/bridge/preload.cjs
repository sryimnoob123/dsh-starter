/**
 * dshShell 桥 preload（[D79] 外包包 §2 契约的页面侧实现）。
 *
 * - 沙箱 preload（sandbox: true）只允许 require('electron') 的受限面：contextBridge / ipcRenderer / webUtils。
 * - 方法名与通道名必须和 src/main/bridge/contract.ts 的 BRIDGE_API 一一对应，
 *   contract.test.ts 锁定方法面——改任一侧先同步另一侧 + 外包包 §2 + 变更记录。
 * - 本文件是纯 CJS（沙箱 preload 不支持 ESM），构建时由 scripts/postbuild.mjs 原样拷入 dist。
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const API = {
  retry: 'dsh:retry',
  quit: 'dsh:quit',
  openLogs: 'dsh:openLogs',
  readLog: 'dsh:readLog',
  goInstall: 'dsh:goInstall',
  selectDshDirectory: 'dsh:selectDshDirectory',
  openPromptSettings: 'dsh:openPromptSettings',
  openMain: 'dsh:openMain',
  choosePort: 'dsh:choosePort',
  startInstall: 'dsh:startInstall',
  pickDir: 'dsh:pickDir',
  testConnection: 'dsh:testConnection',
  saveConnection: 'dsh:saveConnection',
  discoverModels: 'dsh:discoverModels',
  getPromptSettings: 'dsh:getPromptSettings',
  savePromptSettings: 'dsh:savePromptSettings',
  readNotifications: 'dsh:readNotifications',
  clearNotifications: 'dsh:clearNotifications',
  listProjectInstructions: 'dsh:listProjectInstructions',
  saveProjectInstruction: 'dsh:saveProjectInstruction',
  getSessionUsage: 'dsh:getSessionUsage',
  filePathMenu: 'dsh:filePathMenu',
  filePathOpen: 'dsh:filePathOpen',
  windowControl: 'dsh:windowControl',
  onServiceStatus: 'dsh:status',
  onProgress: 'dsh:progress',
};

/** 订阅壳推来的事件；返回取消订阅函数（页面可保存下来在需要时调用） */
function subscribe(channel, cb) {
  if (typeof cb !== 'function') throw new TypeError('dshShell: 订阅需要一个回调函数');
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const dshShell = {
  retry: () => ipcRenderer.invoke(API.retry),
  quit: () => ipcRenderer.invoke(API.quit),
  openLogs: () => ipcRenderer.invoke(API.openLogs),
  readLog: (kind) => ipcRenderer.invoke(API.readLog, kind),
  goInstall: () => ipcRenderer.invoke(API.goInstall),
  selectDshDirectory: () => ipcRenderer.invoke(API.selectDshDirectory),
  openPromptSettings: () => ipcRenderer.invoke(API.openPromptSettings),
  openMain: () => ipcRenderer.invoke(API.openMain),
  choosePort: (port) => ipcRenderer.invoke(API.choosePort, port),
  startInstall: () => ipcRenderer.invoke(API.startInstall),
  pickDir: () => ipcRenderer.invoke(API.pickDir),
  testConnection: (config) => ipcRenderer.invoke(API.testConnection, config),
  saveConnection: (config) => ipcRenderer.invoke(API.saveConnection, config),
  discoverModels: (config) => ipcRenderer.invoke(API.discoverModels, config),
  getPromptSettings: () => ipcRenderer.invoke(API.getPromptSettings),
  savePromptSettings: (input) => ipcRenderer.invoke(API.savePromptSettings, input),
  readNotifications: () => ipcRenderer.invoke(API.readNotifications),
  clearNotifications: () => ipcRenderer.invoke(API.clearNotifications),
  listProjectInstructions: () => ipcRenderer.invoke(API.listProjectInstructions),
  saveProjectInstruction: (input) => ipcRenderer.invoke(API.saveProjectInstruction, input),
  getSessionUsage: () => ipcRenderer.invoke(API.getSessionUsage),
  filePathMenu: (path) => ipcRenderer.invoke(API.filePathMenu, path),
  filePathOpen: (path) => ipcRenderer.invoke(API.filePathOpen, path),
  windowControl: (action) => ipcRenderer.invoke(API.windowControl, action),
  onServiceStatus: (cb) => subscribe(API.onServiceStatus, cb),
  onProgress: (cb) => subscribe(API.onProgress, cb),
};

contextBridge.exposeInMainWorld('dshShell', Object.freeze(dshShell));

// ---------------------------------------------------------------------------
// 拖拽引用路径（[FR-11.1]）：拖文件进对话 → 输入框插入 @绝对路径，取代「不支持的文件格式」。
// 只能写在这里：沙箱渲染器里 webUtils.getPathForFile 只在 preload 可用；全程不碰 DSH 主仓库。
// 规则（用户拍板）：全图片 → 交给 DSH 现有视觉输入（有缩略图）；
// 含非图片（或混拖）→ 全部转 @绝对路径，AI 依内容自行处理。
// ---------------------------------------------------------------------------
(function () {
  function realPath(file) {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file) || '';
      }
    } catch (_e) { /* 拿不到真实路径时退回文件名 */ }
    return '';
  }

  function isImage(file) {
    return typeof file.type === 'string' && file.type.indexOf('image/') === 0;
  }

  /** 把 @路径块写进 React 受控 textarea（原生 setter + input 事件，React 的 onChange 才收得到） */
  function insertIntoComposer(textarea, block) {
    var proto = window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : null;
    if (!proto) return false;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!descriptor || typeof descriptor.set !== 'function') return false;
    var start = typeof textarea.selectionStart === 'number'
      ? textarea.selectionStart
      : textarea.value.length;
    var end = typeof textarea.selectionEnd === 'number'
      ? textarea.selectionEnd
      : textarea.value.length;
    var before = textarea.value.slice(0, start);
    var prefix = before.length > 0 && before.charAt(before.length - 1) !== '\n' ? '\n' : '';
    var text = prefix + block;
    descriptor.set.call(textarea, before + text + textarea.value.slice(end));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    var caret = start + text.length;
    try { textarea.setSelectionRange(caret, caret); } catch (_e) { /* 忽略 */ }
    try { textarea.focus(); } catch (_e) { /* 忽略 */ }
    return true;
  }

  /** 定位 composer 输入框（data-* 属性是稳定锚点，CSS 模块不哈希 data 属性） */
  function findComposer() {
    return document.querySelector('textarea[data-phase]')
      || document.querySelector('[data-input-scroll] textarea');
  }

  document.addEventListener('drop', function (event) {
    var dt = event.dataTransfer;
    if (!dt || !dt.types || Array.prototype.indexOf.call(dt.types, 'Files') === -1) return;
    var files = Array.prototype.slice.call(dt.files || []);
    if (files.length === 0) return;
    var hasNonImage = files.some(function (f) { return !isImage(f); });
    // 全图片 → 交给 DSH 现有视觉输入（有缩略图）
    if (!hasNonImage) return;
    var textarea = findComposer();
    if (!textarea) return;
    if (textarea.disabled || textarea.readOnly) return; // 锁定态交给 DSH 处理
    // 接管（capture 阶段 + stopPropagation 压掉 DSH 的 drop），插 @绝对路径
    event.preventDefault();
    event.stopPropagation();
    var lines = files.map(function (f) {
      var p = realPath(f);
      return '@' + (p || f.name || '');
    });
    insertIntoComposer(textarea, lines.join('\n'));
    // DSH 的 onDrop 被压掉后不会 reset 拖拽遮罩；补一个 dragend 触发它的 reset 清掉遮罩
    try { window.dispatchEvent(new Event('dragend')); } catch (_e) { /* 忽略 */ }
  }, true);
})();
