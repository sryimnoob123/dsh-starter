import { cpSync, mkdirSync, readFileSync } from 'node:fs';

// 构建后拷贝壳本地页面到 dist（app.ts 按 __dirname 引用 pages/*.html）
cpSync('src/main/pages', 'dist/main/pages', { recursive: true });

// 拷贝沙箱 preload（纯 CJS，不参与 tsc 编译；app.ts 按 __dirname 引用 bridge/preload.cjs）
mkdirSync('dist/main/bridge', { recursive: true });
cpSync('src/main/bridge/preload.cjs', 'dist/main/bridge/preload.cjs');

// 更新进度窗 preload（同样纯 CJS 沙箱；progressWindow.ts 按 __dirname 引用 updater/update-preload.cjs）
mkdirSync('dist/main/updater', { recursive: true });
cpSync('src/main/updater/update-preload.cjs', 'dist/main/updater/update-preload.cjs');

// 拷贝 shell-rescue 预编译产物（vendor-rescue 是独立库 npm run sync 的落点；
// 纯 .js + .d.ts，tsc 只做类型解析不 emit，须随构建拷进 dist 供运行时加载）
cpSync('src/main/vendor-rescue', 'dist/main/vendor-rescue', { recursive: true });

// 桥契约护栏（[审查 M2]）：preload.cjs 的通道名集合必须与 contract.ts 的 BRIDGE_API 值集合一致。
// preload 是纯 CJS 沙箱不能 import TS，改方法名漏改 preload 是静默失败（页面 invoke 落空）——
// 这里在构建时直接 diff，防漂移。
{
  const contract = readFileSync('dist/main/bridge/contract.js', 'utf8');
  const preload = readFileSync('src/main/bridge/preload.cjs', 'utf8');
  // 两边都提取 'dsh:xxx' 通道名（contract 的 BRIDGE_API 值 / preload 的 API 表值）
  const apiValues = new Set([...contract.matchAll(/'dsh:[^']+'/g)].map((m) => m[0].slice(1, -1)));
  const preloadChannels = new Set([...preload.matchAll(/'dsh:[^']+'/g)].map((m) => m[0].slice(1, -1)));
  const missing = [...apiValues].filter((v) => !preloadChannels.has(v));
  const extra = [...preloadChannels].filter((v) => !apiValues.has(v));
  if (missing.length > 0 || extra.length > 0) {
    console.error(
      `bridge contract drift:\n  missing in preload: ${missing.join(', ') || '(none)'}\n  extra in preload: ${extra.join(', ') || '(none)'}`,
    );
    process.exit(1);
  }
  console.log(`bridge contract check passed: ${apiValues.size} channels in sync`);
}
