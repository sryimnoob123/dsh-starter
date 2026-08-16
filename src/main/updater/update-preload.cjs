/**
 * 更新进度窗 preload（沙箱 preload，纯 CJS；构建时由 scripts/postbuild.mjs 拷入 dist）。
 * 只暴露两个入口：onState（订阅主进程推来的进度帧）+ action（回传按钮动作）。
 * 与主桥 dshShell 无关（进度窗是独立小窗，不参与冻结的桥契约）。
 */
const { contextBridge, ipcRenderer } = require('electron');

const STATE_CHANNEL = 'dsh:update-state';
const ACTION_CHANNEL = 'dsh:update-action';

const dshUpdate = {
  /** 订阅进度状态帧；返回取消订阅函数 */
  onState(cb) {
    if (typeof cb !== 'function') throw new TypeError('dshUpdate.onState 需要一个回调函数');
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on(STATE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(STATE_CHANNEL, listener);
  },
  /** 回传按钮动作：'install' | 'dismiss' | 'retry' */
  action(action) {
    return ipcRenderer.invoke(ACTION_CHANNEL, action);
  },
};

contextBridge.exposeInMainWorld('dshUpdate', Object.freeze(dshUpdate));