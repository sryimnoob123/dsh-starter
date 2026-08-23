// 种子净化：把验证过的插件快照（_tmp/backups/snapshots/seed-20260823-preload）净化成
// 安装包内种子（build/seed-dsh-home）。只保留 web profile 运行所需，剔除一切隐私。
// 运行：node scripts/prepare-seed.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(root, '_tmp', 'backups', 'snapshots', 'seed-20260823-preload');
// 输出目录名 = 安装后的种子顶层路径（dsh-home-seed），与 electron-builder to 与壳检查点一致
const OUT = join(root, 'build', 'dsh-home-seed');

/** 隐私/非运行文件标记：路径命中任一项即剔除（打包红线，发布前必须反证） */
const PRIVACY_MARKERS = [
  '.credentials.yaml',
  'sessions',
  'storages',
  'undo-snapshots',
  '.cache',
  'logs',
  'diagnostic-reports',
  'rescue-backups',
  '.bak',
  'plugin-manifest.txt',
  'state.txt',
];

function isPrivacyPath(rel) {
  return PRIVACY_MARKERS.some((m) => rel.split(/[\\/]/).some((seg) => seg.includes(m)));
}

function copyTree(src, dst, relPrefix) {
  let copied = 0;
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const rel = relPrefix ? `${relPrefix}/${entry}` : entry;
    if (isPrivacyPath(rel)) {
      console.log(`  [剔] ${rel}`);
      continue;
    }
    const dstPath = join(dst, entry);
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(dstPath, { recursive: true });
      copied += copyTree(srcPath, dstPath, rel);
    } else {
      cpSync(srcPath, dstPath);
      copied += 1;
    }
  }
  return copied;
}

if (!existsSync(SNAPSHOT)) {
  console.error(`快照不存在: ${SNAPSHOT}`);
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'profiles'), { recursive: true });

const srcWeb = join(SNAPSHOT, 'web');
if (!existsSync(srcWeb)) {
  console.error(`快照缺少 web/: ${srcWeb}`);
  process.exit(1);
}
const copied = copyTree(srcWeb, join(OUT, 'profiles', 'web'), 'profiles/web');

// [2026-08-23 真机修复] patch 显式引用的官方包实体补进种子 web node_modules：
// cordis.patch.yml 引用 `@deepseek-ai/dsh-plugin-manager`（插件管理入口），
// 该包在 vendor/dsh 的 DSH 运行时里，但种子快照的 web node_modules 没有它——
// DSH 自己管理 profiles fallback 层（不依赖手动建层），patch 引用的包必须实体存在
// 才能解析。从 vendor/dsh/node_modules/@deepseek-ai 拷对应实体（官方包，安全）。
const PATCH_REQUIRED_OFFICIAL = ['dsh-plugin-manager'];
const vendorAi = join(root, 'vendor', 'dsh', 'node_modules', '@deepseek-ai');
const seedAi = join(OUT, 'profiles', 'web', 'node_modules', '@deepseek-ai');
for (const pkg of PATCH_REQUIRED_OFFICIAL) {
  const src = join(vendorAi, pkg);
  const dst = join(seedAi, pkg);
  if (existsSync(src)) {
    mkdirSync(seedAi, { recursive: true });
    cpSync(src, dst, { recursive: true });
    console.log(`  [补] @deepseek-ai/${pkg}（patch 显式引用）`);
  } else {
    console.error(`[缺] vendor 里没有 @deepseek-ai/${pkg}——patch 引用无法满足`);
    process.exit(1);
  }
}
console.log(`净化完成: ${copied} 个文件 + 官方包补齐 → ${OUT}`);

// [2026-08-23 用户拍板：插件配置随包] 把开发版 dsh-home 的非敏感设置并入种子——
// settings.yaml 只含配置（皮肤/主题/权限/模型引用名 apiKeyEnv），无真实凭据
// （凭据在 .credentials.yaml，不打包）。安装版首启播种时 settings 一并拷贝，
// 用户只需重新配 API key，插件配置（皮肤/侧边栏/权限/模型清单）开箱即得。
const DEV_DHOME = join(root, 'dsh-home');
const devSettings = join(DEV_DHOME, 'settings.yaml');
if (existsSync(devSettings)) {
  cpSync(devSettings, join(OUT, 'settings.yaml'));
  console.log('  [补] settings.yaml（插件/UI/模型配置，无凭据）');
} else {
  console.warn('  [注] 开发版 dsh-home/settings.yaml 不存在，种子不带设置');
}
console.log(`种子准备完成 → ${OUT}`);
