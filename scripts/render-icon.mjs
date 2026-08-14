/**
 * 官方鲸鱼图标栅格化（[D14] 官方黑色鲸鱼，资产版权归 DeepSeek）：
 * 来源 = DSH 仓库 apps/web/public/favicon.svg（官方 logo 几何），
 * 用 Electron 离屏渲染成 512×512 透明底 PNG → assets/icon.png。
 * 用法：electron scripts/render-icon.mjs
 */
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVG_SOURCE = process.env.DSH_FAVICON_SVG ?? 'path/to/deepseek-harness/apps/web/public/favicon.svg';
const OUT = join(__dirname, '..', 'assets', 'icon.png');
const SIZE = 512;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });

  // 去掉暗色模式变体样式（保留官方自带的黑色填充），放大到 512
  const svg = readFileSync(SVG_SOURCE, 'utf8')
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/width="[^"]*"/, `width="${SIZE}"`)
    .replace(/height="[^"]*"/, `height="${SIZE}"`);
  console.log(`svg head: ${svg.slice(0, 120)}`);
  console.log(`fill count: ${(svg.match(/fill=/g) ?? []).length}`);

  try {
    await win.loadURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
    // 等一帧渲染
    await new Promise((resolve) => setTimeout(resolve, 600));
    const image = await win.webContents.capturePage();
    writeFileSync(OUT, image.toPNG());
    console.log(`icon written: ${OUT} (${image.getSize().width}x${image.getSize().height})`);
  } catch (error) {
    console.error(`render failed: ${String(error)}`);
  }
  app.exit(0);
});
