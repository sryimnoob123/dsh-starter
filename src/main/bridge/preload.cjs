/**
 * dshShell 桥 preload（[D79] 外包包 §2 契约的页面侧实现）。
 *
 * - 沙箱 preload（sandbox: true）只允许 require('electron') 的受限面：contextBridge / ipcRenderer。
 * - 方法名与通道名必须和 src/main/bridge/contract.ts 的 BRIDGE_API 一一对应，
 *   contract.test.ts 锁定方法面——改任一侧先同步另一侧 + 外包包 §2 + 变更记录。
 * - 本文件是纯 CJS（沙箱 preload 不支持 ESM），构建时由 scripts/postbuild.mjs 原样拷入 dist。
 */
const { contextBridge, ipcRenderer } = require('electron');

const API = {
  retry: 'dsh:retry',
  quit: 'dsh:quit',
  openLogs: 'dsh:openLogs',
  readLog: 'dsh:readLog',
  goInstall: 'dsh:goInstall',
  choosePort: 'dsh:choosePort',
  startInstall: 'dsh:startInstall',
  pickDir: 'dsh:pickDir',
  testConnection: 'dsh:testConnection',
  saveConnection: 'dsh:saveConnection',
  discoverModels: 'dsh:discoverModels',
  getPromptSettings: 'dsh:getPromptSettings',
  savePromptSettings: 'dsh:savePromptSettings',
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
  choosePort: (port) => ipcRenderer.invoke(API.choosePort, port),
  startInstall: () => ipcRenderer.invoke(API.startInstall),
  pickDir: () => ipcRenderer.invoke(API.pickDir),
  testConnection: (config) => ipcRenderer.invoke(API.testConnection, config),
  saveConnection: (config) => ipcRenderer.invoke(API.saveConnection, config),
  discoverModels: (config) => ipcRenderer.invoke(API.discoverModels, config),
  getPromptSettings: () => ipcRenderer.invoke(API.getPromptSettings),
  savePromptSettings: (input) => ipcRenderer.invoke(API.savePromptSettings, input),
  windowControl: (action) => ipcRenderer.invoke(API.windowControl, action),
  onServiceStatus: (cb) => subscribe(API.onServiceStatus, cb),
  onProgress: (cb) => subscribe(API.onProgress, cb),
};

contextBridge.exposeInMainWorld('dshShell', Object.freeze(dshShell));
