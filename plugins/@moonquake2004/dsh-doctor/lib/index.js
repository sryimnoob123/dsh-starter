/**
 * dsh-doctor host entry: mounts the diagnostic HTTP route once the profile
 * composes the webServer service.
 *
 * The checks themselves are intentionally offline/filesystem-based (the whole
 * point: they run when dsh can or can't boot), so the route shells out to the
 * bundled `dsh-doctor.mjs --json` — same single source of truth as the CLI.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-doctor';

const SCRIPT = fileURLToPath(new URL('../dsh-doctor.mjs', import.meta.url));
const RUN_TIMEOUT_MS = 120000;

/**
 * Register the diagnostic route against the host context.
 * @param ctx - Host context that may acquire the webServer service.
 * @param config - Optional profile override from the loader.
 */
export function apply(ctx, config) {
    const resolved = { profile: config?.profile ?? 'web' };
    ctx.inject(['webServer'], (hostCtx) => {
        const host = hostCtx;
        host.effect(() => mountDoctorRoutes(host, resolved), 'dsh-doctor: http routes');
    });
}

/**
 * Run the bundled CLI and return its JSON result.
 * @param profile - profile name to check.
 * @param sessionPath - optional session log path.
 * @returns parsed { checks, ok } or a structured error.
 */
function runChecks(profile, sessionPath) {
    return new Promise((resolvePromise) => {
        const args = ['--json', '--security'];
        if (profile) args.push('--profile', profile);
        if (sessionPath) args.push('--session', sessionPath);
        const child = spawn(process.execPath, [SCRIPT, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, CI: 'true' },
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            resolvePromise({ checks: [], ok: false, error: `dsh-doctor timed out after ${RUN_TIMEOUT_MS / 1000}s` });
        }, RUN_TIMEOUT_MS);
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (error) => {
            clearTimeout(timer);
            resolvePromise({ checks: [], ok: false, error: `failed to spawn dsh-doctor: ${error.message}` });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            try {
                const data = JSON.parse(stdout);
                resolvePromise(data);
            } catch {
                resolvePromise({ checks: [], ok: false, error: `dsh-doctor output unparsable (exit ${code}): ${stderr.slice(0, 300) || stdout.slice(0, 300)}` });
            }
        });
    });
}

/** Register the diagnostic HTTP routes. */
function mountDoctorRoutes(host, config) {
    const disposers = [
        host.webServer.register({
            kind: 'exact',
            path: '/dsh-doctor/run',
            handler: async (request, response) => {
                if (request.method !== 'GET') {
                    response.writeHead(405, { allow: 'GET' });
                    response.end();
                    return;
                }
                const url = new URL(request.url ?? '/dsh-doctor/run', 'http://localhost');
                // 默认跑全部检查；只有显式传 ?profile= 或 ?session= 时才收窄范围
                const profile = url.searchParams.get('profile');
                const sessionPath = url.searchParams.get('session');
                const result = await runChecks(profile, sessionPath);
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify({ ...result, profile, checkedAt: new Date().toISOString() }));
            },
        }),
    ];
    return () => {
        for (const dispose of disposers) dispose();
    };
}
