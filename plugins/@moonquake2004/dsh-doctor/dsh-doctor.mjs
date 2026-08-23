#!/usr/bin/env node
/**
 * dsh-doctor.mjs — DSH 离线诊断工具（"装前/启动前跑一次，把坑提前填上"）
 *
 * 整合社区讨论中可离线检测的故障类别：
 *   [profile]
 *     P1  bundle 条目无法解析（#917/#1377/#880：remove 残留、静默禁用、启动 fail-fast）
 *     P2  bundle patch 与用户 patch insert 的 id 冲突（#1404：duplicate loader entry id）
 *     P3  用户 patch 的 insert name 从 profile 锚点不可解析（#1197/#880）
 *     P4  file: 依赖指向不存在的目录（#1197：悬空 file: 链接）
 *     P5  profile 顶层 @deepseek-ai/* 与框架重复（#1486：双模块实例 → Symbol 不匹配）
 *     P7  cordis.patch.yml 结构 lint（#1724：~ insert: 是 YAML null → parsePatchList 崩溃 → UI 打不开；tab 缩进/缺冒号同族）
 *     P8  adapter provider 注册冲突（#1904②：两 bundle 抢注同一 provider → boot 时 DUPLICATE_ADAPTER 崩溃）
 *     P9  ctx.settings 未声明 inject: ['settings']（#1904⑤：先于 settings 就绪激活 → namespace not registered）
 *     P10 inject 引用客户端专属服务（#1947：@deepseek-ai/dsh-client-* 服务端永不提供 → Fiber 永久 PENDING → web boot 失败）
 *     P11 已装 bundle 的 main 入口产物缺失（#1965：市场装未构建源码树 → ERR_MODULE_NOT_FOUND → boot 崩）
 *     P13 client 端 provide 服务名抢注核心客户端服务 / 跨 bundle 同名（#2752：浏览器端 service already registered → UI 白屏，服务端日志无感知）
 *     P14 declared bin 可执行性（#1846：打包成功但 bin 缺 shebang/产物 → 直接执行 ENOEXEC；与 P11 互补）
 *     P12 `installed_bundle`（#1719 v1.1 词汇：profile 内 bundle 版本 vs 运行 CLI 版本——web 面板/API 跑的是 profile 里装的 bundle，可与独立 CLI 版本不一致）
 *   [session]
 *     S1  孤儿 tool_call（#1363：assistant tool_calls 无对应 tool 结果 → INVALID_REQUEST）
 *     S2  未闭合 turn（#466/#1265：turn/start 无 turn/end → 会话永久"运行中"）
 *     S6  seq 不连续/空洞/重复（#1333/#1452/#1469：官方 seq==index 校验，chunk 行按 expandRow 展开）
 *     S7  end-seed 后重放已提交尾部（#1497：种子末尾之后出现更低 seq）
 *     S9  zstd 容器结构（#1043：单帧容器 → session.list 整体 500，侧边栏全消失）
 *     S10 sourceEventSeqs 悬空引用（#1469：压缩未重映射溯源 → history unavailable）
 *     S8  未知事件类型且无 ignorable（#1538：插件写的事件 harness 读不了 → 整包拒绝；清单从安装的 dsh-session 解析，内置 0.1.0-rc.6 回退）
 *     S11 全会话扫描（#1550：损坏会话 → 隔离建议；超大会话/工作区估算物化堆 → 冷启动风险警告；估算堆=解码MB×6+事件×200B，阈值默认 1GB，可设 DSH_DOCTOR_HEAP_MB）
 *   [env]
 *     E1  关键命令不在 PATH（#1270：node/pnpm/zstd）
 *     E2  .env 是目录而非文件（#71：failed to load .env: EISDIR）
 *     E3  node 版本 / --expose-internals 可及性（#113/#1313，headless/HMR 场景）
 *     E4  node-pty 原生模块完整性（#1219：pty.node 缺失 → dsh web 启动失败）
 *     E5  存储 JSON 文件合法性（#1357：并发写 workspace.json 乱码 → 工作区列表消失）
 *     E6  锚点元检查（tripwire：S6 的 expandRow seq0+k、S7 的 session/end-seed、S10 的 sourceEventSeqs 是否仍在安装的 dsh-session 中）
 *     E10 3080 Web 端口可用性（#1719：启动 dsh web 前检查；dsh web 自身占用=正常，其他程序占用=FAIL；DSH_DOCTOR_PORT 可覆盖）
 *     （P6 Windows 空格参数 lint，#1420 —— 待实现）
 *
 * 用法：
 *   node dsh-doctor.mjs                # 全部检查
 *   node dsh-doctor.mjs --profile web  # 仅 profile 检查（可多次/逗号分隔）
 *   node dsh-doctor.mjs --session <path>  # 仅会话检查（默认自动找最新会话）
 *   node dsh-doctor.mjs --env          # 仅环境检查
 *   node dsh-doctor.mjs --json         # 输出 JSON
 *   node dsh-doctor.mjs --no-catalog   # 不拉远程检查目录（只用内置副本）
 *
 * 远程检查目录（层 A，v0.2.0）：内置 19 项之外，追加执行仓库 checks.json 里的声明式规则
 * （规则是数据、不是代码；只读探测原语，引擎不执行远程代码）。每次运行尝试拉取
 * raw.githubusercontent（3s 超时）→ 失败回退缓存（TTL 6h）→ 内置副本；新检查最长 6h 自动生效。
 *
 * 退出码：0 = 全部通过；1 = 发现可修复问题（内置 + catalog severity=error）；warn 级失败不改退出码。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { basename, delimiter as PATH_DELIM, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const results = []; // { section, id, ok, detail, fix? }
const jsonOut = process.argv.includes('--json');
const securityOnly = process.argv.includes('--security-only');
const only = process.argv
  .filter((a) => a.startsWith('--profile') || a.startsWith('--session') || a === '--env')
  .map((a) => a.startsWith('--') ? a.slice(2) : a);
const wants = (s) => only.length === 0 || only.includes(s) || only.includes(s.charAt(0).toUpperCase() + s.slice(1));

// S8：官方 KNOWN_SESSION_EVENT_TYPES（0.1.0-rc.6 内置回退；优先从安装的 dsh-session 解析）
const KNOWN_SESSION_EVENT_TYPES_FALLBACK = new Set([
  'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided', 'approval/policy',
  'assistant/chunk', 'assistant/message', 'command/done', 'command/run', 'compaction/end', 'compaction/prune',
  'compaction/start', 'compaction/summary', 'feedback/record', 'goal/change', 'hook/invoked', 'hook/result',
  'llm/retry', 'llm/retry-started', 'permission/preset', 'plan/mode', 'request/context', 'request/header',
  'sandbox/mode', 'schedule/change', 'session/end-seed', 'session/title', 'session/title-llm-request',
  'step/end', 'step/start', 'subagent/descriptor', 'todo/write', 'tool-workflow/agent-end',
  'tool-workflow/agent-start', 'tool-workflow/run-end', 'tool-workflow/run-start', 'tool/call',
  'tool/code-dispatch', 'tool/code-dispatch-start', 'tool/result', 'turn/end', 'turn/start', 'user/message',
  'web/deepseek-search-llm-request'
]);
// 存储行类型与 header，不属于事件门禁
const STORAGE_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks', 'session']);
function knownSessionEventTypes() {
  for (const p of (process.env.PATH || '').split(PATH_DELIM)) {
    if (!p.endsWith('node_modules/.bin') || !existsSync(join(p, 'dsh'))) continue;
    try {
      const src = readFileSync(join(dirname(p), '@deepseek-ai', 'dsh-session', 'lib', 'index.js'), 'utf8');
      const m = /const KNOWN_SESSION_EVENT_TYPES = new Set\(\[(.*?)\]\);/.exec(src);
      if (m) {
        const items = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
        if (items.length) return new Set(items);
      }
    } catch { /* 回退 */ }
    break;
  }
  return KNOWN_SESSION_EVENT_TYPES_FALLBACK;
}
const KNOWN = knownSessionEventTypes();

function report(section, id, ok, detail, fix, src) {
  results.push({ section, id, ok, detail, fix, src: src ?? 'builtin' });
}

/** skip 状态（v1 词汇表 r5：#1719）——"不适用"而非"通过"，必须带 reason（detail）。不计入 pass/fail，不翻退出码。 */
function reportSkip(section, id, detail, src) {
  results.push({ section, id, ok: true, skip: true, detail, src: src ?? 'builtin' });
}

/** 解析 --profile 参数：名字（如 web）→ $DSH_HOME/profiles/<name>；含路径分隔符/~/开头 → 直接当 profile 目录（契约 harness 传绝对路径）。 */
function resolveProfile(name) {
  if (!name) throw new Error('无效 profile 名');
  if (name.includes('/') || name.includes('\\') || name.startsWith('~') || name.startsWith('.')) {
    return name.startsWith('~') ? join(homedir(), name.slice(1)) : name;
  }
  return join(HOME, 'profiles', name);
}

/* ================= env ================= */
/** v1 词汇表 r5（#1719）node 语义：pass = 满足 ^22.19.0 || >=24.0.0（root package.json engines），其余 warn——无民间 fail 阈值。 */
function nodeInSupportedRange(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v));
  if (!m) return false;
  const major = Number(m[1]); const minor = Number(m[2]);
  return (major === 22 && minor >= 19) || major >= 24;
}
function checkEnv() {
  if (!wants('env')) return;
  const find = (cmd) => { for (const w of process.platform === 'win32' ? ['where'] : ['which']) { const r = spawnSync(w, [cmd]); if (r.status === 0) { const p = String(r.stdout).split(/\r?\n/)[0].trim(); if (p) return p; } } return null; };
  for (const cmd of ['node', 'pnpm', 'zstd']) {
    const p = find(cmd);
    report('env', `E1-${cmd}`, !!p, p ? `${cmd}: ${p}` : `${cmd} 不在 PATH（${cmd === 'node' ? '创建会话会失败 #1270' : cmd === 'pnpm' ? 'dsh plugin 不可用（corepack 可恢复：corepack enable pnpm）' : '会话日志解压不可用'}）`, p ? undefined : (cmd === 'pnpm' ? 'corepack enable pnpm 或安装 pnpm 后加入 PATH' : `安装 ${cmd} 或加入 PATH`));
  }
  const envFile = join(HOME, '.env');
  if (existsSync(envFile)) {
    const isDir = lstatSync(envFile).isDirectory();
    report('env', 'E2-env', !isDir, isDir ? `${envFile} 是目录，dsh 启动会报 failed to load .env: EISDIR（#71）` : `${envFile} 正常`, isDir ? '删除或改名该目录' : undefined);
  }
  const nv = spawnSync('node', ['-e', 'console.log(process.version)']);
  if (nv.status === 0) {
    const version = String(nv.stdout).trim();
    const supported = nodeInSupportedRange(version);
    report('env', 'E3-node', supported,
      supported ? `node ${version}（满足 ^22.19.0 || >=24.0.0，root package.json engines）` : `node ${version} 不在支持范围（^22.19.0 || >=24.0.0）——会话日志读取等能力受限`,
      supported ? undefined : '升级 node 到 ^22.19.0 或 >=24.0.0（root package.json engines，见 #2259）');
  }

  // E4：node-pty 原生模块完整性（#1219：pty.node 缺失 → dsh web 启动失败）
  const ptyDirs = [];
  for (const p of (process.env.PATH || '').split(PATH_DELIM)) {
    if (p.endsWith('node_modules/.bin') && existsSync(join(p, 'dsh'))) {
      ptyDirs.push(join(dirname(p), 'node-pty'));
      break;
    }
  }
  const profileNM = join(HOME, 'profiles', 'web', 'node_modules');
  ptyDirs.push(join(profileNM, 'node-pty'));
  const pnpmStore = join(profileNM, '.pnpm');
  if (existsSync(pnpmStore)) {
    for (const d of readdirSync(pnpmStore)) if (d.startsWith('node-pty@')) ptyDirs.push(join(pnpmStore, d, 'node_modules', 'node-pty'));
  }
  const plat = `${process.platform}-${process.arch}`;
  const ptyFound = ptyDirs.filter((d) => existsSync(d));
  let ptyBinary = null;
  for (const d of ptyFound) {
    for (const bin of [join(d, 'prebuilds', plat, 'pty.node'), join(d, 'build', 'Release', 'pty.node')]) {
      if (existsSync(bin) && statSync(bin).size > 0) { ptyBinary = bin; break; }
    }
    if (ptyBinary) break;
  }
  if (ptyFound.length === 0) report('env', 'E4', false, '未找到 node-pty（dsh web 终端依赖它，#1219）', '重新安装 @deepseek-ai/dsh，确保 node-pty 装全');
  else if (ptyBinary) report('env', 'E4', true, `node-pty 原生模块在位（${plat}）`, undefined);
  else report('env', 'E4', false, `node-pty 存在但缺 ${plat} 原生二进制（#1219: dsh web 启动失败）`, '重装 node-pty（npm rebuild node-pty）或从源码构建');

  // E5：存储 JSON 文件合法性（#1357：并发写 workspace.json 乱码 → 工作区列表消失）
  const storages = join(HOME, 'storages');
  const badStorage = [];
  if (existsSync(storages)) {
    for (const f of readdirSync(storages)) {
      if (!f.endsWith('.json')) continue;
      const fp = join(storages, f);
      let buf;
      try { buf = readFileSync(fp); } catch { badStorage.push(`${f}（读取失败）`); continue; }
      let utf8ok = true;
      try { new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { utf8ok = false; }
      let jsonok = false;
      if (utf8ok) { try { JSON.parse(buf.toString('utf8')); jsonok = true; } catch { /* 非法 JSON */ } }
      if (!jsonok) badStorage.push(`${f}（UTF-8:${utf8ok ? 'OK' : 'BAD'}，JSON:${jsonok ? 'OK' : 'BAD'}）`);
    }
  }
  if (badStorage.length) report('env', 'E5', false, `存储文件损坏（#1357 并发写乱码类）: ${badStorage.join(', ')}`, '排查是否有多个 dsh 实例并发写同一 storages；修复或删除损坏文件');
  else report('env', 'E5', true, '存储 JSON 文件均合法', undefined);

  // E6：锚点元检查（tripwire）——我们 S6/S7/S10 依赖的契约是否仍在安装的 dsh-session 里
  // 上游改名/重构会让我们的离线结论静默腐烂（boyin111-1 的 --verify-anchors 同款思路）
  let sessionLib = null;
  for (const p of (process.env.PATH || '').split(PATH_DELIM)) {
    if (p.endsWith('node_modules/.bin') && existsSync(join(p, 'dsh'))) {
      const lib = join(dirname(p), '@deepseek-ai', 'dsh-session', 'lib', 'index.js');
      if (existsSync(lib)) { sessionLib = lib; break; }
    }
  }
  if (!sessionLib) {
    report('env', 'E6', true, '⚠ 未定位到 dsh-session，锚点未校验（回退内置假设：expandRow/end-seed/sourceEventSeqs）', '安装 dsh 后重跑可校验');
  } else {
    const src = readFileSync(sessionLib, 'utf8');
    const anchors = [
      ['expandRow 的 seq0+k 展开（S6 依赖）', /function expandRow[\s\S]*?row\.seq0/, src],
      ['session/end-seed 字面量（S7 依赖）', /"session\/end-seed"/, src],
      ['sourceEventSeqs 字段（S10 依赖）', /sourceEventSeqs/, src],
    ];
    const missing = anchors.filter(([, re]) => !re.test(src));
    if (missing.length) {
      report('env', 'E6', false, `锚点缺失（上游可能改了契约，S6/S7/S10 结论需人工复核）: ${missing.map(([n]) => n).join('; ')}（${sessionLib.slice(-60)}）`, '对照上游变更更新 dsh-doctor 的对应检查');
    } else {
      report('env', 'E6', true, `锚点齐全（${anchors.length}/3: seq0+k / session/end-seed / sourceEventSeqs）`, undefined);
    }
  }
}

/* ================= E10：Web 端口可用性（#1719 提案；启动 dsh web 前检查，避免 address in use） =================
 * 本地 socket bind 探测（离线兼容）：端口空闲 → PASS；被 dsh web 实例占用 → PASS+提示
 * （宿主自身或另一实例，正常）；被其他程序占用 → FAIL。
 * 默认 3080，可用 DSH_DOCTOR_PORT 覆盖（测试/换端口）。
 */
function portOccupierInfo(port) {
  try {
    if (process.platform === 'win32') {
      const r = execFileSync('netstat', ['-ano'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      const m = new RegExp(`TCP\\s+[^\\s]+:${port}\\s+.*?LISTENING\\s+(\\d+)`).exec(r);
      if (!m) return null;
      return { pid: m[1], cmd: '', dsh: false };
    }
    const r = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const lines = r.trim().split('\n').slice(1).filter(Boolean);
    if (!lines.length) return null;
    const parts = lines[0].trim().split(/\s+/);
    const cmd = parts[0] || '';
    const pid = parts[1] || '';
    let dsh = /dsh|deepseek/.test(cmd);
    if (!dsh && pid) {
      try {
        dsh = /dsh web|deepseek-ai|harness/.test(execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }));
      } catch { /* ps 不可用（权限/平台）→ 走 lsof 兜底 */ }
      if (!dsh) {
        try {
          // 兜底：ps 命令串可能不含连续 "dsh web"（npx/pnpm 安装形态），改用 lsof 的 cwd/txt 路径识别 harness 安装。
          // 只认真实安装签名（npx 缓存 / @deepseek-ai 包目录），避免把任意含 "dsh" 路径段的工作目录误判为 dsh。
          const lsofP = execFileSync('lsof', ['-p', pid], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
          dsh = /\.npm\/_npx\/|node_modules\/@deepseek-ai\//.test(lsofP);
        } catch { /* 无法识别则按非 dsh 处理 */ }
      }
    }
    return { pid, cmd, dsh };
  } catch { return null; }
}

function checkPort3080() {
  return new Promise((resolve) => {
    if (!wants('env')) { resolve(); return; }
    const port = Number(process.env.DSH_DOCTOR_PORT || 3080);
    const srv = net.createServer();
    srv.unref();
    let done = false;
    const finish = (fn) => (...args) => { if (done) return; done = true; try { fn(...args); } catch { } resolve(); };
    srv.on('error', finish((e) => {
      if (e.code === 'EADDRINUSE') {
        const info = portOccupierInfo(port);
        if (info && info.dsh) report('env', 'E10-port-3080', true, `端口 ${port} 被 dsh web 实例占用（PID ${info.pid}）——宿主自身或另一实例，正常`, undefined);
        else if (info) report('env', 'E10-port-3080', false, `端口 ${port} 被其他程序占用（PID ${info.pid}: ${info.cmd}），dsh web 启动会 address in use（#1719）`, `关掉占用进程，或让 dsh web 用别的端口`);
        else report('env', 'E10-port-3080', true, `⚠ 端口 ${port} 被占用但无法识别占用者`, undefined);
      } else {
        report('env', 'E10-port-3080', false, `端口 ${port} 探测异常: ${e.message.slice(0, 60)}`, undefined);
      }
    }));
    srv.listen(port, '127.0.0.1', finish(() => { srv.close(); report('env', 'E10-port-3080', true, `端口 ${port} 空闲`, undefined); }));
  });
}

/* ================= profile ================= */
function checkProfile(name) {
  if (!wants('profile')) return;
  let dir;
  try { dir = resolveProfile(name); } catch (e) { report('profile', 'P0', false, e.message); return; }
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) { report('profile', 'P0', false, `profile 不存在: ${dir}`); return; }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bundles = manifest.dsh?.profile?.bundles ?? [];
  const deps = manifest.dependencies ?? {};

  const installAnchor = (() => {
    // 从 PATH 找 dsh 的安装目录（node_modules），用于 bundle 双锚点解析
    for (const p of (process.env.PATH || '').split(PATH_DELIM)) {
      if (p.endsWith('node_modules/.bin') && existsSync(join(p, 'dsh'))) return dirname(p);
    }
    return null;
  })();
  const findPkg = (pkgName) => {
    const cands = [
      installAnchor ? join(installAnchor, pkgName) : null,
      join(dir, 'node_modules', pkgName),
    ].filter(Boolean);
    return cands.find((c) => existsSync(join(c, 'package.json'))) ?? null;
  };
  const readInsertIds = (patchFile) => {
    const ids = new Set();
    if (!existsSync(patchFile)) return ids;
    const lines = readFileSync(patchFile, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)- insert:\s*$/);
      if (!m) continue;
      const base = m[1].length;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '') continue;
        const indent = (l.match(/^\s*/) || [''])[0].length;
        if (indent <= base) break; // insert 块结束
        const im = l.match(/^\s*-\s*id:\s*['"]?([^'"\s]+)/);
        if (im) ids.add(im[1]);
      }
    }
    return ids;
  };
  const patchPath = join(dir, 'cordis.patch.yml');
  const userIds = readInsertIds(patchPath);
  const userNames = (() => {
    const out = new Set();
    if (!existsSync(patchPath)) return out;
    const text = readFileSync(patchPath, 'utf8');
    // 真实格式：`- id:` 下缩进的 `name:` 行（无破折号）——2026-08-15 fixtures 发现旧正则从未匹配
    for (const m of text.matchAll(/^\s*name:\s*['"]?([^'"\s]+)/gm)) out.add(m[1]);
    return out;
  })();

  // P1 bundles 可解析性
  for (const b of bundles) {
    const dir2 = findPkg(b);
    if (!dir2) {
      // installAnchor 为 null（web GUI/无 dsh 锚点）时，宿主侧 bundle 无法验证——
      // 跳过而非误报（#917 core bundles dsh-base/dsh-web-app 由宿主直接提供，
      // 不在 profile node_modules 里，installAnchor 缺失时 findPkg 找不到是正常的）
      if (!installAnchor) continue;
      report('profile', 'P1', false, `bundle 条目 ${b} 无法在安装目录或 profile node_modules 解析（#917/#1377/#880）`, `dsh plugin --profile ${name} add ${b} 或从 dsh.profile.bundles 移除`);
    } else {
      const pkg = JSON.parse(readFileSync(join(dir2, 'package.json'), 'utf8'));
      if (!pkg.dsh?.bundle?.patch) {
        report('profile', 'P1', false, `bundle 条目 ${b} 存在但未声明 dsh.bundle（#1377 静默禁用类）`, '检查该包版本或移除条目');
      }
    }
  }
  // P2 id 冲突（#1404 bundle↔user + #2315 bundle↔bundle）
  const bundleIdSources = new Map(); // id → Set<bundle name>
  for (const b of bundles) {
    const dir2 = findPkg(b);
    if (!dir2) continue;
    const pkg = JSON.parse(readFileSync(join(dir2, 'package.json'), 'utf8'));
    const rel = pkg.dsh?.bundle?.patch;
    if (!rel) continue;
    for (const id of readInsertIds(join(dir2, rel))) {
      if (!bundleIdSources.has(id)) bundleIdSources.set(id, new Set());
      bundleIdSources.get(id).add(b);
    }
  }
  // 跨 bundle 冲突：多个 bundle 注册同一 entry id（#2315 dsh-tui↔dsh-web-app agent-presets）
  const crossBundleDup = [...bundleIdSources].filter(([, s]) => s.size > 1).map(([id, s]) => `${id}（${[...s].join(' + ')}）`);
  // bundle vs 用户 patch 冲突（#1404）
  const userBundleDup = [...bundleIdSources.keys()].filter((id) => userIds.has(id));
  const p2Issues = [];
  if (crossBundleDup.length) p2Issues.push(`多个 bundle 注册相同 entry id（启动必崩 duplicate loader entry id，#2315）: ${crossBundleDup.join('; ')}`);
  if (userBundleDup.length) p2Issues.push(`bundle 与用户 patch 的 id 冲突（启动必崩 duplicate loader entry id，#1404）: ${userBundleDup.join(', ')}`);
  if (p2Issues.length) {
    report('profile', 'P2', false, p2Issues.join(' | '), crossBundleDup.length ? '移除冲突 bundle 中的一个（如不兼容的 TUI/standalone 插件误装入 profile），或让上游协商唯一 entry id' : `备份后从 ${patchPath} 删除这些 insert（或运行 check-dsh-profile.mjs 查看详情）`);
  } else {
    report('profile', 'P2', true, '无 bundle/用户 patch id 冲突', undefined);
  }
  // P3 insert name 可解析性
  const req = (() => { try { return createRequire(join(dir, '_anchor.js')); } catch { return null; } })();
  const bad = [];
  for (const n of userNames) {
    if (n.startsWith('@local/') || n.startsWith('@liustack/')) {
      const fp = deps[n];
      if (fp && fp.startsWith('file:')) {
        const target = join(dir, fp.slice(5));
        if (!existsSync(target)) bad.push(`${n} (file: 目标不存在: ${fp})`);
        continue;
      }
    }
    let ok = false;
    try { if (req) { req.resolve(n); ok = true; } } catch { ok = false; }
    if (!ok) bad.push(n);
  }
  if (bad.length) report('profile', 'P3', false, `用户 patch 中不可解析的 name（#1197/#880）: ${bad.join(', ')}`, `dsh plugin --profile ${name} add <包> 或修复 file: 依赖`);
  else report('profile', 'P3', true, '用户 patch insert 均可解析', undefined);
  // P4 file: 依赖悬空（file: 目标可能是相对（file:./plugins/x）或绝对（file:/abs/path））
  const resolveFileSpec = (spec) => {
    const target = spec.slice(5);
    return /^[/\\]|^[A-Za-z]:/.test(target) ? target : join(dir, target);
  };
  const dangling = Object.entries(deps).filter(([, spec]) => spec.startsWith('file:')).filter(([, spec]) => !existsSync(resolveFileSpec(spec)));
  if (dangling.length) report('profile', 'P4', false, `悬空 file: 依赖（#1197）: ${dangling.map(([n, s]) => `${n} (${s})`).join(', ')}`, '恢复目录或移除依赖');
  else report('profile', 'P4', true, 'file: 依赖完整', undefined);
  // P5 顶层 @deepseek-ai/* 重复（#1486/#1697：hoisted 布局下同版本双实例 → 模块级 Symbol 不匹配）
  // symlink 指向宿主同一份（#1697 的 link: workaround / pnpm file: 正常形态）= 单实例，放行
  const topDup = [];
  const topDir = join(dir, 'node_modules', '@deepseek-ai');
  const hostScope = installAnchor ? join(installAnchor, '@deepseek-ai') : null;
  if (existsSync(topDir)) {
    for (const p of readdirSync(topDir)) {
      const fp = join(topDir, p);
      let st;
      try { st = lstatSync(fp); } catch { continue; }
      if (st.isSymbolicLink()) {
        if (!hostScope) continue; // installAnchor 缺失时无法验证 symlink 指向宿主——跳过（#1697 workaround 已知安全形态）
        try {
          const real = realpathSync(fp);
          const hostPkg = join(hostScope, p);
          if (existsSync(hostPkg) && realpathSync(hostPkg) === real) continue; // 宿主同一份
        } catch { /* 无法解析 → 按独立副本处理 */ }
      }
      if (existsSync(join(fp, 'package.json'))) topDup.push(p);
    }
  }
  if (topDup.length) report('profile', 'P5', false, `profile 顶层存在 @deepseek-ai/* 重复（#1486/#1697 双实例风险，hoisted 布局会让同版本工具包互相遮蔽导致 Symbol 不匹配）: ${topDup.join(', ')}`, '清理 profile 顶层 node_modules/@deepseek-ai 中与宿主同名的独立副本（真实目录）；指向宿主的 link: symlink 是安全的（#1697 workaround）');
  else report('profile', 'P5', true, '无顶层 @deepseek-ai 重复', undefined);

  // P7 patch YAML 结构 lint（#1724：~ insert: / 顶层映射+序列混排 / tab / 缺冒号 → parsePatchList 崩 → UI 打不开）
  // 离线、零依赖的保守检查，覆盖已实测的崩溃机制：
  //   1) ~ / null 等非法 insert 标记（~ 是 YAML null）
  //   2) 顶层映射(key: value)与顶层序列(- xxx)混排 → js-yaml "document separator expected"
  //   3) tab 缩进（YAML 硬错误）；4) insert 缺冒号
  const yamlProblems = [];
  const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  if (patchText) {
    const topLines = patchText.split('\n');
    let hasTopMapping = false, hasTopSeq = false;
    topLines.forEach((line, i) => {
      if (!line.trim() || line.trim().startsWith('#')) return;
      if (line.includes('\t')) yamlProblems.push(`第 ${i + 1} 行含制表符缩进（YAML 禁止 tab）`);
      if (/^\s*(~|null|Null|NULL)\s*insert\s*:/.test(line)) yamlProblems.push(`第 ${i + 1} 行 "${line.trim()}" —— ~ 是 YAML null 字面量，应为 "- insert:"（#1724）`);
      else if (/^\s*-\s*insert(\s|$)/.test(line) && !/^\s*-\s*insert\s*:/.test(line)) yamlProblems.push(`第 ${i + 1} 行 "${line.trim()}" —— "- insert" 缺冒号`);
      // 顶层混排检测：col 0 的映射键 vs col 0 的序列项
      if (!/^\s/.test(line)) {
        if (/^[^\s#-][^:]*:\s/.test(line)) hasTopMapping = true;
        if (/^-\s/.test(line)) hasTopSeq = true;
      }
    });
    if (hasTopMapping && hasTopSeq) yamlProblems.push('顶层同时存在 key: value 映射与 - xxx 序列（js-yaml 报 "stream or a document separator is expected"，#1724 实测）');
  }
  if (yamlProblems.length) report('profile', 'P7', false, `cordis.patch.yml 结构错误（boot 会崩，UI 打不开 #1724）: ${yamlProblems.join('; ')}`, 'patch 必须是顶层纯列表（只有 - insert: / - id: 条目）：删掉顶层 key: value 行；~ 是 YAML null；缩进用空格不用 tab');
  else report('profile', 'P7', true, 'cordis.patch.yml 结构正常（无 tab / 无 ~ insert / 无映射-序列混排）', undefined);

  // P8/P9 需要扫描 bundle 构建产物：收集目录下有限深度的 .js 文件（lib/dist/根 + main 入口，跳过 node_modules）
  const bundleDirs = new Map(); // bundle 名 → 目录（可解析的）
  for (const b of bundles) {
    const d = findPkg(b);
    if (d) bundleDirs.set(b, d);
  }
  const collectJsFiles = (root, maxDepth = 3) => {
    const out = [];
    const walk = (dir, depth) => {
      if (depth > maxDepth) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        // client/web 是浏览器端产物，不在宿主进程运行（避免 ctx.settings 误报）
        if (e.isDirectory() && (e.name === 'client' || e.name === 'web')) continue;
        const fp = join(dir, e.name);
        if (e.isDirectory()) walk(fp, depth + 1);
        else if (e.name.endsWith('.js') && e.name !== 'cordis.patch.yml') out.push(fp);
      }
    };
    walk(root, 0);
    // 主入口（main 指向的 .js）单独兜底
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (typeof pkg.main === 'string' && pkg.main.endsWith('.js')) {
        const mp = join(root, pkg.main);
        if (existsSync(mp) && !out.includes(mp)) out.push(mp);
      }
    } catch { /* 无 manifest */ }
    return out;
  };
  const readJs = (fp) => { try { return readFileSync(fp, 'utf8'); } catch { return ''; } };

  // P8：adapter provider 注册冲突（#1904②：两个 bundle 抢注同一 provider → boot 时 DUPLICATE_ADAPTER 崩溃）
  const providerRegs = new Map(); // provider → Set(bundle)
  for (const [b, d] of bundleDirs) {
    for (const f of collectJsFiles(d)) {
      const src = readJs(f);
      for (const m of src.matchAll(/registerAdapter\s*\(\s*\[([^\]]*)\]/g)) {
        for (const pm of m[1].matchAll(/['"]([^'"]+)['"]/g)) {
          if (!providerRegs.has(pm[1])) providerRegs.set(pm[1], new Set());
          providerRegs.get(pm[1]).add(b);
        }
      }
    }
  }
  const adapterConflicts = [...providerRegs].filter(([, v]) => v.size > 1);
  if (adapterConflicts.length) {
    report('profile', 'P8', false, `adapter provider 注册冲突（#1904②：boot 时 DUPLICATE_ADAPTER 崩溃）: ${adapterConflicts.map(([p, v]) => `${p}（${[...v].join(' ↔ ')}}）`).join('; ')}`, '冲突 provider 只能注册一次：让第三方路由插件用 registerConfigurableProviders 或只注册新路由，移除抢注一方');
  } else {
    report('profile', 'P8', true, '无 adapter provider 注册冲突', undefined);
  }

  // 提取 bundle 构建产物里声明的全部 inject 依赖名（模块 inject + ctx.inject；bundle 可能混入内部模块的 inject）
  const bundleInjectDecls = (all) => {
    const declared = [];
    for (const m of all.matchAll(/inject\s*=\s*\[([^\]]*)\]/gs)) {
      declared.push(...[...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]));
    }
    for (const m of all.matchAll(/ctx\.inject\s*\(\s*\[([^\]]*)\]/g)) {
      declared.push(...[...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]));
    }
    return declared.filter((v, i) => declared.indexOf(v) === i);
  };

  // P9：ctx.settings/ctx.get('settings') 未声明 settings 依赖（#1904⑤：先于 settings 就绪激活 → namespace not registered）
  // 注意边界：sctx.settings 不算（sctx 是别的变量）；ctx.inject(["settings"], cb) 运行时声明算满足
  const injectIssues = [];
  for (const [b, d] of bundleDirs) {
    const files = collectJsFiles(d);
    const all = files.map(readJs).join('\n');
    const usesSettings = /(?<![A-Za-z0-9_$])ctx\.(?:get\(\s*['"]settings['"]\s*\)|settings\b)/.test(all);
    if (!usesSettings) continue;
    const uniq = bundleInjectDecls(all);
    if (!uniq.includes('settings')) {
      injectIssues.push(`${b}（用 ctx.settings 但 settings 依赖未声明${uniq.length ? `，全部 inject: [${uniq.join(', ')}]` : '，未找到任何 inject 声明'}）`);
    }
  }
  if (injectIssues.length) report('profile', 'P9', false, `插件用 ctx.settings 但未声明 settings 依赖（#1904⑤：激活时 settings 可能未就绪 → namespace not registered）: ${injectIssues.join('; ')}`, '在插件代码加 export const inject = ["settings"]（或对可选服务做 undefined 处理）');
  else report('profile', 'P9', true, 'bundle 的 ctx.settings 用法均声明了 settings 依赖（模块 inject 或 ctx.inject）', undefined);

  // P10：inject 引用客户端专属服务（@deepseek-ai/dsh-client-*）→ 服务端永不提供 → Fiber 永久 PENDING → web boot 失败（#1947）
  const clientInjectIssues = [];
  for (const [b, d] of bundleDirs) {
    const all = collectJsFiles(d).map(readJs).join('\n');
    const clientDeps = bundleInjectDecls(all).filter((n) => /^(@deepseek-ai\/)?dsh-client-/.test(n));
    if (clientDeps.length) clientInjectIssues.push(`${b}（inject 引用客户端专属服务: ${clientDeps.join(', ')}）`);
  }
  if (clientInjectIssues.length) report('profile', 'P10', false, `插件 inject 引用客户端专属服务（服务端 cordis 树永不提供 → Fiber 永久 PENDING → web boot 失败，#1947）: ${clientInjectIssues.join('; ')}`, '客户端服务不能作为服务端插件依赖：把相关功能移到插件 client 半（package.json 的 dsh.client.inject），或删除该 inject');
  else report('profile', 'P10', true, '无客户端专属服务注入', undefined);

  // P11：已装 bundle 的 main 入口产物缺失（#1965：市场把未构建源码树当插件装 → ERR_MODULE_NOT_FOUND → boot 崩）
  const entryIssues = [];
  for (const [b, d] of bundleDirs) {
    let main;
    try { main = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).main; } catch { continue; }
    if (typeof main !== 'string' || !main.endsWith('.js')) continue;
    if (!existsSync(join(d, main))) {
      entryIssues.push(`${b}（main=${main} 但产物缺失——未构建的源码树，或装错了仓库根而非 monorepo 子包）`);
    }
  }
  if (entryIssues.length) report('profile', 'P11', false, `已装 bundle 的 main 入口缺失（#1965：市场装源码不跑构建 → ERR_MODULE_NOT_FOUND → dsh web boot 崩溃）: ${entryIssues.join('; ')}`, '在插件目录跑构建（pnpm install && pnpm run build 产出 main 指向的文件），或改用打包好的 npm 包安装；monorepo 插件需装子包（dsh-market #18 同族）');
  else report('profile', 'P11', true, '已装 bundle 的 main 入口产物均在', undefined);

  // P13：client 端服务名抢注核心客户端服务（#2752：ctx.provide("chatFileMentions") 撞核心 dsh-client-ui-deliverables
  // → 浏览器端 service already registered → Web UI 白屏，服务端日志无感知、报错无冲突来源）
  // 与 P8（adapter provider 服务端冲突）互补：P8 跳过 client/web 产物，P13 专门只扫 client 侧——
  //   browser 端 provide 的服务名若与核心客户端服务（@deepseek-ai/dsh-client-*）重名，或两个 bundle 抢注同名，
  //   都会在 client-modules 加载期崩掉整个 UI（fail to load plugins / service has been registered）。
  // 核心名单来源：宿主 dsh 安装目录 + profile node_modules 里的 @deepseek-ai/dsh-client-* 包 client 产物实时收集，
  //   叠加内置种子名单兜底（宿主不可达时仍能查 #2752 的 chatFileMentions 等已知核心服务）。
  const coreClientServices = new Set([
    // 内置种子（核心客户端服务，随 dsh 版本演进，宿主不可达时兜底）
    'chatFileMentions', 'connection', 'sessions', 'workspaces', 'modules', 'locale',
  ]);
  const collectProvideNames = (fp) => {
    let src;
    try { src = readFileSync(fp, 'utf8'); } catch { return []; }
    const out = [];
    for (const m of src.matchAll(/\.provide\(\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
    return out;
  };
  // client 产物位置：dsh.client 入口（package.json 的 dsh.client 指向的文件）+ client/ 目录下 js
  const collectClientJsFiles = (root) => {
    const out = [];
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const entry = pkg.dsh?.client;
      if (typeof entry === 'string' && entry.endsWith('.js')) {
        const ep = join(root, entry);
        if (existsSync(ep)) out.push(ep);
      } else if (entry && typeof entry === 'object' && typeof entry.entry === 'string' && entry.entry.endsWith('.js')) {
        const ep = join(root, entry.entry);
        if (existsSync(ep)) out.push(ep);
      }
    } catch { /* 无 manifest */ }
    const walk = (dir, depth) => {
      if (depth > 3) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const fp = join(dir, e.name);
        if (e.isDirectory()) walk(fp, depth + 1);
        else if (e.name.endsWith('.js')) out.push(fp);
      }
    };
    const cdir = join(root, 'client');
    if (existsSync(cdir)) walk(cdir, 0);
    return [...new Set(out)];
  };
  // 核心客户端服务名单实时收集（宿主 anchor + profile node_modules）
  if (installAnchor) {
    const coreScope = join(installAnchor, '@deepseek-ai');
    if (existsSync(coreScope)) {
      for (const p of readdirSync(coreScope)) {
        if (!/^dsh-client-/.test(p)) continue;
        for (const f of collectClientJsFiles(join(coreScope, p))) {
          for (const n of collectProvideNames(f)) coreClientServices.add(n);
        }
      }
    }
  }
  const clientProvideMap = new Map(); // 服务名 → Set(bundle)
  for (const [b, d] of bundleDirs) {
    for (const f of collectClientJsFiles(d)) {
      for (const n of collectProvideNames(f)) {
        if (!clientProvideMap.has(n)) clientProvideMap.set(n, new Set());
        clientProvideMap.get(n).add(b);
      }
    }
  }
  const coreHits = [...clientProvideMap].filter(([n]) => coreClientServices.has(n));
  const dupHits = [...clientProvideMap].filter(([, v]) => v.size > 1);
  const p13Issues = [];
  for (const [n, bs] of coreHits) {
    p13Issues.push(`服务名 ${n} ∈ 核心客户端服务（${[...bs].join(', ')} 抢注 → 浏览器端 service already registered，UI 白屏 #2752）`);
  }
  for (const [n, bs] of dupHits) {
    if (!coreClientServices.has(n)) p13Issues.push(`服务名 ${n} 被多个插件 client 同时提供（${[...bs].join(', ')} → 同名注册冲突，加载期崩）`);
  }
  if (p13Issues.length) {
    report('profile', 'P13', false, `client 端服务名冲突（#2752：浏览器端 provide 撞核心服务 → UI 白屏且服务端日志无感知）: ${p13Issues.join('; ')}`, '改名自有 client 服务（避开核心 dsh-client-* 已注册名），或让冲突双方协商唯一命名；冲突在应用侧降级为局部警告前仍需避名');
  } else {
    report('profile', 'P13', true, 'client 端 provide 服务名无冲突（未撞核心客户端服务、无跨 bundle 同名抢注）', undefined);
  }

  // P14：declared bin 可执行性（#1846 1052326311 贡献检查点②：dsh-instruction-audit v0.1.0 打包成功但 bin 缺 shebang
  // → 直接执行 ENOEXEC；安装/注册/schema 全过但 pnpm dlx 跑不起来）。与 P11（main 产物缺失）互补：
  // P11 查运行时入口，P14 查 CLI 入口。
  // 判定（2026-08-17 1052326311 实证修正，见 #1846 comment 18056208）：文本 bin 必须带 shebang——
  //   POSIX 上 executable bit 只授予执行权限，不标识文本文件的解释器；仅 exec bit 无 shebang，os.execve
  //   仍返回 ENOEXEC（errno 8）。故"shebang OR exec-bit"会误放行坏包（good/bad fixture 均 100755，只差 shebang）。
  //   离线静态改查"存在 + shebang"两个必要条件（bin 均为 JS 文本，shebang 是解释器声明的唯一可靠来源）。
  const binIssues = [];
  for (const [b, d] of bundleDirs) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')); } catch { continue; }
    const bin = pkg.bin;
    if (!bin) continue;
    const bins = typeof bin === 'string' ? { [b.split('/').pop()]: bin } : bin;
    for (const [binName, rel] of Object.entries(bins)) {
      if (typeof rel !== 'string') continue;
      const fp = join(d, rel);
      if (!existsSync(fp)) {
        binIssues.push(`${b}: bin 声明 ${binName} → ${rel} 但产物缺失（发布后 pnpm dlx/直接执行会失败）`);
        continue;
      }
      let head;
      try { head = readFileSync(fp, 'utf8').slice(0, 2); } catch { head = ''; }
      const shebang = head === '#!';
      // execBit 仅作兜底提示（文本文件解释器识别靠 shebang），不作为通过条件
      if (!shebang) {
        binIssues.push(`${b}: bin ${binName}（${rel}）无 shebang——文本 bin 无解释器声明，直接执行 ENOEXEC（#1846 同型，exec bit 不识别解释器）`);
      }
    }
  }
  if (binIssues.length) {
    report('profile', 'P14', false, `declared bin 不可执行（#1846：安装/注册全过但 bin 跑不起来）: ${binIssues.join('; ')}`, '给 bin 入口补 `#!/usr/bin/env node`（或 chmod +x）；发布前用打包产物实测 `pnpm dlx <pkg>` / 直接执行一次（dsh-testkit 可代为跑真实宿主）');
  } else {
    report('profile', 'P14', true, 'declared bin 均在（存在 + shebang/可执行位）', undefined);
  }

  // P12 `installed_bundle`（#1719 v1.1 词汇条目）：profile 内 bundle 版本 vs 运行 CLI 版本
  // web 设置「诊断」面板与 /dsh-doctor/run API 跑的是 profile 里装的 bundle；独立 CLI（checkout/npx）是另一个副本——
  // Layer-B 自更新只比 npm latest vs 运行模块，profile 内 bundle 落后/超前都不报警（dsh-win32/bundle 同坑，sjh9714 先发现的）。
  // 语义（#1719 合稿，sjh9714 四态分析 + skip 修正）：pass/warn/skip 三态 + detail 注明条件——
  //   manifest 未声明 = skip（无对比对象，pass 会让 CI 误判"已同步"——git_bash 同形）；
  //   manifest 声明但 node_modules 缺失 = warn（manifest 撒谎，运行时从不加载）；
  //   已装且版本一致 = pass；已装但版本分歧 = warn（detail 含 age-gate 提示，升级可能被 pnpm-workspace.yaml 的
  //   minimumReleaseAgeExclude 年龄门暂缓一天，指令不再静默无效——sjh9714 实测）。
  // r6/v1.1 认领后：信封检查名从厂商本地 id `P12-bundle-version` 改为词汇名 `installed_bundle`（#1719 三家对齐，
  // sjh9714 同步改名 `dsh-win32/bundle`→`installed_bundle`，CI 可跨实现断言）。
  try {
    const selfName = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).name ?? '@moonquake2004/dsh-doctor';
    const listed = Object.keys(deps).some((k) => k === selfName || k === 'dsh-doctor');
    // 安装形态两种都找：npm scoped 名（@moonquake2004/dsh-doctor）与 file: 依赖的裸名（dsh-doctor）
    let bundlePkg = null;
    for (const cand of [selfName, 'dsh-doctor']) {
      const p = join(dir, 'node_modules', cand, 'package.json');
      if (existsSync(p)) { bundlePkg = p; break; }
    }
    if (!listed && !bundlePkg) {
      reportSkip('profile', 'installed_bundle', 'profile 未声明也未安装 dsh-doctor bundle——无对比对象（CLI 独立运行），skip 而非 pass（#1719 installed_bundle 合稿，sjh9714：pass 会让 CI 误判"已同步"）');
    } else if (listed && !bundlePkg) {
      report('profile', 'installed_bundle', false, `profile 的 package.json 声明了 ${selfName} 依赖，但 node_modules 里没有对应包（manifest 与运行时不一致，web 面板/API 实际加载不到）`, `dsh plugin --profile ${name} install ${selfName}（或先移除该依赖再重装）`);
    } else {
      const bundleVersion = JSON.parse(readFileSync(bundlePkg, 'utf8')).version;
      const cliVersion = localVersion();
      const same = bundleVersion === cliVersion;
      report('profile', 'installed_bundle', same,
        same ? `profile 内 bundle 版本 ${bundleVersion} 与运行 CLI ${cliVersion} 一致` : `profile 内 bundle 版本 ${bundleVersion} ≠ 运行 CLI ${cliVersion}（web 面板/API 跑的是 bundle，两边行为可能不一致；若刚发布过新版本，升级可能被 pnpm-workspace.yaml 的 minimumReleaseAgeExclude 年龄门暂缓，可次日重试）`,
        same ? undefined : `同步安装版本：dsh plugin --profile ${name} update ${selfName}（或让 CLI 与 bundle 走同一安装方式）`);
    }
  } catch (e) {
    report('profile', 'installed_bundle', false, `bundle 版本对比异常: ${e.message.slice(0, 60)}`, undefined);
  }
}

/* ================= session ================= */
function checkSession(targetPath) {
  if (!wants('session')) return;
  const target = targetPath || (() => {
    let best = null, bestM = -1;
    const root = join(HOME, 'sessions');
    if (!existsSync(root)) return null;
    for (const u of readdirSync(root)) {
      const sd = join(root, u);
      if (!existsSync(sd)) continue;
      for (const s of readdirSync(sd)) {
        const f = existsSync(join(sd, s, 'session.jsonl.zstd')) ? join(sd, s, 'session.jsonl.zstd') : join(sd, s, 'session.jsonl');
        if (!existsSync(f)) continue;
        const m = statSync(f).mtimeMs;
        if (m > bestM) { bestM = m; best = f; }
      }
    }
    return best;
  })();
  if (!target || !existsSync(target)) { report('session', 'S0', true, '无会话日志，跳过单会话检查（可用 --session <path> 指定）', undefined); return; }
  let text;
  try {
    text = target.endsWith('.zstd') ? execFileSync('zstd', ['-dc', target], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8') : readFileSync(target, 'utf8');
  } catch (e) { report('session', 'S0', false, `解压失败: ${e.message.slice(0, 80)}`); return; }

  // S9：zstd 容器结构（#1043：单帧容器会让 session.list 整体 500）
  if (target.endsWith('.zstd')) {
    try {
      const raw = readFileSync(target);
      const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
      let frames = 0;
      for (let i = 0; i <= raw.length - 4; i++) if (raw[i] === magic[0] && raw[i + 1] === magic[1] && raw[i + 2] === magic[2] && raw[i + 3] === magic[3]) frames++;
      if (frames === 0) report('session', 'S9', false, '不是有效的 zstd 容器（无帧 magic）', '该日志无法被 harness 读取');
      else if (frames === 1) report('session', 'S9', false, `单帧 zstd 容器（#1043：session.list 会整体 500，侧边栏全部消失）: ${frames} 帧`, '用多帧容器重写（正常日志每写批一帧），或删除该会话');
      else report('session', 'S9', true, `zstd 多帧容器正常（${frames} 帧）`, undefined);
    } catch (e) { report('session', 'S9', false, `帧扫描失败: ${e.message.slice(0, 60)}`); }
  } else {
    report('session', 'S9', true, '非 zstd 输入，跳过容器检查', undefined);
  }
  const calls = new Map(); const results2 = new Set(); let maxSeq = -1;
  const turnStarts = new Set(); const turnEnds = new Set();
  const positions = []; const endSeedSeqs = [];
  const expanded = []; const sesViolations = []; const s8Violations = []; let evIndex = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const seq = d.seq; if (typeof seq === 'number' && seq > maxSeq) maxSeq = seq;
    // S8：未知事件类型且未标 ignorable（#1538：harness 整包拒绝）
    if (!STORAGE_ROW_TYPES.has(d.type) && !KNOWN.has(d.type) && d.ignorable !== true) {
      s8Violations.push(`"${d.type}"`);
    }
    // S6（官方版）：按 decodeStorageRecord 语义展开 chunk 行，构建 seq==index 事件流
    const t = d.type;
    if (t === 'text-chunks' || t === 'reasoning-chunks' || t === 'tool-call-chunks') {
      const members = (d.data ?? {})[t === 'tool-call-chunks' ? 'args' : 'texts'];
      const base = typeof d.seq0 === 'number' ? d.seq0 : -1;
      for (let k = 0; k < (members?.length ?? 0); k++) {
        const eseq = base + k;
        expanded.push(eseq);
        if (eseq !== evIndex) sesViolations.push(`seq 空洞/重复 @${eseq}（期望 ${evIndex}）`);
        evIndex++;
      }
    } else if (typeof seq === 'number') {
      expanded.push(seq);
      if (seq !== evIndex) sesViolations.push(`seq 空洞/重复 @${seq}（期望 ${evIndex}）`);
      evIndex++;
    }
    // S10：sourceEventSeqs 悬空引用（#1469：必须引用早于自身的事件）
    if (typeof seq === 'number' && Array.isArray(d.sourceEventSeqs)) {
      for (const ref of d.sourceEventSeqs) {
        if (typeof ref === 'number' && ref >= seq) sesViolations.push(`sourceEventSeqs 引用 ${ref} >= 当前 seq ${seq}（${t}）`);
      }
    }
    // S6/S7：收集所有数值位置（seq 或 chunk 的 seq0），按文件序做单调/重复检测
    const pos = typeof seq === 'number' ? seq : (typeof d.seq0 === 'number' ? d.seq0 : null);
    if (pos !== null) positions.push({ pos, type: d.type, seq: seq ?? null });
    if (d.type === 'session/end-seed' && typeof seq === 'number') endSeedSeqs.push(seq);
    if (typeof d.turn === 'number') { if (d.type === 'turn/start') turnStarts.add(d.turn); if (d.type === 'turn/end') turnEnds.add(d.turn); }
    const msg = d.data?.message;
    if (!msg || !Array.isArray(msg.content)) continue;
    for (const blk of msg.content) {
      if (!blk || typeof blk !== 'object') continue;
      if (blk.type === 'tool-call' && typeof blk.id === 'string') calls.set(blk.id, { seq: d.seq, name: blk.name });
      else if (blk.type === 'tool-result' && typeof blk.toolCallId === 'string') results2.add(blk.toolCallId);
    }
  }
  const orphans = [...calls].filter(([id]) => !results2.has(id)).map(([id, v]) => ({ id, ...v }));
  const real = orphans.filter((o) => typeof o.seq === 'number' && o.seq < maxSeq - 1);
  const inflight = orphans.filter((o) => !real.includes(o));
  if (real.length) report('session', 'S1', false, `孤儿 tool_call（#1363，会 INVALID_REQUEST）: ${real.map((o) => o.id).join(', ')}`, '该会话历史不完整，建议新建会话');
  else report('session', 'S1', true, inflight.length ? `无真孤儿（仅尾部 in-flight: ${inflight.length} 个）` : '无孤儿 tool_call', undefined);
  const unclosed = [...turnStarts].filter((t) => !turnEnds.has(t));
  const realUnclosed = unclosed.filter((t) => t < Math.max(...turnStarts));
  const tailUnclosed = unclosed.filter((t) => !realUnclosed.includes(t));
  if (realUnclosed.length) report('session', 'S2', false, `未闭合 turn（#466/#1265，会话可能卡"运行中"）: ${realUnclosed.join(', ')}`, '重启 host 或删除该会话的残留状态');
  else report('session', 'S2', true, tailUnclosed.length ? `无历史未闭合 turn（尾部当前 turn 正常: ${tailUnclosed.join(', ')}）` : '所有 turn 均已闭合', undefined);

  // S6（官方版）：seq == index 连续性（#1333/#1452 重复段 + #1469 seq 空洞），chunk 行按 expandRow 展开
  const s6Violations = sesViolations.filter((v) => !v.startsWith('sourceEventSeqs'));
  if (s6Violations.length) {
    report('session', 'S6', false, `seq 不连续/空洞/重复（#1333/#1452/#1469）: ${s6Violations.slice(0, 5).join('; ')}${s6Violations.length > 5 ? ` 等 ${s6Violations.length} 处` : ''}`, '会话事件序列损坏（可能被强制压缩/并发写坏），建议用端种子恢复或新建会话');
  } else {
    report('session', 'S6', true, `seq==index 连续（展开 ${expanded.length} 个事件，max seq ${maxSeq}）`, undefined);
  }

  // S10：sourceEventSeqs 悬空引用（#1469：压缩未重映射溯源 → 历史永久无法加载）
  const s10 = sesViolations.filter((v) => v.startsWith('sourceEventSeqs'));
  if (s10.length) {
    report('session', 'S10', false, `sourceEventSeqs 悬空引用（#1469，history unavailable）: ${s10.slice(0, 5).join('; ')}${s10.length > 5 ? ` 等 ${s10.length} 处` : ''}`, '压缩写入路径未重映射溯源引用，需修复日志或回滚压缩');
  } else {
    report('session', 'S10', true, 'sourceEventSeqs 均引用早于自身的事件', undefined);
  }

  // S8：未知事件类型（#1538：不在 KNOWN_SESSION_EVENT_TYPES 且无 ignorable → 整包拒绝）
  if (s8Violations.length) {
    const seen = [...new Set(s8Violations)].slice(0, 5).join(', ');
    report('session', 'S8', false, `未知事件类型且无 ignorable 标记（#1538，harness 将整包拒绝）: ${seen}${new Set(s8Violations).size > 5 ? ` 等 ${new Set(s8Violations).size} 种` : ''}`, '该日志由更新版本/外部插件写入，当前 harness 无法读取；升级 harness 或标记 ignorable');
  } else {
    report('session', 'S8', true, `所有事件类型均在 KNOWN_SESSION_EVENT_TYPES 内（${KNOWN.size} 种）`, undefined);
  }

  // S7：end-seed 之后出现低于种子末尾 seq 的事件（#1497：已提交尾部被重放）
  if (endSeedSeqs.length) {
    const lastSeed = endSeedSeqs[endSeedSeqs.length - 1];
    // 只查文件序在最后一个 end-seed 之后的记录
    const lastSeedIdx = positions.map((p) => p.pos).lastIndexOf(lastSeed);
    const after = positions.slice(lastSeedIdx + 1);
    const replayed = after.filter((p) => p.pos < lastSeed);
    if (replayed.length) {
      const sample = replayed.slice(0, 5).map((p) => `${p.type}@${p.pos}`).join(', ');
      report('session', 'S7', false, `end-seed 后重放已提交尾部（#1497）: 种子末尾 seq=${lastSeed}，其后出现 ${replayed.length} 条更低 seq（${sample}...）`, '单进程异常退出重放，需丢弃 end-seed 后的重放段');
    } else {
      report('session', 'S7', true, `end-seed（末次 seq=${lastSeed}）之后无重放（其后 ${after.length} 条记录 seq 均更高）`, undefined);
    }
  } else {
    report('session', 'S7', true, '日志中无 session/end-seed（未做尾部重放检查）', undefined);
  }
}

/* S11：全会话扫描 —— 损坏 → 隔离建议；超大 → 冷打开物化风险（#1550：一个坏/超大会话拖垮整个服务器） */
function scanAllSessions() {
  if (!wants('session')) return;
  const root = join(HOME, 'sessions');
  if (!existsSync(root)) { report('session', 'S11', true, '无会话目录，跳过全会话扫描', undefined); return; }
  const files = [];
  for (const u of readdirSync(root)) {
    const sd = join(root, u);
    if (!existsSync(sd)) continue;
    for (const s of readdirSync(sd)) {
      const f = existsSync(join(sd, s, 'session.jsonl.zstd')) ? join(sd, s, 'session.jsonl.zstd') : join(sd, s, 'session.jsonl');
      if (existsSync(f)) files.push(f);
    }
  }
  if (files.length === 0) { report('session', 'S11', true, '未发现会话日志', undefined); return; }
  const corrupt = []; const oversized = []; const clean = [];
  let totalDS = 0; let totalEvents = 0;
  for (const f of files) {
    const cs = statSync(f).size;
    let raw, frames = 0;
    try {
      raw = readFileSync(f);
      const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
      for (let i = 0; i <= raw.length - 4; i++) if (raw[i] === magic[0] && raw[i + 1] === magic[1] && raw[i + 2] === magic[2] && raw[i + 3] === magic[3]) frames++;
    } catch { corrupt.push({ id: basename(dirname(f)), problems: ['读取失败'] }); continue; }
    let text;
    try { text = f.endsWith('.zstd') ? execFileSync('zstd', ['-dc', f], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8') : readFileSync(f, 'utf8'); }
    catch { corrupt.push({ id: basename(dirname(f)), problems: ['解压/读取失败'] }); continue; }
    const ds = Buffer.byteLength(text, 'utf8');
    totalDS += ds;
    // 轻量损坏扫描：seq==index + end-seed 重放 + 未知类型
    const problems = [];
    let evIndex = 0, lastSeed = -1, seedIdx = -1, posList = [];
    const lines = text.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const ln = lines[li]; if (!ln.trim()) continue;
      let d; try { d = JSON.parse(ln); } catch { problems.push(`行 ${li + 1} 无法解析`); continue; }
      if (!STORAGE_ROW_TYPES.has(d.type) && !KNOWN.has(d.type) && d.ignorable !== true) problems.push(`未知类型 ${d.type}`);
      if (d.type === 'session/end-seed' && typeof d.seq === 'number') { lastSeed = d.seq; seedIdx = posList.length; }
      const t = d.type;
      if (t === 'text-chunks' || t === 'reasoning-chunks' || t === 'tool-call-chunks') {
        const members = (d.data ?? {})[t === 'tool-call-chunks' ? 'args' : 'texts'];
        const base = typeof d.seq0 === 'number' ? d.seq0 : -1;
        for (let k = 0; k < (members?.length ?? 0); k++) {
          const eseq = base + k;
          if (eseq !== evIndex) problems.push(`seq 空洞 @${eseq}(期望 ${evIndex})`);
          posList.push(eseq); evIndex++;
        }
      } else if (typeof d.seq === 'number') {
        if (d.seq !== evIndex) problems.push(`seq 空洞 @${d.seq}(期望 ${evIndex})`);
        posList.push(d.seq); evIndex++;
      }
    }
    if (lastSeed >= 0) {
      const after = posList.slice(seedIdx + 1);
      if (after.some((p) => p < lastSeed)) problems.push('end-seed 后重放已提交尾部');
    }
    const id = basename(dirname(f));
    totalEvents += evIndex;
    const entry = { id, csMB: (cs / 1048576).toFixed(1), dsMB: (ds / 1048576).toFixed(1), frames, events: evIndex, problems };
    if (problems.length) corrupt.push(entry);
    else if (ds > 10 * 1048576 || frames > 10000) oversized.push(entry);
    else clean.push(entry);
  }
  const quars = corrupt.map((c) => `${c.id}（${c.problems.slice(0, 3).join('; ')}）`);
  const totalMB = Math.round(totalDS / 1048576);
  // 校准后的物化风险：估算堆 = 解码字节×6（字节主导放大）+ 事件数×200B（小事件堆成本）
  // 依据：#1550 7889545 场景 300-600MB 解码 → ~3GB 堆（5-10x）；警告线 1GB 提前留余量
  // 校准公式（实测 2026-08-14 本机 41.9 万小事件会话：对象图 259B/事件，×克隆2-3 → ~600B；大事件 5-10x 字节）
  const estHeapMB = Math.round(Math.max(totalEvents * 600, totalDS * 6) / 1048576);
  const heapLimit = Number(process.env.DSH_DOCTOR_HEAP_MB || 1024);
  const totalRisk = estHeapMB > heapLimit;
  if (quars.length) {
    report('session', 'S11', false, `全会话扫描：${corrupt.length} 个损坏会话（#1550：冷打开会拖垮服务器）: ${quars.join(' | ')}`, `隔离：把这些会话目录移出 ${join(HOME, 'sessions')}（如 mv 到备份目录）`);
  } else if (oversized.length || totalRisk) {
    const parts = [];
    if (oversized.length) parts.push(`${oversized.length} 个超大会话: ${oversized.map((o) => `${o.id}(${o.dsMB}MB/${o.events}事件)`).join(' | ')}`);
    if (totalRisk) parts.push(`工作区估算物化堆 ~${estHeapMB}MB（估算= max(${totalEvents}事件×600B, ${totalMB}MB×6)，跨 ${files.length} 会话累积，#1550 场景；阈值 ${heapLimit}MB，可设 DSH_DOCTOR_HEAP_MB）`);
    report('session', 'S11', true, `⚠ 全会话扫描：${parts.join('；')}（未损坏，可接受或归档）`, '冷启动会明显变慢；必要时压缩/归档历史会话');
  } else {
    report('session', 'S11', true, `全会话扫描：${clean.length} 个会话均健康（损坏 0 / 超大 0 / 估算物化堆 ${estHeapMB}MB）`, undefined);
  }
}

/* ================= 远程检查目录（层 A：规则是数据，不是代码） =================
 * 新检查 = 在 checks.json 追加一条 JSON，已装实例在缓存 TTL 内自动生效，无需重装插件。
 * 安全属性：目录内容只能声明"只读探测原语"，引擎不执行远程代码。
 */
const REMOTE_CATALOG_URL = 'https://raw.githubusercontent.com/moonquake2004/dsh-doctor/main/plugin/checks.json';
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6h：新检查最长 6h 内自动生效
const catalogSeverity = new Map(); // catalog 检查 id → severity（'error' | 'warn'）
// v1 词汇表 r5 对齐（#1719）：E1-pnpm 缺失=warn（corepack 可恢复）、E3-node 越界=warn（EBADENGINE 语义）、installed_bundle（P12）分歧=warn（v1.1 词汇条目）、P13 client 服务名冲突=warn（#2752：按帖子建议降级为局部警告而非白屏）、P14 bin 不可执行=warn（#1846：发布卫生问题，不影响已有 boot 但对新用户 pnpm dlx 失败）——均不翻退出码
catalogSeverity.set('E1-pnpm', 'warn');
catalogSeverity.set('E3-node', 'warn');
catalogSeverity.set('installed_bundle', 'warn');
catalogSeverity.set('P13', 'warn');
catalogSeverity.set('P14', 'warn');

function bundledCatalog() {
  const p = new URL('./checks.json', import.meta.url);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { schemaVersion: 1, checks: [] }; }
}

/** 本地覆盖层（层 C 观察者 --observe-apply 写入）：合法则追加，非法/缺失 → []。 */
function localOverlay(path) {
  const p = path ?? fileURLToPath(new URL('./checks.local.json', import.meta.url));
  try { const d = JSON.parse(readFileSync(p, 'utf8')); return validCatalog(d) ? d.checks : []; } catch { return []; }
}

function validCatalog(data) {
  return !!data && data.schemaVersion === 1 && Array.isArray(data.checks);
}

/** 拉取目录：新鲜缓存(≤TTL) → 远程(raw.githubusercontent，3s 超时) → 旧缓存(last-known-good) → 内置副本；末尾合并本地覆盖层。 */
async function loadCatalog({ noRemote = false, fetchImpl, home = HOME, localPath } = {}) {
  const bundled = bundledCatalog();
  let base;
  if (noRemote || typeof fetchImpl !== 'function') {
    base = { checks: bundled.checks, source: 'bundled' };
  } else {
    const cachePath = join(home, '.cache', 'dsh-doctor', 'checks.json');
    const readCache = () => { if (!existsSync(cachePath)) return null; try { const d = JSON.parse(readFileSync(cachePath, 'utf8')); return validCatalog(d) ? d : null; } catch { return null; } };
    try {
      const cached = readCache();
      if (cached && Date.now() - statSync(cachePath).mtimeMs < CATALOG_TTL_MS) base = { checks: cached.checks, source: 'cache' };
    } catch { /* 回退 */ }
    if (!base) {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 3000);
        const res = await fetchImpl(REMOTE_CATALOG_URL, { signal: ac.signal });
        clearTimeout(timer);
        if (res && res.ok) {
          const data = await res.json();
          if (validCatalog(data)) {
            try { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify(data, null, 2)); } catch { /* 缓存写入失败不影响本次运行 */ }
            base = { checks: data.checks, source: 'remote' };
          }
        }
      } catch { /* 离线/超时 → 回退 */ }
    }
    if (!base) {
      const stale = readCache();
      base = stale ? { checks: stale.checks, source: 'cache-stale' } : { checks: bundled.checks, source: 'bundled' };
    }
  }
  const local = localOverlay(localPath);
  if (!local.length) return base;
  return { checks: [...base.checks, ...local], source: base.source === 'bundled' ? 'bundled+local' : `${base.source}+local` };
}

function expandPath(tpl, ctx) {
  return String(tpl)
    .replace(/\{home\}/g, ctx.home)
    .replace(/\{profile\}/g, ctx.profileDir ?? '{profile}')
    .replace(/\{profileName\}/g, ctx.profile);
}

function findCommand(cmd) {
  for (const w of process.platform === 'win32' ? ['where'] : ['which']) {
    const r = spawnSync(w, [cmd]);
    if (r.status === 0) { const p = String(r.stdout).split(/\r?\n/)[0].trim(); if (p) return p; }
  }
  return null;
}

function countRecursive(dir) {
  let n = 0;
  try { for (const e of readdirSync(dir, { withFileTypes: true })) { const fp = join(dir, e.name); if (e.isFile()) n++; else if (e.isDirectory()) n += countRecursive(fp); } } catch { /* 不可读目录跳过 */ }
  return n;
}

/** 极简 glob：`*` 匹配段内任意、`?` 单字符、`**` 递归目录；返回文件匹配数。 */
function globCount(base, pattern) {
  if (!existsSync(base)) return 0;
  const segs = String(pattern).split('/').filter(Boolean);
  if (segs.length === 0) return 0;
  let dirs = [base];
  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const next = [];
    if (seg === '**') {
      if (last) { for (const d of dirs) count += countRecursive(d); return count; }
      // `**` 匹配零层或多层目录：保留当前 dirs（零层）并追加所有递归子目录
      const all = [...dirs];
      const stack = [...dirs];
      while (stack.length) {
        const d = stack.pop();
        if (!existsSync(d)) continue;
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          const fp = join(d, e.name);
          all.push(fp);
          stack.push(fp);
        }
      }
      dirs = all;
      continue;
    }
    const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (!re.test(e.name)) continue;
        const fp = join(d, e.name);
        if (last) { if (e.isFile()) count++; }
        else if (e.isDirectory()) next.push(fp);
      }
    }
    dirs = next;
  }
  return count;
}

/** 执行一条目录检查（只读探测原语）。返回 { ok, detail, skipped? }。 */
export function runCatalogCheck(check, ctx) {
  const probe = check.probe ?? {};
  const p = (tpl) => expandPath(tpl, ctx);
  switch (probe.type) {
    case 'command-exists': {
      const found = findCommand(probe.cmd);
      return found ? { ok: true, detail: check.detailOk ?? `${probe.cmd} 在 PATH: ${found}` }
                   : { ok: false, detail: check.detailFail ?? `${probe.cmd} 不在 PATH` };
    }
    case 'path-exists':
    case 'path-is-dir':
    case 'path-is-file': {
      const fp = p(probe.path);
      let ok = existsSync(fp);
      if (ok && probe.type === 'path-is-dir') ok = lstatSync(fp).isDirectory();
      if (ok && probe.type === 'path-is-file') ok = lstatSync(fp).isFile();
      return ok ? { ok: true, detail: check.detailOk ?? `${fp} 存在` }
                : { ok: false, detail: check.detailFail ?? `${fp} 不存在/类型不符` };
    }
    case 'json-valid': {
      const fp = p(probe.path);
      if (!existsSync(fp)) return probe.required === false
        ? { ok: true, detail: check.detailOk ?? `${fp} 不存在（跳过）` }
        : { ok: false, detail: check.detailFail ?? `${fp} 缺失` };
      let utf8ok = true, jsonok = false;
      try { new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fp)); } catch { utf8ok = false; }
      if (utf8ok) { try { JSON.parse(readFileSync(fp, 'utf8')); jsonok = true; } catch { /* 非法 JSON */ } }
      return jsonok ? { ok: true, detail: check.detailOk ?? `${fp} 为合法 JSON` }
                    : { ok: false, detail: check.detailFail ?? `${fp} 不是合法 JSON（UTF-8:${utf8ok ? 'OK' : 'BAD'}）` };
    }
    case 'text-contains':
    case 'text-not-contains': {
      const fp = p(probe.path);
      if (!existsSync(fp)) return probe.required === false
        ? { ok: true, detail: check.detailOk ?? `${fp} 不存在（跳过）` }
        : { ok: false, detail: check.detailFail ?? `${fp} 缺失` };
      let re;
      try { re = new RegExp(probe.pattern, probe.flags ?? ''); } catch (e) { return { ok: false, detail: `目录规则正则非法: ${e.message.slice(0, 60)}` }; }
      const hit = re.test(readFileSync(fp, 'utf8'));
      const want = probe.type === 'text-contains';
      return hit === want ? { ok: true, detail: check.detailOk ?? `${fp} ${want ? '匹配' : '未匹配'} ${probe.pattern}` }
                          : { ok: false, detail: check.detailFail ?? `${fp} ${want ? '未匹配' : '意外匹配'} ${probe.pattern}` };
    }
    case 'file-size-above': {
      const fp = p(probe.path);
      if (!existsSync(fp)) return probe.required === true
        ? { ok: false, detail: check.detailFail ?? `${fp} 缺失` }
        : { ok: true, detail: check.detailOk ?? `${fp} 不存在（跳过）` };
      const size = statSync(fp).size;
      return size > probe.minBytes
        ? { ok: false, detail: check.detailFail ?? `${fp} 过大: ${size}B > ${probe.minBytes}B` }
        : { ok: true, detail: check.detailOk ?? `${fp} 大小 ${size}B 在限内` };
    }
    case 'glob-count': {
      const base = p(probe.base ?? probe.path);
      const count = globCount(base, probe.pattern);
      const min = probe.min ?? 1;
      const max = probe.max ?? Infinity;
      if (count < min) return { ok: false, detail: check.detailFail ?? `${probe.pattern} 匹配 ${count} 个（< ${min}）` };
      if (count > max) return { ok: false, detail: check.detailFail ?? `${probe.pattern} 匹配 ${count} 个（> ${max}）` };
      return { ok: true, detail: check.detailOk ?? `${probe.pattern} 匹配 ${count} 个（${min}..${max}）` };
    }
    case 'file-writable': {
      const fp = p(probe.path);
      if (!existsSync(fp)) return probe.required === false
        ? { ok: true, detail: check.detailOk ?? `${fp} 不存在（跳过）` }
        : { ok: false, detail: check.detailFail ?? `${fp} 缺失` };
      let writable = false;
      try { const fd = openSync(fp, 'a'); closeSync(fd); writable = true; } catch { /* 只读/属主问题 */ }
      return writable ? { ok: true, detail: check.detailOk ?? `${fp} 可写` }
                      : { ok: false, detail: check.detailFail ?? `${fp} 不可写（sudo 属主或只读权限，#1719）` };
    }
    default:
      return { ok: true, skipped: true, detail: `探测原语 ${probe.type} 本引擎不支持，已跳过（需更新插件）` };
  }
}

/** 逐条执行目录检查，汇入统一 results 管线（src='catalog'）。尊重 --profile/--env/--session 收窄。 */
function checkCatalog(ctx, catalog) {
  const platform = process.platform;
  for (const check of catalog.checks ?? []) {
    if (!wants(check.section)) continue; // 与内置检查一致的 section 收窄
    const when = check.when ?? {};
    if (Array.isArray(when.os) && !when.os.includes(platform)) continue;
    if (check.section === 'profile' && !ctx.profileDir) continue; // profile 无效时跳过 profile 段
    let r;
    try { r = runCatalogCheck(check, ctx); } catch (e) { r = { ok: false, detail: `catalog 检查异常: ${e.message.slice(0, 80)}` }; }
    if (r.skipped) { report(check.section, check.id, true, r.detail, undefined, 'catalog'); continue; }
    const severity = check.severity ?? 'error';
    catalogSeverity.set(check.id, severity);
    report(check.section, check.id, r.ok, r.detail, r.ok ? undefined : check.fix, 'catalog');
  }
}

/* ================= 层 B：版本检查与更新（v0.2.1） =================
 * 检查 npm dist-tags.latest 是否比本地版本新（TTL 6h 缓存 + 离线回退 last-known-good）。
 * 默认只提示；--update 手动执行更新；DSH_DOCTOR_AUTO_UPDATE=1 可用时自动更新。
 * 诚实边界：cordis 启动时加载插件，更新后需重启 dsh web 才生效。
 */
const UPDATE_URL = 'https://registry.npmjs.org/@moonquake2004%2Fdsh-doctor';
const UPDATE_TTL_MS = 6 * 60 * 60 * 1000;

export function localVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch { return '0.0.0'; }
}

/** 返回 { current, latest, available }；latest=null 表示无法确认（离线且无缓存）。 */
export async function checkForUpdate({ noRemote = false, fetchImpl, home = HOME } = {}) {
  const current = localVersion();
  if (noRemote || typeof fetchImpl !== 'function') return { current, latest: null, available: false };
  const cachePath = join(home, '.cache', 'dsh-doctor', 'update.json');
  const readCache = () => { try { const d = JSON.parse(readFileSync(cachePath, 'utf8')); return d && typeof d.latest === 'string' ? d : null; } catch { return null; } };
  try {
    const c = readCache();
    if (c && Date.now() - statSync(cachePath).mtimeMs < UPDATE_TTL_MS) return { current, latest: c.latest, available: c.latest !== current };
  } catch { /* 回退 */ }
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    const res = await fetchImpl(UPDATE_URL, { signal: ac.signal });
    clearTimeout(timer);
    if (res && res.ok) {
      const data = await res.json();
      const latest = data?.['dist-tags']?.latest;
      if (typeof latest === 'string') {
        try { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify({ latest, checkedAt: new Date().toISOString() })); } catch { /* 缓存失败不影响 */ }
        return { current, latest, available: latest !== current };
      }
    }
  } catch { /* 离线/超时 → last-known-good */ }
  const stale = readCache();
  if (stale) return { current, latest: stale.latest, available: stale.latest !== current };
  return { current, latest: null, available: false };
}

/** 判断本模块是否安装在某个 profile 的 node_modules 下；返回 profile 目录或 null。 */
export function profileDirOfModule() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const m = here.match(/(\/\.dsh\/profiles\/[^/]+)\/node_modules\//);
  return m ? m[1] : null;
}

/** 执行更新（profile 内 pnpm install 刷新 file:/npm 依赖；可用 DSH_DOCTOR_UPDATE_CMD 覆盖命令）。 */
export function runUpdate() {
  const override = process.env.DSH_DOCTOR_UPDATE_CMD;
  if (override) {
    const r = spawnSync(override, { shell: true, stdio: 'inherit' });
    return r.status === 0 ? '更新命令执行完成，请重启 dsh web 生效' : `更新命令失败（exit ${r.status ?? r.error?.message}）`;
  }
  const profileDir = profileDirOfModule();
  if (profileDir) {
    const r = spawnSync('pnpm', ['install'], { cwd: profileDir, stdio: 'inherit' });
    return r.status === 0 ? `已更新 ${profileDir}，请重启 dsh web 使新版本生效` : `pnpm install 失败（exit ${r.status ?? r.error?.message}）`;
  }
  return '仓库 checkout 模式：请 git pull 后重新安装插件（file: 依赖指向仓库）';
}

/* ================= main ================= */
const flagValue = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const profileArg = (() => { const i = process.argv.indexOf('--profile'); return i >= 0 ? process.argv[i + 1] : 'web'; })();
const sessionArg = (() => { const i = process.argv.indexOf('--session'); return i >= 0 ? process.argv[i + 1] : undefined; })();

async function run() {
  // 层 C 观察者（--observe / --observe-apply）：独立子命令，跑完即退出，不执行常规检查
  const observeArg = flagValue('--observe');
  const observeApplyArg = flagValue('--observe-apply');
  const llmCmd = process.argv.includes('--observe-llm') ? flagValue('--observe-llm') : process.env.DSH_DOCTOR_LLM_CMD ?? null;
  if (observeArg || observeApplyArg) {
    const { runObserver, applyProposals, writeLocalOverlay, readLocalOverlay } = await import('./observer.mjs');
    try {
      if (observeApplyArg) {
        const raw = JSON.parse(readFileSync(resolve(observeApplyArg), 'utf8'));
        const list = Array.isArray(raw) ? raw : raw.proposals ?? [];
        const overlayPath = join(dirname(fileURLToPath(import.meta.url)), 'checks.local.json');
        // 覆盖层只追加新提案（loadCatalog 会 base + local 合并），且对已存在覆盖层幂等
        const existing = readLocalOverlay(overlayPath);
        const { catalog: merged, applied, rejected } = applyProposals({ schemaVersion: 1, checks: existing }, list);
        if (applied.length) {
          writeLocalOverlay(overlayPath, {
            schemaVersion: 1,
            description: 'Layer C 观察者本地覆盖层——未认证提案，不随包分发；认证通过后请合并进 checks.json 并删除本文件。',
            checks: merged.checks,
          });
        }
        console.log(JSON.stringify({ ok: true, written: applied.length ? overlayPath : null, applied: applied.map((p) => p.id), rejected }, null, 2));
        process.exit(0);
      }
      const res = await runObserver({ path: observeArg, existingChecks: bundledCatalog().checks, llmCmd });
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    } catch (e) {
      console.error(`观察者失败: ${e.message}`);
      process.exit(1);
    }
  }
  // --security-only 跳过非安全检查
  if (!securityOnly) {
    try { checkEnv(); } catch (e) { report('env', 'E0', false, `env 检查异常: ${e.message.slice(0, 80)}`); }
    try { await checkPort3080(); } catch (e) { report('env', 'E10-port-3080', false, `端口检查异常: ${e.message.slice(0, 60)}`); }
    try { checkProfile(profileArg); } catch (e) { report('profile', 'P0', false, `profile 检查异常: ${e.message.slice(0, 100)}`); }
    try { checkSession(sessionArg); } catch (e) { report('session', 'S0', false, `session 检查异常: ${e.message.slice(0, 100)}`); }
    try { scanAllSessions(); } catch (e) { report('session', 'S11', false, `全会话扫描异常: ${e.message.slice(0, 100)}`); }
  }

  // 远程检查目录（层 A）：内置检查之后追加执行；--no-catalog 只走内置副本；--security-only 跳过
  let catalogMeta = { source: 'none', checks: 0 };
  if (!securityOnly) {
    try {
      const catalog = await loadCatalog({ noRemote: process.argv.includes('--no-catalog'), fetchImpl: typeof fetch === 'function' ? fetch : undefined });
      catalogMeta = { source: catalog.source, checks: catalog.checks.length };
      const profileDir = (() => { try { return resolveProfile(profileArg); } catch { return null; } })();
      if (catalog.checks.length && profileDir) checkCatalog({ home: HOME, profile: profileArg, profileDir }, catalog);
      else if (catalog.checks.length) report('catalog', 'C0', true, `profile 无效（${profileArg}），目录检查跳过（${catalog.source}）`, undefined, 'catalog');
    } catch (e) {
      catalogMeta = { source: 'error', checks: 0, error: e.message.slice(0, 80) };
    }
  }

  // 层 B：版本检查与更新（--no-catalog 同时禁用网络检查；--update 手动更新；DSH_DOCTOR_AUTO_UPDATE=1 自动；--security-only 跳过）
  const noRemote = process.argv.includes('--no-catalog');
  let updateInfo = { current: localVersion(), latest: null, available: false };
  if (!securityOnly) {
    try {
      updateInfo = await checkForUpdate({ noRemote, fetchImpl: typeof fetch === 'function' ? fetch : undefined });
    } catch (e) {
      updateInfo = { current: localVersion(), latest: null, available: false, error: e.message.slice(0, 60) };
    }
    if (process.argv.includes('--update') || (process.env.DSH_DOCTOR_AUTO_UPDATE === '1' && updateInfo.available)) {
      updateInfo.applied = runUpdate();
    }
  }

  // 安全检查（--security）：导入 dsh-security 运行安全检查，合并到 results
  // --security-only 隐含启用安全检查（复审修复：此前单独使用 = 静默空跑）
  const securityEnabled = process.argv.includes('--security') || securityOnly;
  let securityMeta = { enabled: false, summary: {} };
  if (securityEnabled) {
    try {
      // 尝试从 profile node_modules 或全局安装导入 dsh-security；
      // 开发调试可用 DSH_SECURITY_SRC 指向工作区源码（复审修复：移除硬编码个人路径）
      let secMod;
      const profileDir = (() => { try { return resolveProfile(profileArg); } catch { return null; } })();
      const secCandidates = [
        process.env.DSH_SECURITY_SRC,
        profileDir ? join(profileDir, 'node_modules', '@moonquake2004', 'dsh-security', 'src', 'index.mjs') : null,
        join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', '@moonquake2004', 'dsh-security', 'src', 'index.mjs'),
      ].filter(Boolean);
      for (const candidate of secCandidates) {
        if (existsSync(candidate)) { secMod = await import(candidate); break; }
      }
      if (secMod) {
        const registry = await secMod.createDefaultRegistry();
        // 注入 ~/.dsh/security.json 配置（旧版 dsh-security 无此能力时静默跳过）
        try {
          if (secMod.loadConfig && typeof registry.setConfig === 'function') {
            registry.setConfig(secMod.loadConfig(HOME));
          }
        } catch { /* 配置损坏不影响检查 */ }
        // 获取最新会话文件（供 SR*/SS* 检查使用）
        // 复审修复：对齐 S11 的两层布局 sessions/<user>/<session>/session.jsonl[.zstd]，
        // 按 mtime 取最新；旧实现只扫顶层 *.jsonl，真实部署下永远返回 null → 运行时层全跳过
        const findLatestSession = () => {
          if (sessionArg) return sessionArg;
          try {
            const root = join(HOME, 'sessions');
            const candidates = [];
            for (const u of readdirSync(root)) {
              const sd = join(root, u);
              let subs = [];
              try { subs = readdirSync(sd); } catch { continue; }
              for (const s of subs) {
                const zstdPath = join(sd, s, 'session.jsonl.zstd');
                const plainPath = join(sd, s, 'session.jsonl');
                const f = existsSync(zstdPath) ? zstdPath : (existsSync(plainPath) ? plainPath : null);
                if (!f) continue;
                try { candidates.push({ f, m: statSync(f).mtimeMs }); } catch { /* race */ }
              }
              // 兼容直接放在用户目录下的散文件
              const loose = join(sd, 'session.jsonl');
              if (existsSync(loose)) { try { candidates.push({ f: loose, m: statSync(loose).mtimeMs }); } catch { /* race */ } }
            }
            candidates.sort((a, b) => b.m - a.m);
            return candidates.length ? candidates[0].f : null;
          } catch { return null; }
        };

        const { results: secResults, exitCode: secExit, summary: secSummary } = await registry.runAll(
          (check) => {
            // SR*/SS* 运行时会话检查用会话文件
            if (check.id && (check.id.startsWith('SR') || check.id.startsWith('SS'))) {
              return findLatestSession();
            }
            // 其余（SP*/SL*/EXT-*）用 profile 目录
            return profileDir || profileArg;
          }
        );
        for (const r of secResults) {
          results.push({ section: 'security', id: r.id, ok: r.ok, detail: r.detail, fix: r.fix, severity: r.severity, skip: !!r.skipped });
        }
        securityMeta = { enabled: true, summary: secSummary, exitCode: secExit };
      } else {
        securityMeta = { enabled: true, error: 'dsh-security not found', summary: {} };
      }
    } catch (e) {
      securityMeta = { enabled: true, error: e.message.slice(0, 80), summary: {} };
    }
  }

  // 退出码只计内置失败 + catalog 中 severity=error 的失败；warn 失败提示但不改退出码
  // 安全检查走独立通道：secExit 由 dsh-security 按 severity 计算（CRITICAL→2, HIGH→1, 其余 0），
  // 不参与 bad[] 与信封 baseExit——复审修复：此前任何安全失败（哪怕 LOW 级关注点）都会把退出码抬到 1/2，
  // 违反 dsh-security 契约「MEDIUM 及以下不影响退出码」与本函数上方注释的声明。
  const bad = results.filter((r) => r.section !== 'security' && !r.ok && catalogSeverity.get(r.id) !== 'warn');
  const secExit = securityMeta.exitCode ?? 0;
  if (jsonOut && process.argv.includes('--envelope')) {
    // v1 契约信封（dsh doctor 规格，zoahdev/doctor 对齐）：status 小写 + 退出码 0/1/2
    const st = (r) => (r.skip ? 'skip' : (!r.ok ? (((r.section === 'security') ? r.severity !== 'critical' : catalogSeverity.get(r.id) === 'warn') ? 'warn' : 'fail') : 'pass'));
    const summary = { pass: 0, warn: 0, fail: 0, skip: 0 }; // skip 常驻（v1 词汇表 r5：#1719），r5 后 P12 会在未装 bundle 时实际触发
    const checks = results.map((r) => { summary[st(r)]++; return { name: r.id, status: st(r), detail: r.detail, ...(r.severity ? { severity: r.severity } : {}), ...(r.section === 'security' ? { section: 'security' } : {}) }; });
    // baseExit 只统计非安全项；安全项对退出码的贡献由 secExit 独立承载
    let baseFail = 0; let baseWarn = 0;
    for (const r of results) {
      if (r.section === 'security') continue;
      const s = st(r);
      if (s === 'fail') baseFail++;
      else if (s === 'warn') baseWarn++;
    }
    const baseExit = baseFail > 0 ? 2 : baseWarn > 0 ? 1 : 0;
    const exitCode = Math.max(baseExit, secExit);
    const out = {
      schema: 'dsh-doctor/v1',
      tool: 'dsh-doctor',
      generatedAt: new Date().toISOString(),
      profile: profileArg,
      exitCode,
      summary,
      ok: exitCode === 0,
      checks,
    };
    if (securityMeta.enabled) {
      out.security = { enabled: true, summary: securityMeta.summary, ...(securityMeta.error ? { error: securityMeta.error } : {}) };
    }
    console.log(JSON.stringify(out, null, 2));
    process.exit(exitCode);
  } else if (jsonOut) {
    console.log(JSON.stringify({ ok: bad.length === 0 && secExit === 0, checks: results, catalog: catalogMeta, update: updateInfo, ...(securityMeta.enabled ? { security: securityMeta } : {}) }, null, 2));
  } else {
    const sectionOrder = { env: 0, profile: 1, session: 2, catalog: 3 };
    const ordered = [...results].sort((a, b) => (sectionOrder[a.section] ?? 9) - (sectionOrder[b.section] ?? 9));
    let lastSection = '';
    for (const r of ordered) {
      if (r.section !== lastSection) { console.log(`\n== ${r.section === 'security' ? '🔒 安全' : r.section.toUpperCase()} ==`); lastSection = r.section; }
      const sev = catalogSeverity.get(r.id);
      // 安全检查：skip 显示 ⊖；critical/high 失败 ✗；medium 及以下失败 ⚠（不影响退出码）
      const mark = r.skip ? '⊖'
        : (!r.ok ? (((r.section === 'security' && r.severity !== 'critical' && r.severity !== 'high') || sev === 'warn') ? '⚠' : '✗')
        : '✓');
      console.log(` ${mark} [${r.id}]${r.severity ? `（${r.severity}${r.skip ? '/skip' : ''}）` : ''} ${r.detail}${r.src === 'catalog' ? '  [目录]' : ''}`);
      if (!r.ok && r.fix) console.log(`     ↳ 修复: ${r.fix}`);
    }
    if (updateInfo.available && !updateInfo.applied) {
      console.log(`\n⚠ 新版本 ${updateInfo.latest} 可用（当前 ${updateInfo.current}）→ 运行 \`dsh-doctor --update\` 或 \`dsh plugin update\``);
    } else if (updateInfo.applied) {
      console.log(`\n✓ ${updateInfo.applied}`);
    }
    console.log(`\n${(bad.length === 0 && secExit === 0) ? '✓ 全部通过' : `✗ ${bad.length} 个内置问题${secExit > 0 ? ` + 安全 ${secExit === 2 ? 'CRITICAL' : 'HIGH'} 级失败` : ''}`}（profile=${profileArg}，目录=${catalogMeta.source}，${catalogMeta.checks} 条）`);
  }
  // 最终退出码：内置失败 → 1；安全 HIGH → 1、CRITICAL → 2（取 max）
  process.exit(Math.max(bad.length > 0 ? 1 : 0, secExit));
}

// 直接执行（CLI：根目录薄封装、plugin 本体、npm bin 均可）；被 import（测试/宿主）时不自动运行
if (process.argv[1] && /^dsh-doctor(\.mjs)?$/.test(basename(process.argv[1]))) run();

export { loadCatalog, bundledCatalog, validCatalog, expandPath, globCount, checkCatalog, nodeInSupportedRange };
