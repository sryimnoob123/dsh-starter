// 自测 plugin-global-prompt 的 文件↔settings 双向同步防环逻辑。
// 通过解析 index.js 导出 watchAgentsFile 的等价实现来验证(无法直接 import,因依赖 dsh 环境)。
// 这里用一个 mock scope(精确模拟 dsh-settings 语义: update 异步/稀疏合并/值变才触发 watch)
// 和 mock fs(内存文件系统 + fs.watch 事件派发) 来跑通整条链路。
import { watch } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';

const agentsDir = join(tmpdir(), `ddp-sync-test-${Date.now()}`);
const agentsPath = join(agentsDir, 'AGENTS.md');
await mkdir(agentsDir, { recursive: true });
await writeFile(agentsPath, '', 'utf8');

// ---- mock scope: 模拟 dsh-settings commit 语义 ----
function makeScope(initial) {
  let resolved = { ...initial };
  const watchers = new Set();
  const scope = {
    get: () => resolved,
    watch: (cb) => { watchers.add(cb); return () => watchers.delete(cb); },
    // 稀疏合并 + 值变才触发 watchers(与 dsh-settings commit 的 deepEqualJson 短路一致)
    async update(patch) {
      const next = { ...resolved, ...patch };
      const changed = JSON.stringify(next) !== JSON.stringify(resolved);
      resolved = next;
      if (changed) for (const cb of [...watchers]) await cb(resolved, next);
    },
  };
  return scope;
}

// ---- 与 index.js 相同的 watchAgentsFile 实现(从 index.js 拷贝,注入 mock 依赖) ----
function makeWatchAgentsFile(ctx, agentsPath) {
  return function watchAgentsFile(scope) {
    let timer = null;
    let closed = false;
    let watcher;
    const dispose = () => { closed = true; if (timer) { clearTimeout(timer); timer = null; } if (watcher) watcher.close(); };
    try {
      watcher = watch(dirname(agentsPath), async (_event, filename) => {
        if (closed) return;
        if (filename !== null && basename(String(filename)) !== basename(agentsPath)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          timer = null;
          try {
            const config = scope.get();
            if (config.enabled === false) return;
            const text = await readFile(agentsPath, 'utf8');
            if (text === config.globalPrompt) return;
            await scope.update({ globalPrompt: text });
          } catch (e) { ctx.logger.warn('sync failed: %o', e); }
        }, 150);
      });
      watcher.on('error', (e) => ctx.logger.warn('watch error: %o', e));
    } catch (e) { ctx.logger.warn('cannot watch: %o', e); }
    return dispose;
  };
}

const ctx = { logger: { warn: () => {} } };
const scope = makeScope({ enabled: true, globalPrompt: '' });
// settings→文件 方向(index.js 的 syncAgents + 内容守卫)
const syncAgents = async (config) => {
  const next = config.enabled ? String(config.globalPrompt ?? '') : '';
  try { if (await readFile(agentsPath, 'utf8') === next) return; } catch { /* ENOENT */ }
  const tmp = `${agentsPath}.tmp`; await writeFile(tmp, next, 'utf8'); await rename(tmp, agentsPath);
};
const disposeWatch = makeWatchAgentsFile({ logger: { warn() {} } }, agentsPath)(scope);
scope.watch((next) => syncAgents(next));
await syncAgents(scope.get()); // 启动时落盘

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 场景 1: 外部改文件 → settings 回写(UI 能显示) ----
await writeFile(agentsPath, '外部写入的规则', 'utf8');
await sleep(400);
assert.equal(scope.get().globalPrompt, '外部写入的规则', '场景1: 外部改动应回写 settings');
console.log('场景1 通过: 外部改文件 → settings 回写');

// ---- 场景 2: UI 保存 → 文件同步,且不触发 settings 变化(防环) ----
const before = JSON.stringify(scope.get());
await scope.update({ globalPrompt: 'UI 保存的规则' });
await sleep(50); // 让 syncAgents 写完
assert.equal(await readFile(agentsPath, 'utf8'), 'UI 保存的规则', '场景2a: UI 保存应落盘');
await sleep(250); // 越过防抖窗口: watch 应读到同内容跳过 update
assert.equal(JSON.stringify(scope.get()), JSON.stringify({ ...JSON.parse(before), globalPrompt: 'UI 保存的规则' }), '场景2b: 不应有额外回写');
console.log('场景2 通过: UI 保存落盘且无环');

// ---- 场景 3: enabled=false → 文件清空、外部编辑被忽略 ----
await scope.update({ enabled: false, globalPrompt: '停用前的文本' });
await sleep(50);
assert.equal(await readFile(agentsPath, 'utf8'), '', '场景3a: disabled 时文件应清空');
await writeFile(agentsPath, '停用期的外部编辑', 'utf8');
await sleep(250);
assert.equal(scope.get().globalPrompt, '停用前的文本', '场景3b: disabled 时外部编辑应被忽略');
console.log('场景3 通过: 停用语义正确');

// ---- 场景 4: 事件风暴去抖(连续写只回写一次) ----
await scope.update({ enabled: true, globalPrompt: 'A' });
let updateCount = 0;
const origUpdate = scope.update.bind(scope);
scope.update = async (patch) => { updateCount += 1; return origUpdate(patch); };
for (let i = 0; i < 5; i++) await writeFile(agentsPath, `v${i}`, 'utf8'); // 连续 5 次写
await sleep(400);
assert.ok(updateCount <= 2, `场景4: 去抖应合并多次事件(实际 ${updateCount} 次 update)`);
assert.equal(scope.get().globalPrompt, 'v4', '场景4: 最终取最新内容');
console.log('场景4 通过: 防抖合并');

// ---- 清理 ----
disposeWatch();
await rm(agentsDir, { recursive: true, force: true });
console.log('\n全部 4 场景通过 ✓');
