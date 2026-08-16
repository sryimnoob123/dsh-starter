import { cpSync, mkdirSync } from 'node:fs';

// 构建后拷贝壳本地页面到 dist（app.ts 按 __dirname 引用 pages/*.html）
cpSync('src/main/pages', 'dist/main/pages', { recursive: true });

// 拷贝沙箱 preload（纯 CJS，不参与 tsc 编译；app.ts 按 __dirname 引用 bridge/preload.cjs）
mkdirSync('dist/main/bridge', { recursive: true });
cpSync('src/main/bridge/preload.cjs', 'dist/main/bridge/preload.cjs');

// 更新进度窗 preload（同样纯 CJS 沙箱；progressWindow.ts 按 __dirname 引用 updater/update-preload.cjs）
mkdirSync('dist/main/updater', { recursive: true });
cpSync('src/main/updater/update-preload.cjs', 'dist/main/updater/update-preload.cjs');
