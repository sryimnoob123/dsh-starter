// dsh-boot-guard — host side.
// Owns the rescue HTTP API and injects a loader-independent rescue script
// into index.html. Configuration mutations are validated, serialized and
// committed with a same-directory atomic rename.

import { readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RESCUE_MARKER = "dsh-boot-guard-rescue";
const GUARD_PREFIX = "# [dsh-boot-guard] skip-marker ";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_SKIP_IDS = 64;
const MAX_MUTATION_ATTEMPTS = 4;
const VERSION = "1.1.2";
const fileMutationQueues = new Map();

function parseRows(text) {
  const lines = text.split("\n");
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    const match = /^(\s*)-\s+(.*)$/.exec(lines[i]);
    if (match && match[1] === "") {
      let j = i + 1;
      while (j < lines.length && (lines[j].startsWith("  ") || lines[j].trim() === "")) {
        if (lines[j].trim() === "" && !(lines[j + 1] || "").startsWith("  ")) break;
        j++;
      }
      rows.push({ start: i, end: j, text: lines.slice(i, j).join("\n") });
      i = j;
    } else {
      i++;
    }
  }
  return rows;
}

function parseYamlScalar(source) {
  const raw = String(source || "").trim();
  const commentOffset = raw.search(/\s+#/);
  const value = (commentOffset === -1 ? raw : raw.slice(0, commentOffset)).trim();
  if (!value) return null;
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch (_) { return null; }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function normalizeLocale(value) {
  const primary = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  return primary === "en" || primary === "zh" ? primary : "";
}

export function parseLocalePreference(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  if (!source.trim()) return "";

  if (source.trimStart().startsWith("{")) {
    try {
      const document = JSON.parse(source);
      return normalizeLocale(document && document.locale && document.locale.preference);
    } catch (_) {
      return "";
    }
  }

  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let inLocale = false;
  for (const line of lines) {
    if (!/^\s/.test(line)) {
      inLocale = /^locale\s*:\s*(?:#.*)?$/.test(line);
      continue;
    }
    if (!inLocale) continue;
    const match = /^\s+preference\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    return normalizeLocale(parseYamlScalar(match[1]));
  }
  return "";
}

export function localeFromAcceptLanguage(value) {
  const tags = String(value || "").split(",").map(function (part) {
    return part.trim().split(";")[0];
  });
  for (const tag of tags) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return "zh";
}

function extractRowId(rowText) {
  for (const line of rowText.split("\n")) {
    const match = /^\s*-\s*id:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const id = parseYamlScalar(match[1]);
    if (id !== null) return id;
  }
  return null;
}

function buildDisableRow(entryId) {
  return GUARD_PREFIX + entryId + "\n- id: " + JSON.stringify(entryId) + "\n  disabled: true";
}

function errorWithStatus(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function json(res, statusCode, value) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(value));
}

function methodAllowed(req, res, expected) {
  if (req.method === expected) return true;
  res.writeHead(405, { allow: expected, "cache-control": "no-store" });
  res.end();
  return false;
}

export function assertMutationRequest(req, allowRemote = false) {
  const remoteAddress = req.socket && req.socket.remoteAddress;
  // DSH may listen on a LAN address without authentication. Keep configuration
  // writes local unless the operator explicitly opts into remote mutation.
  if (!allowRemote && !isLoopbackAddress(remoteAddress)) {
    throw errorWithStatus(403, "remote mutation is disabled; use the DSH Web UI on this machine");
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw errorWithStatus(415, "content-type must be application/json");
  }

  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw errorWithStatus(403, "cross-origin mutation denied");
  }

  const origin = req.headers.origin;
  if (origin) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch (_) {
      throw errorWithStatus(403, "invalid origin");
    }
    if (!req.headers.host || parsed.host !== req.headers.host) {
      throw errorWithStatus(403, "origin does not match host");
    }
  }
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw errorWithStatus(413, "request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw errorWithStatus(400, "invalid JSON body");
  }
}

function statSignature(value) {
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":");
}

async function captureFileSnapshot(filename) {
  for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt++) {
    const before = await stat(filename, { bigint: true });
    const text = await readFile(filename, "utf8");
    const after = await stat(filename, { bigint: true });
    if (statSignature(before) === statSignature(after)) {
      return {
        text,
        stat: statSignature(after),
        hash: createHash("sha256").update(text, "utf8").digest("hex")
      };
    }
  }
  throw errorWithStatus(409, "cordis.patch.yml changed while it was being read; retry the operation");
}

function sameSnapshot(left, right) {
  return left.stat === right.stat && left.hash === right.hash;
}

async function writeFileAtomicIfCurrent(filename, content, expected) {
  const temporary = filename + ".boot-guard-" + process.pid + "-" + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    // Re-read immediately before replacement so an editor or plugin manager
    // cannot be silently overwritten by a result derived from stale content.
    const current = await captureFileSnapshot(filename);
    if (!sameSnapshot(current, expected)) {
      await unlink(temporary);
      return false;
    }
    await rename(temporary, filename);
    return true;
  } catch (error) {
    try { await unlink(temporary); } catch (_) {}
    throw error;
  }
}

async function mutatePatchFileUnlocked(filename, render) {
  for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt++) {
    const snapshot = await captureFileSnapshot(filename);
    const rendered = await render(snapshot.text);
    if (rendered.text === snapshot.text) return rendered.result;
    if (await writeFileAtomicIfCurrent(filename, rendered.text, snapshot)) return rendered.result;
  }
  throw errorWithStatus(409, "cordis.patch.yml kept changing; no changes were written");
}

export function mutatePatchFile(filename, render) {
  const previous = fileMutationQueues.get(filename) || Promise.resolve();
  const run = previous.then(
    function () { return mutatePatchFileUnlocked(filename, render); },
    function () { return mutatePatchFileUnlocked(filename, render); }
  );
  const tail = run.then(function () {}, function () {});
  fileMutationQueues.set(filename, tail);
  tail.then(function () {
    if (fileMutationQueues.get(filename) === tail) fileMutationQueues.delete(filename);
  });
  return run;
}

function patchTextFormat(text) {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = bom ? text.slice(1) : text;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  return {
    bom,
    newline,
    body: source.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  };
}

function encodePatchText(body, format) {
  return format.bom + body.replace(/\n/g, format.newline);
}

function isCommentOrBlank(line) {
  const trimmed = line.trim();
  return !trimmed || trimmed.startsWith("#");
}

function significantLineIndexes(lines) {
  const indexes = [];
  for (let index = 0; index < lines.length; index++) {
    if (!isCommentOrBlank(lines[index]) && lines[index].trim() !== "---") indexes.push(index);
  }
  return indexes;
}

function prepareTopLevelArray(body) {
  const lines = body.split("\n");
  const documentStarts = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() === "---") documentStarts.push(index);
  }
  const markerAfterContent = documentStarts.length && lines.slice(0, documentStarts[0]).some(function (line) {
    return !isCommentOrBlank(line);
  });
  if (documentStarts.length > 1 || markerAfterContent) {
    throw errorWithStatus(422, "cordis.patch.yml must contain one top-level YAML document");
  }
  let significant = significantLineIndexes(lines);
  if (significant.length && /^\[\]\s*(?:#.*)?$/.test(lines[significant[0]])) {
    lines.splice(significant[0], 1);
    significant = significantLineIndexes(lines);
  }

  if (significant.length && !/^-($|\s)/.test(lines[significant[0]])) {
    throw errorWithStatus(422, "cordis.patch.yml must contain a top-level YAML array");
  }
  for (const index of significant) {
    const line = lines[index];
    if (!/^\s/.test(line) && !/^-($|\s)/.test(line)) {
      throw errorWithStatus(422, "cordis.patch.yml contains unsupported top-level YAML content");
    }
  }
  return lines.join("\n");
}

function appendPatchRow(body, row) {
  const trimmed = body.replace(/[ \t\n]+$/g, "");
  return (trimmed ? trimmed + "\n" : "") + row + "\n";
}

function ensureEmptyTopLevelArray(body) {
  const lines = body.split("\n");
  if (significantLineIndexes(lines).length) return body;
  const trimmed = body.replace(/[ \t\n]+$/g, "");
  return (trimmed ? trimmed + "\n" : "") + "[]\n";
}

export function normalizeIds(body) {
  let values;
  if (Array.isArray(body.ids)) values = body.ids;
  else if (body.id !== undefined && body.id !== null && body.id !== "") values = [body.id];
  else values = [];

  if (values.length > MAX_SKIP_IDS) throw errorWithStatus(400, "too many ids");
  const ids = [];
  for (const value of values) {
    const id = String(value).trim();
    if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) {
      throw errorWithStatus(400, "invalid id");
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function removeGuardRows(text, requestedIds) {
  const lines = text.split("\n");
  const out = [];
  const restored = [];
  let i = 0;

  while (i < lines.length) {
    const markerMatch = /^# \[dsh-boot-guard\] skip-marker ([^\r\n]+)$/.exec(lines[i]);
    if (!markerMatch) {
      out.push(lines[i]);
      i++;
      continue;
    }

    const markerId = markerMatch[1];
    const selected = requestedIds === null || requestedIds.has(markerId);
    const idLine = lines[i + 1] || "";
    let nextContent = i + 3;
    while (nextContent < lines.length && lines[nextContent].trim() === "") nextContent++;
    const hasIndentedContinuation = /^\s+\S/.test(lines[nextContent] || "");
    const exactBlock = /^-\s+id:\s*.+$/.test(idLine) &&
      extractRowId(idLine) === markerId &&
      /^\s{2}disabled:\s*true\s*$/.test(lines[i + 2] || "") &&
      !hasIndentedContinuation;
    if (selected && exactBlock) {
      restored.push(markerId);
      i += 3;
      continue;
    }

    out.push(lines[i]);
    i++;
  }

  return { text: out.join("\n"), restored };
}

export function addGuardRows(text, ids) {
  const format = patchTextFormat(text);
  const prepared = prepareTopLevelArray(format.body);
  const rows = parseRows(prepared);
  const added = [];
  const already = [];
  let next = prepared;
  for (const id of ids) {
    const target = rows.find(function (row) { return extractRowId(row.text) === id; });
    if (target && /(?:^|\n)\s*disabled:\s*true\s*(?:$|\n)/.test(target.text)) {
      already.push(id);
      continue;
    }
    next = appendPatchRow(next, buildDisableRow(id));
    added.push(id);
  }
  const encoded = encodePatchText(next, format);
  return { text: encoded === text ? text : encoded, result: { added, already } };
}

export function restoreGuardRows(text, requestedIds) {
  const format = patchTextFormat(text);
  const prepared = prepareTopLevelArray(format.body);
  const removed = removeGuardRows(prepared, requestedIds);
  let next = removed.text;
  if (removed.restored.length || prepared !== format.body) next = ensureEmptyTopLevelArray(next);
  const encoded = encodePatchText(next, format);
  return { text: encoded === text ? text : encoded, result: removed.restored };
}

function isProfileDirectory(candidate) {
  try {
    const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8"));
    return !!(pkg.dsh && pkg.dsh.profile);
  } catch (_) {
    return false;
  }
}

export function findProfileDir(startDirectory = dirname(fileURLToPath(import.meta.url))) {
  try {
    let current = startDirectory;
    for (let depth = 0; depth < 12; depth++) {
      // Only a package that explicitly declares dsh.profile is authoritative.
      if (isProfileDirectory(current)) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch (_) {}
  return null;
}

export function isLoopbackAddress(address) {
  const value = String(address || "").toLowerCase().split("%")[0];
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("127.")) return true;
  if (value.startsWith("::ffff:127.")) return true;
  if (/^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(value)) return true;
  return false;
}

function remoteMutationEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.DSH_BOOT_GUARD_ALLOW_REMOTE_MUTATION || ""));
}

export const name = "boot-guard";
export const inject = ["webServer", "loader"];

export function apply(ctx) {
  const profileDir = findProfileDir();
  const patchPath = profileDir ? join(profileDir, "cordis.patch.yml") : null;
  const allowRemoteMutation = remoteMutationEnabled();
  let mutationQueue = Promise.resolve();

  async function preferredLocale(req) {
    try {
      const settingsLocale = ctx.settings && typeof ctx.settings.get === "function" ? ctx.settings.get("locale") : null;
      const active = normalizeLocale(settingsLocale && settingsLocale.preference);
      if (active) return active;
    } catch (_) {}

    try {
      let settingsPath = "";
      try {
        settingsPath = ctx.settings && typeof ctx.settings.documentPath === "string" ? ctx.settings.documentPath : "";
      } catch (_) {}
      if (!settingsPath) {
        const configuredHome = String(process.env.DSH_HOME || "").trim();
        settingsPath = join(resolve(configuredHome || join(homedir(), ".dsh")), "settings.yaml");
      }
      const active = parseLocalePreference(await readFile(settingsPath, "utf8"));
      if (active) return active;
    } catch (_) {}

    return localeFromAcceptLanguage(req && req.headers && req.headers["accept-language"]);
  }

  function entryRows() {
    const rowsById = new Map();
    try {
      for (const entry of ctx.loader.entries()) {
        const entryName = entry.options && entry.options.name;
        const entryId = entry.options && entry.options.id;
        if (!entryName || !entryId) continue;
        const disabled = !!entry.disabled;
        const protectedEntry = entryId === "boot-guard" || entryName === "dsh-boot-guard";
        const existing = rowsById.get(entryId);
        if (existing) {
          existing.instances += 1;
          // Duplicate ids can appear in separate loader groups. Treat an id as
          // available when at least one instance is enabled, and keep the more
          // descriptive package name instead of a generic cordis group label.
          existing.disabled = existing.disabled && disabled;
          existing.protected = existing.protected || protectedEntry;
          if (existing.name === "cordis:group" && entryName !== "cordis:group") {
            existing.name = entryName;
          }
          continue;
        }
        rowsById.set(entryId, {
          id: entryId,
          name: entryName,
          disabled,
          protected: protectedEntry,
          instances: 1
        });
      }
    } catch (_) {}
    return Array.from(rowsById.values());
  }

  function enqueueMutation(operation) {
    const run = mutationQueue.then(operation, operation);
    mutationQueue = run.then(function () {}, function () {});
    return run;
  }

  function mutatePatch(render) {
    return enqueueMutation(async function () {
      if (!patchPath) {
        throw errorWithStatus(503, "unable to safely locate the active DSH profile; mutation is disabled");
      }
      return mutatePatchFile(patchPath, render);
    });
  }

  async function stateHandler(req, res) {
    try {
      if (!methodAllowed(req, res, "GET")) return;
      await mutationQueue;
      const locale = await preferredLocale(req);
      const rows = entryRows();
      let text = "";
      let readOnlyReason = "";
      let readOnlyReasonCode = "";
      if (!patchPath) {
        readOnlyReason = "无法安全定位当前 DSH profile，已进入只读模式。";
        readOnlyReasonCode = "profile-unresolved";
      } else {
        try {
          text = await readFile(patchPath, "utf8");
          prepareTopLevelArray(patchTextFormat(text).body);
        } catch (_) {
          readOnlyReason = "当前 profile 的 cordis.patch.yml 无法安全读取或不是顶层 YAML 数组，已进入只读模式。";
          readOnlyReasonCode = "patch-invalid";
        }
      }
      if (!readOnlyReason && !allowRemoteMutation && !isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
        readOnlyReason = "当前连接不是本机回环地址；远程配置变更默认禁用。";
        readOnlyReasonCode = "remote-mutation-disabled";
      }
      const skipped = [];
      for (const match of text.matchAll(/# \[dsh-boot-guard\] skip-marker ([^\r\n]+)/g)) {
        skipped.push(match[1]);
      }
      json(res, 200, {
        version: VERSION,
        locale,
        entries: rows,
        skipped,
        writable: !readOnlyReason,
        readOnlyReason,
        readOnlyReasonCode,
        summary: {
          entries: rows.length,
          skipped: skipped.length,
          available: rows.filter(function (entry) { return !entry.disabled && !entry.protected; }).length
        }
      });
    } catch (error) {
      json(res, error.statusCode || 500, { error: String(error && error.message || error) });
    }
  }

  async function skipHandler(req, res) {
    try {
      if (!methodAllowed(req, res, "POST")) return;
      assertMutationRequest(req, allowRemoteMutation);
      const body = await readJsonBody(req);
      const ids = normalizeIds(body);
      if (!ids.length) throw errorWithStatus(400, "missing ids");

      const entries = new Map(entryRows().map(function (entry) { return [entry.id, entry]; }));
      for (const id of ids) {
        const entry = entries.get(id);
        if (!entry) throw errorWithStatus(404, "unknown loader entry: " + id);
        if (entry.protected) throw errorWithStatus(409, "boot-guard cannot disable itself");
      }

      const result = await mutatePatch(function (text) { return addGuardRows(text, ids); });
      json(res, 200, { ok: true, added: result.added, already: result.already });
    } catch (error) {
      json(res, error.statusCode || 500, { error: String(error && error.message || error) });
    }
  }

  async function restoreHandler(req, res) {
    try {
      if (!methodAllowed(req, res, "POST")) return;
      assertMutationRequest(req, allowRemoteMutation);
      const body = await readJsonBody(req);
      const ids = normalizeIds(body);
      const requested = ids.length ? new Set(ids) : null;
      const result = await mutatePatch(function (text) { return restoreGuardRows(text, requested); });
      json(res, 200, { ok: true, restored: result });
    } catch (error) {
      json(res, error.statusCode || 500, { error: String(error && error.message || error) });
    }
  }

  async function routeHandler(req, res) {
    try {
      const url = new URL(req.url || "/", "http://x");
      const subpath = url.pathname.replace(/^\/boot-guard/, "");

      if (subpath === "/client.js") {
        if (!methodAllowed(req, res, "GET")) return;
        const clientPath = join(dirname(fileURLToPath(import.meta.url)), "client.js");
        const body = await readFile(clientPath);
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        });
        res.end(body);
        return;
      }
      if (subpath === "/health") {
        if (!methodAllowed(req, res, "GET")) return;
        json(res, 200, { ok: true, version: VERSION });
        return;
      }
      if (subpath === "/preview") {
        if (!methodAllowed(req, res, "GET")) return;
        const theme = url.searchParams.get("theme") === "light" ? "light" : "dark";
        const body = previewHtml(theme, await preferredLocale(req));
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'"
        });
        res.end(body);
        return;
      }
      if (subpath === "/state") return stateHandler(req, res);
      if (subpath === "/skip") return skipHandler(req, res);
      if (subpath === "/restore") return restoreHandler(req, res);
      res.writeHead(404, { "cache-control": "no-store" });
      res.end();
    } catch (error) {
      json(res, error.statusCode || 500, { error: String(error && error.message || error) });
    }
  }

  ctx.effect(
    function () {
      return ctx.webServer.register({ kind: "prefix", path: "/boot-guard", handler: routeHandler });
    },
    "boot-guard: routes"
  );
  ctx.effect(
    function () {
      return ctx.webServer.tapIndex(injectRescue);
    },
    "boot-guard: rescue script"
  );
}

function previewHtml(theme, locale) {
  const dark = theme === "dark";
  const english = locale === "en";
  const themeAttribute = dark ? ' data-ds-dark-theme=""' : "";
  const background = dark ? "#121315" : "#f5f6f8";
  const foreground = dark ? "#f1f3f5" : "#1d232b";
  const secondary = dark ? "#9ca3ad" : "#68717d";
  return '<!doctype html><html lang="' + (english ? "en" : "zh-CN") + '" data-boot-guard-theme="' + theme + '"' + themeAttribute + '><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + (english ? "Boot Guard self-check" : "Boot Guard 自检") + '</title><style>' +
    ':root{color-scheme:' + theme + '}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:' + background + ';color:' + foreground + ';font-family:Inter,"Segoe UI",system-ui,sans-serif}' +
    '.preview-fail{width:min(760px,calc(100% - 32px));margin:48px auto 0}.preview-brand{font-size:13px;font-weight:700;letter-spacing:.14em;margin-bottom:24px}' +
    '.preview-error{padding:20px 22px;border:1px solid rgba(127,127,127,.22);border-radius:14px;background:rgba(127,127,127,.045)}' +
    '.preview-error h1{font-size:18px;line-height:1.4;margin:0 0 8px}.preview-error p{color:' + secondary + ';font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;margin:0;overflow-wrap:anywhere}' +
    '</style></head><body' + themeAttribute + ' data-boot-guard-preview="1"><main id="root"><div class="preview-fail">' +
    '<div class="preview-brand">HARNESS · RESCUE SELF-CHECK</div><section class="preview-error"><h1>Failed to load plugins</h1>' +
    '<p>failed to import loader entry dress-up (dsh-personal-dress-up): self-check preview; no configuration change will be made</p>' +
    '</section></div></main><script defer src="/boot-guard/client.js"></script></body></html>';
}

function injectRescue(html) {
  try {
    if (html.includes(RESCUE_MARKER)) return html;
    const anchor = "</head>";
    const offset = html.lastIndexOf(anchor);
    if (offset === -1) return html;
    const meta = '<meta name="dsh-boot-guard" content="' + RESCUE_MARKER + '">';
    const script = '<script defer src="/boot-guard/client.js"></script>';
    return html.slice(0, offset) + meta + "\n" + script + "\n" + html.slice(offset);
  } catch (_) {
    return html;
  }
}
