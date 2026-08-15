/**
 * 官方鲸鱼图标栅格化（[D14] 官方黑色鲸鱼，资产版权归 DeepSeek）：
 * 来源 = DSH 仓库 apps/web/public/favicon.svg（官方 logo 几何），
 * 用 Electron 离屏渲染成 512×512 透明底 PNG → assets/icon.png。
 * WHITE=1 时渲染白色鲸鱼 → assets/icon-white.png（深色主题用白鲸，浅色用黑鲸）。
 * 用法：electron scripts/render-icon.mjs（黑鲸）；$env:WHITE='1'; electron scripts/render-icon.mjs（白鲸）
 */
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 来源 = DeepSeek Harness 的 apps/web/public/favicon.svg（官方 logo 几何）。
// 不硬编码任何本机路径：由 DSH_FAVICON_SVG 显式指定，避免把个人 checkout 路径带进开源仓库。
const SVG_SOURCE = process.env.DSH_FAVICON_SVG;
if (!SVG_SOURCE) {
  throw new Error('DSH_FAVICON_SVG 未设置：请指向 DeepSeek Harness 的 apps/web/public/favicon.svg');
}
const WHITE = process.env.WHITE === '1';
const OUT = join(__dirname, '..', 'assets', WHITE ? 'icon-white.png' : 'icon.png');
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

  // 黑鲸 = 去掉样式（path 无 fill → 默认黑）；白鲸 = 样式强制白填充（深色主题用白鲸）
  const svg = readFileSync(SVG_SOURCE, 'utf8')
    .replace(/<style>[\s\S]*?<\/style>/, WHITE ? '<style>path{fill:#fff;}</style>' : '')
    .replace(/width="[^"]*"/, `width="${SIZE}"`)
    .replace(/height="[^"]*"/, `height="${SIZE}"`);
  console.log(`rendering ${WHITE ? 'white' : 'black'} whale`);

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
