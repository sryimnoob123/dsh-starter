/**
 * Layer C — 半自动 LLM 观察者（MVP）
 *
 * 纯函数模块：从诊断运行现场信号 → 聚类 → 确定性草稿 →（可选）LLM 富化
 * → 人审补全 → 校验合并进本地覆盖层。安全不变量见 docs/layer-c-observer.md：
 *   1. 封闭探测词表（与引擎同表），LLM 输出永远是数据、永远不能成为代码；
 *   2. 候选默认 severity=warn，不直接制造 error 告警；
 *   3. --observe-apply 只合并校验通过的提案，且只写本地覆盖层，不自动进目录；
 *   4. LLM 未配置/超时/输出非法 → 静默回退确定性草稿，工具不依赖外部服务。
 *
 * 用法（CLI 接线在 dsh-doctor.mjs）：
 *   node dsh-doctor.mjs --observe run.json
 *   node dsh-doctor.mjs --observe run.json --observe-llm "<cmd 读 stdin 写 stdout>"
 *   node dsh-doctor.mjs --observe-apply proposals.json
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, isAbsolute, resolve } from 'node:path';

/** 封闭探测词表：type → 该类型必填参数（与 plugin/dsh-doctor.mjs 引擎原语一致）。 */
export const PROBE_VOCABULARY = {
  'command-exists': ['cmd'],
  'path-exists': ['path'],
  'path-is-dir': ['path'],
  'path-is-file': ['path'],
  'json-valid': ['path'],
  'text-contains': ['path', 'pattern'],
  'text-not-contains': ['path', 'pattern'],
  'file-size-above': ['path', 'min'],
  'glob-count': ['base', 'pattern'],
  'file-writable': ['path'],
};

const SECTIONS = new Set(['env', 'profile', 'session', 'catalog']);
const SEVERITIES = new Set(['error', 'warn']);

/** 症状 → 探测词表提示映射（确定性草稿用；LLM 富化可改，但必须仍在词表内）。 */
const PROBE_HINTS = [
  { re: /json/i, type: 'json-valid', hint: '目标文件 JSON 合法性' },
  { re: /path|which|command|命令|不在|未安装|executable|bin/i, type: 'command-exists', hint: '命令/可执行文件在 PATH' },
  { re: /writ|可写|权限|属主|chown|sudo|readonly|只读/i, type: 'file-writable', hint: '文件可写性' },
  { re: /patch|insert|yaml|yml|cordis/i, type: 'text-contains', hint: '文本模式匹配（patch/配置类）' },
  { re: /port|端口|3080|listen/i, type: 'path-exists', hint: '路径存在性（端口/资源占位）' },
  { re: /glob|文件数|count|recursive|目录/i, type: 'glob-count', hint: '目录递归文件计数' },
];

/** 从任意常见诊断输出形态抽取检查条目：数组 / {checks} / {results}。 */
export function extractChecks(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.checks)) return data.checks; // envelope（v1）与 plain JSON 都用 checks
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

/** 检查条目 → 状态：'pass' | 'fail' | 'warn' | 'unknown'（envelope 用 status，plain 用 ok）。 */
export function checkStatus(c) {
  if (typeof c.status === 'string') return ['pass', 'warn', 'fail'].includes(c.status) ? c.status : 'unknown';
  if (c.ok === false) return 'fail';
  if (c.ok === true) return 'pass';
  return 'unknown';
}

/** 检查条目 → section（envelope 无 section 字段，按 id 前缀推断）。 */
export function checkSection(c) {
  if (typeof c.section === 'string' && SECTIONS.has(c.section)) return c.section;
  const id = String(c.id ?? c.name ?? '');
  if (/^E/i.test(id)) return 'env';
  if (/^P/i.test(id)) return 'profile';
  if (/^S/i.test(id)) return 'session';
  if (/^C/i.test(id)) return 'catalog';
  return 'env';
}

/** detail 归一化：小写、trim、去空白折叠、去尾标点。聚类键的一部分，保证同义症状合簇。 */
export function normalizeDetail(text) {
  return String(text ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.。!！?？;；,，:：]+$/g, '')
    .trim();
}

/**
 * 聚类：按 (section, 归一化 detail) 分簇 fail/warn 信号。
 * 返回 [{ section, signature, count, examples: [原始 detail], statuses: Set }]
 */
export function clusterSignals(data) {
  const clusters = new Map();
  for (const c of extractChecks(data)) {
    const st = checkStatus(c);
    if (st !== 'fail' && st !== 'warn') continue;
    const section = checkSection(c);
    const detail = String(c.detail ?? c.name ?? c.id ?? '');
    const sig = normalizeDetail(detail);
    const key = `${section}|${sig}`;
    if (!clusters.has(key)) {
      clusters.set(key, { section, signature: sig, count: 0, examples: [], statuses: new Set() });
    }
    const cl = clusters.get(key);
    cl.count++;
    cl.statuses.add(st);
    if (cl.examples.length < 3 && !cl.examples.includes(detail)) cl.examples.push(detail);
  }
  return [...clusters.values()].map((c) => ({ ...c, statuses: [...c.statuses] }));
}

/** signature → 短 slug（候选检查 id 用）。 */
export function slugOf(signature, maxWords = 5) {
  const words = signature.split(' ').filter(Boolean).slice(0, maxWords);
  let slug = words.map((w) => w.replace(/[^a-z0-9]+/g, '-')).join('-').replace(/^-+|-+$/g, '');
  if (!slug) slug = 'signal';
  return slug.slice(0, 48);
}

/** 确定性草稿：症状 → 候选检查骨架（探测参数大概率不全，正是留给 LLM/人补全的点）。 */
export function draftProposal(cluster, existingIds = [], seq = 0) {
  const hint = PROBE_HINTS.find((h) => h.re.test(cluster.signature)) ?? { type: 'text-contains', hint: '文本模式匹配' };
  const base = `${cluster.section}-${slugOf(cluster.signature)}`;
  let id = `${base}-probe`;
  let n = 0;
  while (existingIds.includes(id)) id = `${base}-${++n + 1}-probe`; // 去重：追加序号
  const p = {
    id,
    section: cluster.section,
    severity: 'warn', // 安全不变量 2：候选默认 warn
    title: `候选检查（观察者 #${seq + 1}）：${cluster.signature.slice(0, 48)}`,
    discussion: null,
    anchor: { package: null, symbol: null, train: null },
    probe: skeletonProbe(hint.type),
    detailOk: `通过（待补）——${hint.hint}`,
    detailFail: `命中（待补）：${cluster.signature.slice(0, 80)}`,
    fix: '待补：给出可执行修复建议',
    proposedBy: 'observer',
    proposedAt: new Date().toISOString(),
  };
  return p;
}

function skeletonProbe(type) {
  switch (type) {
    case 'command-exists': return { type, cmd: '' };
    case 'path-exists':
    case 'path-is-dir':
    case 'path-is-file':
    case 'json-valid':
    case 'file-writable': return { type, path: '', required: false };
    case 'text-contains':
    case 'text-not-contains': return { type, path: '', pattern: '', flags: '', required: false };
    case 'file-size-above': return { type, path: '', min: 0, required: false };
    case 'glob-count': return { type, base: '', pattern: '', required: false };
    default: return { type };
  }
}

/** 提案校验：词表/必填参数/section/severity/id 唯一性。返回 { ok, errors[] }。 */
export function validateProposal(p, existingIds = []) {
  const errors = [];
  if (!p || typeof p !== 'object') return { ok: false, errors: ['提案不是对象'] };
  if (typeof p.id !== 'string' || !p.id.trim()) errors.push('id 缺失');
  else if (existingIds.includes(p.id)) errors.push(`id 重复: ${p.id}`);
  if (!SECTIONS.has(p.section)) errors.push(`section 非法: ${p.section}`);
  if (!SEVERITIES.has(p.severity)) errors.push(`severity 非法: ${p.severity}`);
  const t = p.probe?.type;
  if (!PROBE_VOCABULARY[t]) errors.push(`probe.type 不在词表: ${t}`);
  else {
    for (const key of PROBE_VOCABULARY[t]) {
      const v = p.probe[key];
      if (v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))) errors.push(`probe.${key} 缺失（${t} 必填）`);
    }
  }
  if (p.probe?.type === 'file-size-above' && typeof p.probe.min !== 'number') errors.push('probe.min 必须为数字');
  return { ok: errors.length === 0, errors };
}

/** LLM prompt：给定现场信号 + 现有目录（id 清单防撞），要求输出词表内 JSON。 */
export function renderLLMPrompt(cluster, draft, existingChecks = []) {
  const vocab = Object.keys(PROBE_VOCABULARY).join(', ');
  return [
    '你是 dsh-doctor 的候选检查起草助手（Layer C 观察者）。只输出一个 JSON 对象，不要任何多余文字。',
    '',
    `现场信号：section=${cluster.section}，命中 ${cluster.count} 次（${cluster.statuses.join('/')}）`,
    `症状详情：${cluster.signature}`,
    `示例：${cluster.examples.map((e) => JSON.stringify(e)).join(' ; ')}`,
    '',
    '输出 JSON 只能含这些键（全部可选，缺省回退草稿）：',
    '  title, severity("error"|"warn"), probe({type 必须∈词表: ' + vocab + ', 及该类型必填参数}),',
    '  detailOk, detailFail, fix, anchor({package,symbol,train} 或 null)',
    '',
    `现有目录检查 id（不得撞名）：${existingChecks.map((c) => c.id).join(', ') || '（空）'}`,
    '',
    `当前草稿（可全改，probe 参数必须填全才能被应用）：${JSON.stringify(draft, null, 2)}`,
    '',
    '只输出 JSON：',
  ].join('\n');
}

/** LLM 回复富化：只采纳词表内字段；任何解析/校验失败 → 回退草稿并附原因。 */
export function enrichDraft(draft, llmReply) {
  if (!llmReply || typeof llmReply !== 'string') return { ...draft, llm: 'ignored: 无回复' };
  let parsed;
  try {
    parsed = JSON.parse(llmReply.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return { ...draft, llm: 'ignored: LLM 输出非 JSON' };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return { ...draft, llm: 'ignored: LLM 输出非对象' };
  const out = { ...draft };
  const reject = (why) => ({ ...draft, llm: `ignored: ${why}` });
  // severity：词表内
  if (parsed.severity !== undefined) {
    if (!SEVERITIES.has(parsed.severity)) return reject(`severity 非法 (${parsed.severity})`);
    out.severity = parsed.severity;
  }
  // probe：type 必须在词表，参数按词表必填收集（缺的保留原草稿值）
  if (parsed.probe !== undefined) {
    if (typeof parsed.probe !== 'object' || !PROBE_VOCABULARY[parsed.probe.type]) return reject(`probe.type 不在词表 (${parsed.probe?.type})`);
    const merged = { ...draft.probe, ...parsed.probe };
    out.probe = merged;
  }
  // 字符串字段
  for (const key of ['title', 'detailOk', 'detailFail', 'fix']) {
    if (typeof parsed[key] === 'string' && parsed[key].trim()) out[key] = parsed[key].trim();
  }
  // anchor：合法对象才采纳
  if (parsed.anchor !== undefined) {
    if (parsed.anchor === null) out.anchor = null;
    else if (typeof parsed.anchor === 'object' && !Array.isArray(parsed.anchor)) {
      out.anchor = { package: parsed.anchor.package ?? null, symbol: parsed.anchor.symbol ?? null, train: parsed.anchor.train ?? null };
    } else return reject('anchor 非法');
  }
  return out;
}

/** 收集现有检查 id（供去重/防撞）。 */
export function existingIdsOf(checks) {
  return (checks ?? []).map((c) => c.id).filter(Boolean);
}

/**
 * 观察入口：input = 诊断运行 JSON 对象 或 {path}（文件或含 JSON 的目录）。
 * llmCmd 未给 → 跳过 LLM 步（确定性草稿 + prompt 照常输出）。
 * 返回 { generatedAt, source, signals, clusters, proposals }。
 */
export async function runObserver({ input, path, existingChecks = [], llmCmd = null } = {}) {
  const data = input ?? loadInput(path);
  const clusters = clusterSignals(data);
  const existing = existingIdsOf(existingChecks);
  const proposals = [];
  for (let i = 0; i < clusters.length; i++) {
    const draft = draftProposal(clusters[i], [...existing, ...proposals.map((p) => p.id)], i);
    let final = draft;
    if (llmCmd) {
      const reply = runLLM(llmCmd, renderLLMPrompt(clusters[i], draft, existingChecks));
      final = enrichDraft(draft, reply);
    } else {
      final = { ...draft, prompt: renderLLMPrompt(clusters[i], draft, existingChecks) };
    }
    proposals.push(final);
  }
  return {
    generatedAt: new Date().toISOString(),
    source: typeof path === 'string' ? path : 'input-object',
    signals: clusters.reduce((n, c) => n + c.count, 0),
    clusters: clusters.map((c) => ({ section: c.section, signature: c.signature, count: c.count, examples: c.examples })),
    proposals,
  };
}

function loadInput(path) {
  const p = resolve(path);
  const st = statSync(p);
  if (st.isDirectory()) {
    const out = [];
    for (const f of readdirSync(p)) {
      if (!f.endsWith('.json')) continue;
      try { out.push(JSON.parse(readFileSync(join(p, f), 'utf8'))); } catch { /* 非法 JSON 跳过 */ }
    }
    return { checks: out.flatMap(extractChecks) };
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

function runLLM(cmd, prompt) {
  try {
    const r = spawnSync(cmd, { input: prompt, encoding: 'utf8', shell: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    if (r.status !== 0) return null;
    return String(r.stdout ?? '').trim() || null;
  } catch {
    return null;
  }
}

/** 校验并合并提案进目录对象（本地覆盖层/人工合并通用）。返回 { catalog, applied, rejected }。 */
export function applyProposals(catalog, proposals) {
  const base = catalog && Array.isArray(catalog.checks) ? catalog : { schemaVersion: 1, checks: [] };
  const existing = existingIdsOf(base.checks);
  const applied = [];
  const rejected = [];
  for (const p of proposals ?? []) {
    const v = validateProposal(p, [...existing, ...applied.map((a) => a.id)]);
    if (!v.ok) { rejected.push({ id: p?.id ?? '<无id>', errors: v.errors }); continue; }
    applied.push(p);
  }
  return { catalog: { ...base, checks: [...base.checks, ...applied] }, applied, rejected };
}

/** 写本地覆盖层文件（--observe-apply 用）。 */
export function writeLocalOverlay(filePath, catalog) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

/** 读本地覆盖层（loadCatalog 合并用）；非法/缺失 → []。 */
export function readLocalOverlay(filePath) {
  try {
    const d = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(d.checks) ? d.checks : [];
  } catch {
    return [];
  }
}

export { isAbsolute };
