// prepare-archives.mjs — 打包前把 DSH 运行时 + 种子目录各打成单个 tgz（带 .sha256）。
// 目的：NSIS 只解压 2 个大文件而非 43500 个小文件（安装 10 分钟 → 秒级）；
//       首启用系统 tar.exe 流式解压（本机实测 29738 文件 26s，seed 12s）。
// 背景（2026-08-25 设计文档 docs/aegis/work/2026-08-25-tgz-firstrun-design.md）：
//   NSIS 单线程解压 + 每文件落盘扫描是 10 分钟瓶颈；dsh-codex-desktop 生态已验证
//   "目录打成单 tgz 避免安装器解压上万小文件" 路线（V2EX 口碑"丝滑"）。
// 幂等：build/archives/dsh-runtime.tgz 已存在且 sha256 匹配则跳过。
// 附带：改写 .modules.yaml 的 storeDir（当前盘默认），避免首启解压后触发壳的
//   store 漂移检测（VM 实测旧路径 E:\ 新盘 C:\ 会触发，pnpm list 验证改写后仍可用）。
// 2026-08-26 修复：种子 web node_modules 的 @deepseek-ai/dsh-plugin-manager 是私有包
//   （npm 404，prepare-seed.mjs 手动补的），pnpm install 更新插件时会把它清掉 →
//   DSH 启动 cordis.patch.yml 引用找不到 → hot mount failed → 触发 auto-restart。
//   打种子 tgz 前从 vendor/dsh 拷回（幂等：已存在则跳过），根治"更新插件后首启崩"。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build', 'archives');
const tmpDir = join(tmpdir(), 'dsh-archives-prep-' + process.pid);

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** 打包目录内容的 .modules.yaml 保留原 storeDir（不删字段）：
 *  首启 autoFixStoreDrift 会检测到打包机盘符 ≠ 目标机盘符，并把 storeDir 改写为
 *  目标机 pnpm 默认 store（%LOCALAPPDATA%\pnpm\store\v11）——pnpm 依赖 storeDir 存在才能
 *  装插件；删字段会让 pnpm 读成 undefined，插件市场全部报 ERR_PNPM_UNEXPECTED_STORE
 *  （2026-08-26 实测：v410i 全新装插件市场失败，根因即删除 storeDir）。
 *  副本建在 root 内（build/archives/.store-normalize），保证 packTgz 的相对路径一致。
 *  注意：seed 的 node_modules 在 profiles/web/node_modules/，runtime 在 node_modules/，
 *  统一递归遍历 srcDir 下所有 .modules.yaml（node_modules 内也可能有嵌套的）。 */
function normalizeStoreDir(srcDir) {
  const copy = join(outDir, '.store-normalize');
  rmSync(copy, { recursive: true, force: true });
  cpSync(srcDir, copy, { recursive: true, force: true });
  const found = [];
  const walk = (dir, depth) => {
    // 目录自身可能就有 .modules.yaml（如 srcDir 就是 node_modules 本身时）
    const selfYaml = join(dir, '.modules.yaml');
    if (existsSync(selfYaml)) found.push(selfYaml);
    if (depth >= 3) return; // 只查前 3 层（顶层/profiles/web），不深入 node_modules 内部包
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(copy, 0);
  for (const yaml of found) {
    try {
      const raw = JSON.parse(readFileSync(yaml, 'utf8'));
      // 保留 storeDir（autoFix 会改写为目标机默认 store）；删除 virtualStoreDir——
      // 它记录打包机绝对路径（E:\...\.pnpm），首启后 pnpm 校验 node_modules 的 virtual
      // store 与实际不符 → 两个插件市场（dshmarket/webui-market）装插件全崩（2026-08-26
      // 本机实测：storeDir 已改对仍报 "symlinked from the virtual store directory at
      // E:\..."，删 virtualStoreDir 后 pnpm 按安装位置自动生成，插件市场正常）。
      delete raw.virtualStoreDir;
      writeFileSync(yaml, JSON.stringify(raw, null, 2), 'utf8');
      console.log(`prepare-archives: virtualStoreDir removed from ${yaml.slice(copy.length + 1)} (storeDir preserved)`);
    } catch (error) {
      console.error(`prepare-archives: storeDir normalize failed for ${yaml}: ${error.message}`);
    }
  }
  scrubPrivacy(copy);
  return copy;
}

/**
 * 隐私清洗（2026-08-26 发布审查 P0）：tgz 是随安装包分发给所有用户的，禁止带打包机
 * 绝对路径。两个泄漏源：
 *  (a) node_modules/.bin/* cmd-shim 文件顶部的 `# cmd-shim-target=E:/projets/...` 注释行
 *      ——cmd-shim 生成的标记（含打包机路径），运行时用 %~dp0 相对解析、该行无功能，删了安全；
 *  (b) node_modules 各层 .pnpm-workspace-state-v1.json 的 projects 键记录打包机完整绝对路径
 *      ——pnpm 按需重建该文件，直接删。
 * 其余 .modules.yaml 的 storeDir 有意保留（首启 autoFix 改写），不在此清洗。
 */
function scrubPrivacy(srcDir) {
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.bin') {
          for (const f of readdirSync(p)) {
            const fp = join(p, f);
            try {
              const text = readFileSync(fp, 'utf8');
              if (text.includes('cmd-shim-target=')) {
                writeFileSync(fp, text.split('\n').filter((line) => !line.includes('cmd-shim-target=')).join('\n'), 'utf8');
                console.log(`prepare-archives: scrubbed cmd-shim-target in ${fp.slice(srcDir.length + 1)}`);
              }
            } catch { /* 二进制 shim（.exe）跳过 */ }
          }
        } else {
          walk(p);
        }
      } else if (entry.name === '.pnpm-workspace-state-v1.json') {
        rmSync(p, { force: true });
        console.log(`prepare-archives: scrubbed ${p.slice(srcDir.length + 1)} (packager absolute paths)`);
      }
    }
  };
  walk(srcDir);
}

/** 打包目录内容为单个 tgz（tar 用系统 tar.exe，win32 下避免 bash tar 差异）。
 * 注意：bsdtar 在 Windows 上会把 `E:\` 开头的绝对路径误解析为"远程主机:路径"
 * （Cannot connect to E:），必须传相对路径（cwd=root）+ 正斜杠。 */
function packTgz(srcDir, archivePath) {
  rmSync(archivePath, { force: true });
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
  const relSrc = srcDir.slice(root.length + 1).replace(/\\/g, '/');
  const relOut = archivePath.slice(root.length + 1).replace(/\\/g, '/');
  const res = spawnSync(tar, ['-czf', relOut, '-C', relSrc, '.'], {
    stdio: 'inherit',
    cwd: root,
  });
  if (res.status !== 0) {
    console.error(`prepare-archives: tar failed (${tar}): exit ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

/** 瘦身：node-pty 等原生模块 prebuilds 里的非 Windows 平台二进制（darwin/linux）
 * 在 Windows 分发里用不到（~2MB/处，seed + runtime 各 1 处）。保留所有 win32
 * 架构（x64/arm64）——保守策略：只删确定的平台冗余，不碰功能依赖。 */
function trimNonWinPlatforms(srcDir) {
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const p = join(dir, entry.name);
      if (entry.name === 'prebuilds') {
        for (const platform of readdirSync(p, { withFileTypes: true })) {
          if (platform.isDirectory() && !platform.name.startsWith('win32')) {
            rmSync(join(p, platform.name), { recursive: true, force: true });
            console.log(`prepare-archives: trim non-win32 prebuild ${p.slice(root.length + 1)}\\${platform.name}`);
          }
        }
        continue; // 不深入 prebuilds 内部
      }
      walk(p); // 全量递归（含 node_modules 内部），只 stat 目录不做字节 IO
    }
  };
  walk(srcDir);
}

function prepare(relDir, archiveName, storeNormalize) {
  const srcDir = join(root, relDir);
  if (!existsSync(srcDir)) {
    console.log(`prepare-archives: skip ${relDir} (not present)`);
    return;
  }
  const archive = join(outDir, archiveName);
  const sha = archive + '.sha256';
  if (existsSync(archive) && existsSync(sha)) {
    const existing = readFileSync(sha, 'utf8').split(/\s+/)[0];
    if (existing === sha256File(archive)) {
      console.log(`prepare-archives: ${archiveName} up to date, skip`);
      return;
    }
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  let packSrc = storeNormalize ? normalizeStoreDir(srcDir) : srcDir;
  trimNonWinPlatforms(packSrc);
  packTgz(packSrc, archive);
  writeFileSync(sha, sha256File(archive) + '  ' + archiveName + '\n', 'utf8');
  console.log(`prepare-archives: ${archiveName} -> ${(readFileSync(archive).length / 1048576).toFixed(1)} MiB`);
}

/** 确保种子 web node_modules 的 @deepseek-ai/dsh-plugin-manager 存在（私有包，pnpm 会清）。
 *  从 vendor/dsh 拷回（幂等：已存在则跳过）。cordis.patch.yml 引用它，缺失 → DSH 启动崩。 */
function ensureSeedPluginManager() {
  const seedAi = join(root, 'build', 'dsh-home-seed', 'profiles', 'web', 'node_modules', '@deepseek-ai');
  const target = join(seedAi, 'dsh-plugin-manager');
  if (existsSync(target)) return;
  const vendor = join(root, 'vendor', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-plugin-manager');
  if (!existsSync(vendor)) {
    console.error('prepare-archives: vendor 里没有 @deepseek-ai/dsh-plugin-manager——种子无法补全');
    process.exit(1);
  }
  mkdirSync(seedAi, { recursive: true });
  cpSync(vendor, target, { recursive: true });
  console.log('prepare-archives: restored @deepseek-ai/dsh-plugin-manager into seed (pnpm 清掉后补回)');
}

// 种子目录：profiles/web 是播种来源，但 settings.yaml 也要进包（阶段2 补种子用）
ensureSeedPluginManager();
prepare('build/dsh-home-seed', 'dsh-home-seed.tgz', true);
// dsh 运行时：vendor/dsh/node_modules 整体打包（也删 storeDir，避免目标机盘符不同触发漂移）
prepare('vendor/dsh/node_modules', 'dsh-runtime.tgz', true);
rmSync(tmpDir, { recursive: true, force: true });
console.log('prepare-archives: done');
