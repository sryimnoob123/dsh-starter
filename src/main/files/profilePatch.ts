/**
 * profile 层 cordis.patch.yml 的文本操作（[审查 H2] 收敛三处重复）：
 * - 原三处各自手写"按 \n(?=- ) 分块 + 正则提取/插入/删除"：winInspectorPlugin（insert 追加）、
 *   pluginManager（disabled/insert 块读写）、promptSettings（home 根 patch 生成，不同文件不在此）。
 * - 本模块只做纯文本变换（不碰文件系统），幂等；调用方负责读写文件。
 *
 * 块结构约定（DSH loader patch 格式）：
 * - 顶层数组元素以 `- ` 开头；insert 块 = `- insert:` + 缩进子行（含 `- id: X`）；
 * - disabled 条目 = `- id: X` + `  disabled: true`（可带 config/insert 子行）。
 */

/** 按顶层 `- ` 分块（哨兵法保留块间换行——直接 split 会吃掉 `\n` 导致重组后粘连坏 YAML）。 */
function splitBlocks(text: string): string[] {
  return text.replace(/\n(?=- )/g, '\n\u0000').split('\u0000');
}

/** 块内 entry id（`- id: X` 行，顶层或子行皆可）；无则 null。 */
function blockEntryId(block: string): string | null {
  return /^\s*-\s*id:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*$/m.exec(block)?.[1] ?? null;
}

/** 块是否为 insert 块（行首 `- insert:`；注释里的 insert: 字样不算）。 */
function blockHasInsert(block: string): boolean {
  return /^-\s*insert:\s*$/m.test(block);
}

/** 块是否含 `disabled: true` 行。 */
function blockHasDisabled(block: string): boolean {
  return /disabled:\s*true\b/.test(block);
}

/** 该 entry id 是否已有 insert 块。 */
export function hasInsertBlock(text: string, id: string): boolean {
  const idRe = new RegExp(`^\\s*-\\s*id:\\s*['"]?${id}['"]?\\s*$`, 'm');
  return splitBlocks(text).some((b) => blockHasInsert(b) && idRe.test(b));
}
/** 该 entry id 是否已有 disabled:true 条目。 */
export function hasDisabledEntry(text: string, id: string): boolean {
  const idRe = new RegExp(`^\\s*-\\s*id:\\s*['"]?${id}['"]?\\s*$`, 'm');
  return splitBlocks(text).some((b) => blockHasDisabled(b) && idRe.test(b));
}

/**
 * 幂等追加 insert 块（`- insert:` + `- id: X` + `name: <name>`）。
 * - 已存在该 id → 原样返回；
 * - 内容以空数组 [] 结尾（DSH 首次生成的默认态）→ 把 [] 替换成条目；
 * - 其他情况 → 末尾追加一个新条目。
 */
export function addInsertEntry(existing: string, id: string, name: string): string {
  if (hasInsertBlock(existing, id)) return existing;
  const entry = ['- insert:', `    - id: ${id}`, `      name: ${name}`].join('\n');
  const trimmed = existing.trimEnd();
  if (/\[\s*\]\s*$/.test(trimmed)) {
    return `${trimmed.replace(/\[\s*\]\s*$/, '')}${entry}\n`;
  }
  return `${trimmed}\n${entry}\n`;
}

/** 追加 `- id: X\n  disabled: true`（幂等：已有该 id 的 disabled 条目则不变）。 */
export function addDisabledEntry(existing: string, id: string): string {
  if (hasDisabledEntry(existing, id)) return existing;
  const entry = `- id: ${id}\n  disabled: true`;
  const trimmed = existing.trimEnd();
  if (/\[\s*\]\s*$/.test(trimmed)) {
    return `${trimmed.replace(/\[\s*\]\s*$/, '')}${entry}\n`;
  }
  return `${trimmed}\n${entry}\n`;
}

/** 删除该 entry id 的 disabled:true 块；若块内还有 config/insert 则保留块、只去掉 disabled 行。 */
export function removeDisabledEntry(existing: string, id: string): string {
  const kept = splitBlocks(existing)
    .map((block) => {
      if (blockEntryId(block) !== id) return block;
      // 纯 disabled 块（无 config/insert）→ 整块移除；否则仅去掉 disabled 行
      if (!/config:|insert:/.test(block)) return '';
      return block.replace(/^(\s*)disabled:\s*true\s*$/m, '');
    })
    .filter((b) => b.trim() !== '');
  return kept.length > 0 ? kept.join('') : '';
}

/** 从文本中提取该 entry 的 insert 块（含 `- insert:` 开头，原样可追加回）；无则 null。 */
export function extractInsertBlock(text: string, id: string): string | null {
  const idRe = new RegExp(`^\\s*-\\s*id:\\s*['"]?${id}['"]?\\s*$`, 'm');
  for (const block of splitBlocks(text)) {
    if (blockHasInsert(block) && idRe.test(block)) return block.trimEnd();
  }
  return null;
}

/** 从文本中删除该 entry 的 insert 块（移除语义）；同时确保 disabled 条目在（双保险）。 */
export function removeInsertBlock(existing: string, id: string): string {
  const idRe = new RegExp(`^\\s*-\\s*id:\\s*['"]?${id}['"]?\\s*$`, 'm');
  const kept = splitBlocks(existing)
    .filter((block) => !(blockHasInsert(block) && idRe.test(block)))
    .filter((b) => b.trim() !== '');
  const withoutInsert = kept.length > 0 ? kept.join('') : '';
  // 双保险：移除后该 entry 也标 disabled（防止 dsh 从别处加载）
  return addDisabledEntry(withoutInsert, id);
}
