/**
 * Profile composition diagnostics — issue #98 (phase 1): the check-only
 * "plugin loading layer and conflict view".
 *
 * Pure filesystem analysis of one dsh profile directory; no processes, no
 * network, no writes. It answers, for the profile the market is serving:
 *
 *  1. What is the actual bundle stack (dsh.profile.bundles order) and where
 *     does each layer come from (official in-box bundle vs community, the
 *     dependency spec, the resolved directory)?
 *  2. Which loader entry ids does the composed tree contain, and are any
 *     duplicated across layers (the "duplicate loader entry id" boot failure
 *     from #98)? Which rows does a later layer override?
 *  3. Does any installed plugin pull a DSH host core package
 *     (@deepseek-ai/dsh, @deepseek-ai/dsh-tools, @deepseek-ai/cordis, …) in
 *     as an ordinary dependency — the dsh-excel-chat failure mode where the
 *     plugin's copy gets hoisted to the profile root and shadows the host's
 *     version (tool calls die, minimal preset fails to mount)?
 *  4. Are there multiple versions of one core package in the lockfile, and
 *     do plugin peerDependencies ranges match the resolved core version?
 *
 * The composition step mirrors @deepseek-ai/dsh-app-boot's applyEntryPatches
 * (same js-yaml dialect incl. `!!js` scalars), so the rows reported here are
 * what actually mounts at boot.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { JSON_SCHEMA, Type, load } from 'js-yaml';
import { INBOX_BUNDLES, readBundleRules, suggestOrder, validateOrder } from './order.js';
/** js-yaml dialect for `!!js` scalars — identical to dsh-app-boot's entryListSchema. */
const jsExpr = new Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    resolve: (data) => typeof data === 'string',
    construct: (data) => ({ __jsExpr: String(data) }),
});
const entrySchema = JSON_SCHEMA.extend(jsExpr);
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Parse one entry-list patch file with the dsh dialect; null when unreadable. */
export function parsePatchFile(path) {
    let text;
    try {
        text = readFileSync(path, 'utf8');
    }
    catch {
        return null;
    }
    try {
        const value = load(text, { schema: entrySchema });
        return Array.isArray(value) ? value : null;
    }
    catch {
        return null;
    }
}
/** Every id in one patch row's insert list, recursively (group configs included). */
function collectInsertIds(rows) {
    const ids = [];
    const walk = (value) => {
        if (!Array.isArray(value))
            return;
        for (const entry of value) {
            if (!isRecord(entry) || typeof entry.id !== 'string')
                continue;
            ids.push(entry.id);
            if (Array.isArray(entry.config))
                walk(entry.config);
        }
    };
    for (const patch of rows) {
        if (!isRecord(patch) || !Array.isArray(patch.insert))
            continue;
        walk(patch.insert);
    }
    return ids;
}
/** DSH host core packages: what the dsh installation ships under @deepseek-ai. */
export function corePackageNames(dshInstallDir) {
    const names = new Set([
        // Curated fallback seed (used when the install dir cannot be located).
        '@deepseek-ai/dsh',
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-web-app',
        '@deepseek-ai/dsh-headless',
        '@deepseek-ai/dsh-app-boot',
        '@deepseek-ai/dsh-home-paths',
        '@deepseek-ai/dsh-launch-environment',
        '@deepseek-ai/dsh-cmdline',
        '@deepseek-ai/dsh-tools',
        '@deepseek-ai/dsh-llm',
        '@deepseek-ai/dsh-system-prompt',
        '@deepseek-ai/dsh-attachment',
        '@deepseek-ai/dsh-agent',
        '@deepseek-ai/dsh-agent-loop',
        '@deepseek-ai/dsh-session',
        '@deepseek-ai/dsh-subagent',
        '@deepseek-ai/cordis',
        '@deepseek-ai/cordis-plugin-loader',
        '@deepseek-ai/cordis-plugin-include',
        '@deepseek-ai/cordis-plugin-hmr',
        '@deepseek-ai/cordis-plugin-timer',
        '@deepseek-ai/cordis-plugin-group',
    ]);
    if (dshInstallDir === null)
        return names;
    try {
        // The install's own node_modules is the authoritative host-core inventory:
        // everything under @deepseek-ai whose bare name starts with dsh or cordis,
        // plus the app package itself.
        for (const entry of readdirSync(join(dshInstallDir, 'node_modules', '@deepseek-ai'), { withFileTypes: true })) {
            if (!entry.isDirectory() && !entry.isSymbolicLink())
                continue;
            if (/^(?:dsh|cordis)/.test(entry.name))
                names.add(`@deepseek-ai/${entry.name}`);
        }
    }
    catch { /* install node_modules unreadable — the curated seed stands */ }
    try {
        const manifest = JSON.parse(readFileSync(join(dshInstallDir, 'package.json'), 'utf8'));
        if (typeof manifest.name === 'string')
            names.add(manifest.name);
    }
    catch { /* not a package dir */ }
    return names;
}
/**
 * Locate the dsh host installation from the process entry (the same source
 * dsh-cli.ts uses to re-invoke the CLI): walk up from dirname(argv[1]) until
 * a package.json named @deepseek-ai/dsh is found.
 */
export function findDshInstallDir(entry = process.argv[1]) {
    if (entry === undefined)
        return null;
    let dir = resolve(dirname(entry));
    for (let depth = 0; depth < 10; depth += 1) {
        try {
            const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
            if (manifest.name === '@deepseek-ai/dsh')
                return dir;
        }
        catch { /* keep walking up */ }
        const parent = dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
    return null;
}
/** Version of `name` as physically resolved at `base`/node_modules, or null. */
function readNodeModulesVersion(base, name) {
    try {
        const manifest = JSON.parse(readFileSync(join(base, 'node_modules', name, 'package.json'), 'utf8'));
        return typeof manifest.version === 'string' ? manifest.version : null;
    }
    catch {
        return null;
    }
}
/**
 * Resolve one bundle package's directory the way the dsh boot does
 * (dsh-app-boot's resolveBundleDir): probe Node's own node_modules search
 * paths from the installation anchor first, then the profile directory.
 * Node resolution walks upward, so this also finds pnpm's workspace-root
 * hoisting (`<profiles>/node_modules/…` when the profile lives under
 * `<profiles>/<name>`) and matches exactly what the Loader would import.
 */
function resolveBundleDir(anchorPackageJson, name) {
    let paths = [];
    try {
        paths = createRequire(anchorPackageJson).resolve.paths(name) ?? [];
    }
    catch {
        return null;
    }
    for (const searchPath of paths) {
        const candidate = join(searchPath, name);
        if (existsSync(join(candidate, 'package.json')))
            return candidate;
    }
    return null;
}
/**
 * Version of `name` visible to the profile's dependency tree: the profile's
 * own node_modules first, then the workspace root (pnpm hoists shared deps
 * there when the profile is a workspace member — the dsh layout keeps
 * `<profiles>/node_modules` as the shared store for all profiles).
 */
function readProfileVisibleVersion(profileDirectory, name) {
    const direct = readNodeModulesVersion(profileDirectory, name);
    if (direct !== null)
        return direct;
    const workspaceRoot = dirname(profileDirectory);
    if (workspaceRoot === profileDirectory)
        return null;
    return readNodeModulesVersion(workspaceRoot, name);
}
/** Top-level installed package names (incl. scoped), excluding pnpm internals. */
function installedPackageNames(profileDir) {
    const names = [];
    // Windows `link:` installs are junctions; Dirent.isDirectory() is false for
    // them on some Node versions, so treat symlinks as packages too (B2).
    const isPkgDir = (entry) => entry.isDirectory() || entry.isSymbolicLink();
    let root;
    try {
        root = readdirSync(join(profileDir, 'node_modules'), { withFileTypes: true })
            .filter(entry => isPkgDir(entry) && entry.name !== '.bin' && entry.name !== '.pnpm' && entry.name !== '.dsh-plugin-backups')
            .map(entry => entry.name);
    }
    catch {
        return names;
    }
    for (const name of root) {
        if (!name.startsWith('@')) {
            names.push(name);
            continue;
        }
        try {
            for (const scoped of readdirSync(join(profileDir, 'node_modules', name), { withFileTypes: true })) {
                if (isPkgDir(scoped))
                    names.push(`${name}/${scoped.name}`);
            }
        }
        catch { /* empty scope dir */ }
    }
    return names;
}
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
function parseSemver(value) {
    const m = SEMVER_RE.exec(value.trim());
    if (m === null)
        return null;
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        pre: m[4] === undefined ? [] : m[4].split('.'),
    };
}
function comparePre(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
        const x = a[i];
        const y = b[i];
        if (x === undefined)
            return y === undefined ? 0 : -1; // a has fewer parts → a < b
        if (y === undefined)
            return 1;
        if (x === y)
            continue;
        const xn = /^\d+$/.test(x);
        const yn = /^\d+$/.test(y);
        if (xn && yn)
            return Number(x) - Number(y) || 0;
        if (xn)
            return -1; // numeric identifiers sort before alphanumeric
        if (yn)
            return 1;
        return x < y ? -1 : 1;
    }
    return 0;
}
/** Compare two semver strings: negative | zero | positive (prerelease < release of same base). */
export function compareSemver(a, b) {
    const av = parseSemver(a);
    const bv = parseSemver(b);
    if (av === null || bv === null)
        return a < b ? -1 : a > b ? 1 : 0;
    if (av.major !== bv.major)
        return av.major - bv.major || 0;
    if (av.minor !== bv.minor)
        return av.minor - bv.minor || 0;
    if (av.patch !== bv.patch)
        return av.patch - bv.patch || 0;
    if (av.pre.length === 0 && bv.pre.length === 0)
        return 0;
    if (av.pre.length === 0)
        return 1; // release > prerelease
    if (bv.pre.length === 0)
        return -1;
    return comparePre(av.pre, bv.pre);
}
function gte(a, b) {
    const cmp = compareSemver(`${a.major}.${a.minor}.${a.patch}${a.pre.length > 0 ? `-${a.pre.join('.')}` : ''}`, `${b.major}.${b.minor}.${b.patch}${b.pre.length > 0 ? `-${b.pre.join('.')}` : ''}`);
    return cmp >= 0;
}
/** String form of a parsed Semver (the boundary objects carry no prerelease). */
function semverStr(v) {
    return `${v.major}.${v.minor}.${v.patch}${v.pre.length > 0 ? `-${v.pre.join('.')}` : ''}`;
}
/**
 * Minimal range matcher for the peer-range check: `*`, exact, ^, ~, >=, >,
 * <=, <, whitespace-separated pairs, and `||` alternatives. Anything else
 * returns null (unknown — reported, not asserted).
 *
 * Prerelease handling follows npm's semver rule, evaluated at the comparator
 * SET level (one `||` alternative is one set): a version carrying a
 * prerelease tag only satisfies a set when at least one comparator in that
 * set shares the version's [major, minor, patch] tuple AND carries a
 * prerelease of its own; then every comparator is checked normally. So
 * `^0.1.0` never matches `0.2.0-rc.1` (nor `0.1.0-rc.5`), while
 * `>=1.2.3-rc.1 <2.0.0` does match `1.2.3-rc.2` (issue #98 analysis).
 */
export function satisfiesRange(version, range) {
    const v = parseSemver(version);
    if (v === null)
        return null;
    const versionHasPre = v.pre.length > 0;
    const single = (part) => {
        const p = part.trim();
        if (p === '' || p === '*' || p === 'x' || p === 'X')
            return true;
        const m = /^(\^|~|>=|<=|>|<)?(.*)$/.exec(p);
        const op = m?.[1] ?? '';
        const target = (m?.[2] ?? '').trim();
        const tv = parseSemver(target);
        if (tv === null)
            return null;
        const major = tv.major;
        const minor = tv.minor;
        const patch = tv.patch;
        switch (op) {
            case '':
                return compareSemver(version, target) === 0;
            case '>=':
                return gte(v, tv);
            case '<=':
                return gte(tv, v);
            case '>':
                return compareSemver(version, target) > 0;
            case '<':
                return compareSemver(version, target) < 0;
            case '^': {
                // npm caret semantics: >= given, strictly < the next breaking bump.
                const upper = major > 0
                    ? { major: major + 1, minor: 0, patch: 0, pre: [] }
                    : minor > 0
                        ? { major: 0, minor: minor + 1, patch: 0, pre: [] }
                        : { major: 0, minor: 0, patch: patch + 1, pre: [] };
                return gte(v, tv) && compareSemver(semverStr(upper), version) > 0;
            }
            case '~': {
                // npm tilde semantics: >= given, strictly < the next minor.
                const upper = { major, minor: minor + 1, patch: 0, pre: [] };
                return gte(v, tv) && compareSemver(semverStr(upper), version) > 0;
            }
            default:
                return null;
        }
    };
    /** Parse one comparator part into op + target; null when unknown. */
    const comparator = (part) => {
        const p = part.trim();
        if (p === '' || p === '*' || p === 'x' || p === 'X')
            return { op: '', target: '' };
        const m = /^(\^|~|>=|<=|>|<)?(.*)$/.exec(p);
        if (m === null)
            return null;
        return { op: m[1] ?? '', target: (m[2] ?? '').trim() };
    };
    /** Evaluate ONE comparator set (a `||` alternative) as a conjunction. */
    const evaluateSet = (set) => {
        const parts = set.trim().split(/\s+/).filter(part => part !== '');
        if (parts.length === 0)
            return true;
        const parsed = parts.map(part => comparator(part));
        if (parsed.some(part => part === null))
            return null;
        if (versionHasPre) {
            // npm gate (set-level): the set admits prerelease versions only when a
            // comparator pins the SAME base tuple with a prerelease of its own.
            const admitted = parsed.some((part) => {
                if (part?.target === '')
                    return false;
                const tv = parseSemver(part?.target ?? '');
                return tv !== null && tv.pre.length > 0
                    && v.major === tv.major && v.minor === tv.minor && v.patch === tv.patch;
            });
            if (!admitted)
                return false;
        }
        const results = parsed.map(part => single(part?.op !== undefined ? `${part.op}${part.target}` : ''));
        if (results.some(r => r === null))
            return null;
        return results.every(r => r === true);
    };
    if (range.includes('||')) {
        const outcomes = range.split('||').map(part => evaluateSet(part));
        if (outcomes.some(out => out === true))
            return true;
        return outcomes.every(out => out === null) ? null : false;
    }
    return evaluateSet(range);
}
/** Flatten a tree of entries (group configs included) into row records. */
function flattenEntries(nodes) {
    const rows = [];
    const walk = (list) => {
        for (const node of list) {
            rows.push({ id: node.id, layer: node.layer, kind: 'insert', name: node.name });
            if (node.group === true && Array.isArray(node.config))
                walk(node.config);
        }
    };
    walk(nodes);
    return rows;
}
/**
 * Apply the layer stack over an empty root exactly like the dsh boot include.
 * Exported so the trial-start validation (src/trial.ts) can replay the
 * composition with a candidate bundle order BEFORE anything is written.
 */
export function composeLayers(layers) {
    const tree = [];
    const orphans = [];
    const overrides = [];
    /**
     * The boot's entryMap, mirrored incrementally: the LAST row registered for
     * an id (top-level or nested group member) is the patch target, and later
     * inserts overwrite the map entry — exactly dsh-app-boot's applyEntryPatches
     * buildMap. Keeping the map instead of re-walking the tree pins the
     * duplicate-id resolution to the boot's behavior (issue #98 analysis:
     * explicit composition boundaries).
     */
    const entryMap = new Map();
    const buildMap = (nodes) => {
        for (const node of nodes) {
            if (node.id !== '')
                entryMap.set(node.id, node);
            if (node.group === true && Array.isArray(node.config))
                buildMap(node.config);
        }
    };
    for (const layer of layers) {
        for (const patch of layer.patches) {
            if (!isRecord(patch))
                continue;
            const { id, insert, name, ...overridesOf } = patch;
            // Boot boundary: `insert` and `id` are truthiness-checked, so a falsy
            // `insert` (null/''/0) falls through to the patch path and an empty id
            // makes an insert a plain top-level append (applyEntryPatches).
            const hasId = typeof id === 'string' ? id !== '' : Boolean(id);
            const lookupKey = hasId ? String(id) : '';
            if (insert) {
                if (!Array.isArray(insert)) {
                    orphans.push({ id: lookupKey === '' ? '(anonymous)' : lookupKey, layer: layer.label, reason: 'insert is not an array' });
                    continue;
                }
                const nodes = insert.filter(isRecord).map((entry) => {
                    if (typeof entry.id !== 'string')
                        return null;
                    return {
                        id: entry.id,
                        name: typeof entry.name === 'string' ? entry.name : undefined,
                        layer: layer.label,
                        group: entry.group === true,
                        config: Array.isArray(entry.config) ? entry.config : undefined,
                    };
                }).filter((n) => n !== null);
                if (hasId) {
                    const target = entryMap.get(lookupKey);
                    if (target === undefined) {
                        orphans.push({ id: lookupKey, layer: layer.label, reason: 'insert target not found' });
                        continue;
                    }
                    if (target.group !== true) {
                        orphans.push({ id: lookupKey, layer: layer.label, reason: 'insert target is not a group' });
                        continue;
                    }
                    // Boot boundary: a group with a non-array config is fixed up to an
                    // empty array before the append (applyEntryPatches does the same).
                    if (!Array.isArray(target.config))
                        target.config = [];
                    target.config = [...target.config, ...nodes];
                }
                else {
                    tree.push(...nodes);
                }
                buildMap(nodes);
                continue;
            }
            if (!hasId) {
                orphans.push({ id: '(anonymous)', layer: layer.label, reason: 'id required for non-insert patch' });
                continue;
            }
            const target = entryMap.get(lookupKey);
            if (target === undefined) {
                orphans.push({ id: lookupKey, layer: layer.label, reason: 'patch target not found' });
                continue;
            }
            // Boot boundary: the name guard is truthiness-based — an empty-string
            // name on the patch row does not trigger the mismatch skip.
            if (name && name !== target.name) {
                orphans.push({ id: lookupKey, layer: layer.label, reason: `name mismatch (expected ${String(target.name)}, got ${String(name)})` });
                continue;
            }
            const priorLayers = [];
            for (const node of flattenEntries(tree)) {
                if (node.id === lookupKey && !priorLayers.includes(node.layer))
                    priorLayers.push(node.layer);
            }
            if (priorLayers.some(prior => prior !== layer.label)) {
                overrides.push({ id: lookupKey, layer: layer.label, overriddenLayers: priorLayers.filter(prior => prior !== layer.label) });
            }
            for (const [key, value] of Object.entries(overridesOf)) {
                if (key === 'id')
                    continue;
                target[key] = value;
            }
        }
    }
    const rows = flattenEntries(tree);
    const byId = new Map();
    for (const row of rows) {
        const layers = byId.get(row.id) ?? [];
        if (!layers.includes(row.layer))
            layers.push(row.layer);
        byId.set(row.id, layers);
    }
    const duplicates = [];
    const counts = new Map();
    for (const row of rows)
        counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    for (const [id, count] of counts) {
        if (count < 2)
            continue;
        duplicates.push({ id, layers: byId.get(id) ?? [], count });
    }
    duplicates.sort((a, b) => a.id.localeCompare(b.id));
    return { rows, duplicates, overrides, orphans };
}
/** Distinct versions of `@deepseek-ai/{dsh,cordis}*` packages in the lockfile. */
function lockfileCoreVersions(profileDir) {
    const found = new Map();
    let text;
    try {
        text = readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8');
    }
    catch {
        return new Map();
    }
    for (const m of text.matchAll(/(@deepseek-ai\/(?:dsh|cordis)[^@\s'"]*?)@([0-9][^\s:'"()]*)/g)) {
        const name = m[1] ?? '';
        // pnpm v9 peer-resolution keys carry a suffix: `name@1.0.0(peer@x)`. The
        // version capture stops at the `(` — and at `)` too, so the peer
        // reference INSIDE the suffix (`name@1.0.0(@deepseek-ai/dsh-base@4.0.1)`)
        // never yields a fake `4.0.1)` version that would invent a phantom
        // multi-version report on a healthy profile (issue #98 analysis).
        const version = m[2] ?? '';
        // Registry resolutions only: skip link:/git forms and anything that is
        // not a well-formed semver (parseSemver double-checks the capture).
        if (parseSemver(version) === null)
            continue;
        const versions = found.get(name) ?? new Set();
        versions.add(version);
        found.set(name, versions);
    }
    const out = new Map();
    for (const [name, versions] of found)
        out.set(name, [...versions].sort(compareSemver));
    return out;
}
/**
 * Build the bundle layer stack for a profile under a GIVEN bundle order —
 * the manifest order for analyzeProfile, or a candidate order for trial
 * validation (src/trial.ts). Bundle resolution mirrors the boot exactly:
 * the dsh installation anchor first (in-box bundles always come from the
 * running dsh, never a profile-local copy), then Node's module search from
 * the profile directory (covers community bundles and pnpm workspace-root
 * hoisting). A single code path keeps the check report and the trial
 * validation from ever disagreeing about what a bundle is or where it lives.
 */
export function buildBundleLayers(profileDirectory, bundleNames, specs, dshInstallDir) {
    const bundles = bundleNames.map((name) => {
        const anchors = [
            dshInstallDir !== null ? join(dshInstallDir, 'package.json') : null,
            join(profileDirectory, 'package.json'),
        ];
        let directory = null;
        for (const anchor of anchors) {
            if (anchor === null)
                continue;
            directory = resolveBundleDir(anchor, name);
            if (directory !== null)
                break;
        }
        const layer = {
            name,
            source: specs[name] ?? '(not a direct dependency)',
            kind: INBOX_BUNDLES.has(name) ? 'official' : 'community',
            directory,
            patchPath: null,
            error: null,
            entries: [],
            parseError: null,
        };
        if (directory === null) {
            layer.error = 'bundle package is not installed — the profile will fail to boot';
            return layer;
        }
        let bundleManifest;
        try {
            bundleManifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        }
        catch {
            layer.error = 'bundle package.json is unreadable';
            return layer;
        }
        const declared = bundleManifest.dsh?.bundle?.patch;
        if (typeof declared !== 'string') {
            layer.error = 'bundle declares no dsh.bundle.patch — the profile will fail to boot';
            return layer;
        }
        const patchPath = join(directory, declared);
        if (!existsSync(patchPath)) {
            layer.error = `declared patch ${declared} is missing — the profile will fail to boot`;
            return layer;
        }
        layer.patchPath = patchPath;
        const patches = parsePatchFile(patchPath);
        if (patches === null) {
            layer.parseError = 'patch file is not a valid entry list';
            return layer;
        }
        layer.entries = collectInsertIds(patches);
        const order = bundleManifest.dsh?.bundle?.order;
        if (order !== null && typeof order === 'object' && !Array.isArray(order)) {
            const listOf = (value) => Array.isArray(value)
                ? value.filter((item) => typeof item === 'string')
                : undefined;
            const after = listOf(order.after);
            const before = listOf(order.before);
            if (after !== undefined || before !== undefined) {
                layer.order = { ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) };
            }
        }
        return layer;
    });
    const layers = bundles.map((bundle) => ({
        label: bundle.name,
        kind: 'bundle',
        patches: bundle.patchPath !== null && bundle.parseError === null ? parsePatchFile(bundle.patchPath) ?? [] : [],
        parseError: bundle.parseError,
    }));
    return { bundles, layers };
}
/**
 * Analyze one profile directory (issue #98, phase 1). Pure function of the
 * directory contents — safe to call on every market open.
 */
export function analyzeProfile(profileDirectory, options = {}) {
    const dshInstall = options.dshInstallDir ?? findDshInstallDir();
    const home = options.homeDir ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
    const core = corePackageNames(dshInstall);
    // --- 1. bundle stack ---
    const manifest = (() => {
        try {
            return JSON.parse(readFileSync(join(profileDirectory, 'package.json'), 'utf8'));
        }
        catch {
            return null;
        }
    })();
    const bundleNames = Array.isArray(manifest?.dsh?.profile?.bundles)
        ? manifest.dsh.profile.bundles.filter((name) => typeof name === 'string')
        : [];
    const specs = manifest?.dependencies ?? {};
    const built = buildBundleLayers(profileDirectory, bundleNames, specs, dshInstall);
    const bundles = built.bundles;
    const bundleLayers = built.layers;
    // --- 2. composed loader rows / duplicates / overrides / orphans ---
    const layers = [...bundleLayers];
    const userPatchPath = join(profileDirectory, 'cordis.patch.yml');
    if (existsSync(userPatchPath)) {
        const patches = parsePatchFile(userPatchPath);
        layers.push({ label: 'user-patch', kind: 'user', patches: patches ?? [], parseError: patches === null ? 'patch file is not a valid entry list' : null });
    }
    const homePatchPath = join(home, 'cordis.patch.yml');
    if (existsSync(homePatchPath)) {
        const patches = parsePatchFile(homePatchPath);
        layers.push({ label: 'home-patch', kind: 'home', patches: patches ?? [], parseError: patches === null ? 'patch file is not a valid entry list' : null });
    }
    const composed = composeLayers(layers);
    // --- 3. peer dependency mismatches (every declared peer, core or not) ---
    // NOTE (issue #98 division of labor): the core-package-as-ordinary-
    // dependency check (coreDeps / shadowing) belongs to @yzke's manifest PR;
    // PR-A keeps only the peer-resolution check here.
    const peerMismatches = [];
    const seenDeps = new Set();
    for (const plugin of installedPackageNames(profileDirectory)) {
        let pkg;
        try {
            pkg = JSON.parse(readFileSync(join(profileDirectory, 'node_modules', plugin, 'package.json'), 'utf8'));
        }
        catch {
            continue;
        }
        const pluginDir = join(profileDirectory, 'node_modules', plugin);
        const map = pkg.peerDependencies;
        if (map === null || typeof map !== 'object')
            continue;
        for (const [name, spec] of Object.entries(map)) {
            if (typeof spec !== 'string')
                continue;
            const key = `${plugin}\u0000${name}\u0000peer`;
            if (seenDeps.has(key))
                continue;
            seenDeps.add(key);
            const hoisted = readProfileVisibleVersion(profileDirectory, name);
            const nested = readNodeModulesVersion(pluginDir, name);
            const host = dshInstall !== null ? readNodeModulesVersion(dshInstall, name) : null;
            // Node resolves a plugin's peer from its OWN node_modules first
            // (nested), then the profile tree (hoisted), then the host install.
            const resolved = nested ?? hoisted ?? host;
            // Peer checks cover EVERY declared peer, not just host core packages:
            // plugin-to-plugin peer mismatches break runtime registration just as
            // hard (issue #98 optimization round).
            const satisfied = resolved !== null ? satisfiesRange(resolved, spec) : null;
            peerMismatches.push({
                plugin, name, range: spec, resolved,
                satisfied: satisfied === null ? null : satisfied,
            });
        }
    }
    // --- 4. multi-version core packages from the lockfile ---
    const multiVersion = [];
    for (const [name, versions] of lockfileCoreVersions(profileDirectory)) {
        if (versions.length < 2)
            continue;
        multiVersion.push({ name, versions, hoisted: readProfileVisibleVersion(profileDirectory, name) });
    }
    multiVersion.sort((a, b) => a.name.localeCompare(b.name));
    // --- summary ---
    const errors = [];
    const warnings = [];
    for (const bundle of bundles) {
        if (bundle.error !== null)
            errors.push(`bundle ${bundle.name}: ${bundle.error}`);
        if (bundle.parseError !== null)
            errors.push(`bundle ${bundle.name}: ${bundle.parseError}`);
    }
    for (const layer of layers) {
        if (layer.parseError !== null && layer.kind !== 'bundle')
            errors.push(`${layer.label}: ${layer.parseError}`);
    }
    for (const dup of composed.duplicates) {
        errors.push(`duplicate loader entry id ${JSON.stringify(dup.id)} (${dup.count} rows: ${dup.layers.join(', ')})`);
    }
    for (const orphan of composed.orphans) {
        warnings.push(`${orphan.layer}: ${orphan.id} — ${orphan.reason}`);
    }
    for (const mismatch of peerMismatches) {
        // Only CONFIRMED incompatibilities warn. Un-evaluable peers (sat=null —
        // the peer is supplied by the host, an optional accelerator, or simply
        // absent) stay in the peerMismatches list for the UI but are not noise
        // in the summary (issue #98 optimization round).
        if (mismatch.satisfied === false) {
            warnings.push(`${mismatch.plugin} peer range ${mismatch.name}@${mismatch.range} does not match resolved ${String(mismatch.resolved)}`);
        }
    }
    for (const mv of multiVersion) {
        const line = `${mv.name}: ${mv.versions.join(' / ')}${mv.hoisted !== null ? ` (hoisted ${mv.hoisted})` : ''}`;
        if (core.has(mv.name))
            errors.push(`multiple versions of core package — ${line}`);
        else
            warnings.push(`multiple versions of ${line}`);
    }
    // Current-order before/after rule conflicts (issue #98 phase 2): these are
    // informative for the ordering UI; the author-declared rule breaking the
    // CURRENT stack is worth a warning but not a boot failure. Conflicts are
    // exposed both at the report top level and per bundle (order.conflicts) so
    // the ordering panel can render them next to the bundle rows.
    const orderConflicts = validateOrder(bundleNames, readBundleRules(profileDirectory));
    for (const conflict of orderConflicts) {
        warnings.push(`${conflict.name}: ${conflict.reason}`);
    }
    for (const bundle of bundles) {
        const own = orderConflicts.filter(conflict => conflict.name === bundle.name);
        if (own.length > 0)
            bundle.order = { ...bundle.order, conflicts: own };
    }
    // LOOT-style auto-fix: suggest a minimal-change order satisfying every
    // declared before/after rule. No rules → no suggestion (nothing to fix);
    // with rules the suggestion keeps unconstrained bundles in their current
    // relative order (issue #125 review — never silently rewrites a hand-picked
    // order into an arbitrary canonical one).
    const suggestedOrder = suggestOrder(bundleNames, readBundleRules(profileDirectory));
    if (suggestedOrder === null) {
        // No declared rules — nothing to suggest and nothing to warn about.
    }
    else if (!suggestedOrder.ok) {
        warnings.push(`ordering constraints contain a cycle: ${suggestedOrder.cycle.join(' -> ')} — no compliant order exists / 排序约束存在循环依赖，无法得出合规顺序`);
    }
    else {
        // Only warn when the CURRENT order actually breaks a declared rule. A
        // hand-picked order that satisfies every rule but merely differs from the
        // suggestion is valid — flagging it would be a false alert on a healthy
        // profile (issue #98 analysis).
        if (orderConflicts.length > 0) {
            warnings.push('current bundle order violates declared rules — a better order is suggested / 当前 bundle 顺序违反声明规则，已给出更优顺序');
        }
    }
    // Duplicate loader NAMES: the Loader registers plugins by name, so two rows
    // with the same name in DIFFERENT layers shadow each other at runtime (the
    // later layer wins). Rows sharing a name within ONE layer are routine — a
    // single bundle may define several entries under the same name — and are
    // skipped entirely: a same-layer "duplicate name" is a false positive, not
    // a conflict. The hard conflict is duplicate loader entry ids
    // (report.duplicates), which fail the boot outright and are unchanged.
    const nameCounts = new Map();
    for (const row of composed.rows) {
        if (row.name === undefined)
            continue;
        const layers = nameCounts.get(row.name) ?? [];
        if (!layers.includes(row.layer))
            layers.push(row.layer);
        nameCounts.set(row.name, layers);
    }
    const duplicateNames = [];
    for (const [name, layers] of nameCounts) {
        // Only cross-layer collisions are real shadowing candidates: all rows
        // with this name living in one layer is a normal multi-entry bundle.
        if (layers.length < 2)
            continue;
        const count = composed.rows.filter(row => row.name === name).length;
        duplicateNames.push({ name, layers, count });
        // Deliberately NOT pushed into summary.warnings: the report carries the
        // shadowing rows structurally (duplicateNames, rendered by the
        // diagnostics panel), and the cost of a false positive — a healthy
        // profile flagged with a warning — outweighs a false negative here.
    }
    duplicateNames.sort((a, b) => a.name.localeCompare(b.name));
    return {
        profile: profileDirectory,
        scannedAt: Date.now(),
        bundles,
        rows: composed.rows,
        duplicates: composed.duplicates,
        duplicateNames,
        overrides: composed.overrides,
        orphans: composed.orphans,
        peerMismatches,
        multiVersion,
        orderConflicts,
        suggestedOrder,
        summary: {
            ok: errors.length === 0,
            errors,
            warnings,
        },
    };
}
