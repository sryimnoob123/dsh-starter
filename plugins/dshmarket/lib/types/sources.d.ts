/**
 * Registry-source knowledge: how a curated registry entry's URL maps to an
 * installable pnpm target. Pure string logic, no I/O.
 */
/**
 * Parse a registry source url: a github repo, optionally with a
 * `/tree/<branch>/<subpath>` suffix (how the curated list links monorepo
 * subpackages, e.g. dsh-plugins#theme-gallery).
 */
export declare function parseSourceUrl(url: string): {
    repo: string;
    subpath: string | null;
} | null;
/** Parse repository forms accepted by package.json.repository. */
export declare function parseGitHubRepository(value: string): {
    repo: string;
} | null;
/**
 * Parse a Git remote. Unlike package metadata, a local origin may contain a
 * proxy prefix (for example `https://proxy/https://github.com/o/r.git`). In
 * that case only the last GitHub occurrence is considered.
 */
export declare function parseGitHubRemote(url: string): {
    repo: string;
} | null;
/** Normalized repo identity shared by server discovery and client matching. */
export declare function githubRepoIdentity(url: string, directory?: string | null): string | null;
/**
 * Repository evidence used for installed-source matching. A monorepo package
 * contributes both its collection root and exact subpath, mirroring the
 * identities extracted from `github:owner/repo#path:/package` specs.
 */
export declare function githubRepoIdentities(url: string, directory?: string | null): string[];
/** Weak identity hints from a local Git origin; never used to reject a unique match. */
export declare function githubRemoteIdentities(url: string, directory?: string | null): string[];
/** GitHub `owner/repo` for a registry URL, or null when it is not a GitHub repo URL. */
export declare function repoOf(url: string): string | null;
/**
 * The allowBuilds key that actually authorizes a git-hosted dependency's
 * build scripts. Verified against pnpm 11.21 (#68 by @yzr278892): for a
 * `github:owner/repo` install, a bare `name: true` entry does NOT match —
 * pnpm's own hint names a commit-pinned codeload URL that changes on every
 * push; the stable form that matches is `name@git+https://github.com/owner/repo.git`.
 * @param name - installed package name.
 * @param spec - the dependency spec from package.json, or the install target.
 * @returns the stable key, or null when the spec is not github-hosted.
 */
export declare function gitAllowBuildsKey(name: string, spec: string): string | null;
/**
 * The pnpm install target for a registry entry. Registry tarballs beat
 * full-repo GitHub downloads: smaller, prebuilt, and CDN/mirror served. The
 * npm name comes from our curated registry, which only maps repo-verified
 * packages (name-squatting protection).
 * @returns the target spec, or null when the source url is unsupported.
 */
export declare function installTargetFor(entry: {
    url: string;
    npm?: unknown;
}): string | null;
/**
 * The name an entry is ALREADY installed under, or null — the server-side
 * duplicate guard (#27): the same plugin listed under an alias entry must
 * never install twice (two loader entries with one id brick the next boot).
 *
 * Identity is subpath-aware so monorepo siblings stay independent: an entry
 * with a /tree/ subpath identifies as repo#path:/sub (never the bare repo),
 * while an installed dependency contributes its bare repo AND its #path:
 * form — so a collection root still matches the pieces it was retargeted
 * into, but two different subpackages of one repo never cross-match.
 */
export declare function findInstalledAlias(entry: {
    name: string;
    npm?: unknown;
    url: string;
}, installed: Record<string, string>): string | null;
