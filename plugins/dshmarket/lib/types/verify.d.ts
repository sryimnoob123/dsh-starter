/**
 * Post-install activation verification (P0-2): what "installed" actually
 * means for a package in a dsh profile.
 *
 * Two sources of truth, in strict order of authority:
 *
 * 1. The LOADER INVENTORY (observed): whatever the loader is running right
 *    now is live, full stop. A plain library with no `dsh` field can be
 *    loaded by name from someone else's bundle patch — the official
 *    dsh-base patch loads `@deepseek-ai/dsh-tools`, which has no `dsh`
 *    field at all — so no manifest check may overrule it (#135).
 * 2. The profile manifest (inferred): `<profile>/package.json` →
 *    `dsh.profile.bundles`, what the dsh CLI reconciled. This predicts what
 *    the NEXT boot will load, and is the only evidence available for a
 *    package that is not currently running.
 *
 * State taxonomy (IMPROVEMENT-PLAN P0-2):
 *   live    – running in the current composition (hot mount or loader entry)
 *   restart – installed and will activate on the next boot, but not live now
 *   inert   – installed but not a profile-layer plugin (plain dependency, or
 *             client-only — the market shim-mounts those at boot)
 *   broken  – would fail to load: listed as a bundle without a dsh surface,
 *             or a declared entry artifact that is missing
 *   missing – not present in node_modules
 */
export type ActivationState = 'live' | 'restart' | 'inert' | 'broken' | 'missing' | 'disabled';
export interface ActivationResult {
    state: ActivationState;
    /** Bilingual, user-facing explanations (zh / en joined with " / "). */
    reasons: string[];
    /** True when the package is in the profile's `dsh.profile.bundles`. */
    bundle: boolean;
    /** True when the package is live in the running composition. */
    hot: boolean;
}
/**
 * Verify the activation state of one installed package.
 * @param live - names live in the current composition; defaults to the
 * market's hot-mount table (injectable for tests).
 */
export declare function verifyActivation(profile: string, name: string, live?: ReadonlySet<string>, explicitDir?: string, isDisabled?: boolean): ActivationResult;
/**
 * Correct a post-UPDATE verdict for a plugin that was already running.
 *
 * `verifyActivation` answers "is this name in the live loader inventory".
 * That is the right question after an install and the wrong one after an
 * update: the plugin was already live, so the answer stays "live" while the
 * process keeps serving the module it imported at boot. Replacing files under
 * a running composition does not re-import anything.
 *
 * Measured on a real host rather than reasoned about — updating the market
 * from 1.11.3 to 1.12.2 left `/dsh-market/status` reporting 1.11.3 with an
 * unchanged boot id, while the update route called it hot-loaded in the same
 * response. The browser half genuinely does refresh (the host re-serves the
 * client bundle from disk), which is what makes the wrong verdict credible:
 * the UI visibly becomes the new version while the server half does not.
 *
 * Only a plugin that was ALREADY live is affected. One that was missing,
 * broken or disabled beforehand has nothing loaded to shadow the new build,
 * so its fresh mount really does run the new code.
 *
 * Client-only packages are excluded for the same reason from the other end:
 * they have no host half to go stale, and the browser fetches their bundle
 * from disk on the next page load. Telling their users to restart would be
 * #156 again, in a narrower place — see `hasHostHalf`.
 * @param result the verdict computed from the loader inventory
 * @param hostHalfWasLive whether a HOST half was live BEFORE the replacement
 */
export declare function activationAfterReplace(result: ActivationResult, hostHalfWasLive: boolean): ActivationResult;
/**
 * Whether a package has a host (Node) half at all.
 *
 * A `dsh.client`-only package — themes, skins, most pure-UI plugins — runs
 * no server code: the market shim-mounts it so the loader has a live row,
 * and the browser re-fetches its bundle from disk on the next page load. An
 * update to one takes effect on refresh, with no restart to ask for.
 */
export declare function hasHostHalf(profile: string, name: string, explicitDir?: string): boolean;
/**
 * The client bundle path a package's `exports["./client"]` names, relative
 * to the package root — or `null` when it cannot be resolved CONFIDENTLY.
 *
 * Returning null is the important half. This feeds a post-install check
 * whose only job is to catch a corrupt bundle, and a resolver that guessed
 * wrong would report a healthy plugin as broken — worse than the silence it
 * replaces. So every shape this does not fully understand resolves to null
 * and the check simply does not run: unresolvable is not evidence of damage.
 *
 * Handles the two shapes real plugins ship: a plain string, and a
 * conditional object. For the object, only `browser` and `default` are
 * consulted — those are the conditions the host's client loader actually
 * activates; `import`/`require` describe a Node resolution this file is not
 * modelling, and picking one of those could name a different artifact.
 * Nested conditions recurse; anything else (arrays, non-relative targets)
 * gives up.
 */
export declare function clientBundlePath(exportsField: unknown, depth?: number): string | null;
/** What a bundle check concluded. `ok` covers "fine" AND "could not tell". */
export interface BundleCheck {
    ok: boolean;
    /** Populated only when the file was found AND failed to parse. */
    reason: string | null;
}
/**
 * Whether a package's client bundle still parses as JavaScript (#222).
 *
 * pnpm can leave a half-written or patch-mangled bundle behind — the report
 * describes a profile whose client bundle was broken after an update. The
 * browser is where that surfaces today, as a blank settings page long after
 * the operation reported success, with nothing connecting the two.
 *
 * `vm.Script` COMPILES without executing: it catches the syntax damage this
 * is looking for and never runs plugin code, so a hostile bundle gains
 * nothing. A missing `dsh.client`, an unresolvable exports field, or a file
 * that is simply absent all return ok — this check only ever fires on a file
 * it actually read and actually failed to parse. Everything ambiguous stays
 * silent, because a false "your plugin is corrupt" is the one outcome worse
 * than not checking.
 */
export declare function checkClientBundle(profile: string, name: string, explicitDir?: string): BundleCheck;
