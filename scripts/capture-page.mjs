/**
 * DSH 页面离屏截屏（配合 claude-vision 做"本仓库 AI 的眼睛"）：
 * 与壳共用 desktopChrome 注入（标题栏 + 深色滚动条 + 内容下移），截图 = 壳内真实效果。
 * 用法：pnpm build 后 electron scripts/capture-page.mjs [输出png] [等待毫秒]
 */
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { DESKTOP_CSS, DSH_HEADER_DRAG_SCRIPT, FLOATING_CONTROLS_SCRIPT } from '../dist/main/window/desktopChrome.js';

const OUT = process.argv[2] ?? 'out/dsh-capture.png';
const WAIT = Number(process.argv[3] ?? 5000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#151313',
    webPreferences: { offscreen: true },
  });
  try {
    await win.loadURL('http://127.0.0.1:3080');
    await win.webContents.executeJavaScript(FLOATING_CONTROLS_SCRIPT);
    await win.webContents.executeJavaScript(DSH_HEADER_DRAG_SCRIPT);
    await win.webContents.insertCSS(DESKTOP_CSS);
    await new Promise((resolve) => setTimeout(resolve, WAIT));
    const img = await win.webContents.capturePage();
    writeFileSync(OUT, img.toPNG());
    console.log(`captured: ${OUT} (${img.getSize().width}x${img.getSize().height})`);
  } catch (error) {
    console.error(`capture failed: ${String(error)}`);
  }
  app.exit(0);
});
