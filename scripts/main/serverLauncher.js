// serverLauncher.js
// Launch the backend inference servers (ComfyUI / A1111-WebUI) as managed child
// processes so the app can start them itself — WITHOUT opening any browser page.
// The app never auto-opens a webpage; it just starts the server executable so the
// API is reachable. Processes started here are tracked and killed on app quit.
import { ipcMain } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const CAT = '[ServerLauncher]';
const isWin = process.platform === 'win32';

// id -> { child, pid, command }
const procs = new Map();
// id -> the address we launched/reused it on, so we can also kill by port on
// quit (covers reused/orphaned servers this app didn't spawn but is using).
const backendAddrs = {};

function portOf(addr) {
    const m = String(addr || '').match(/:(\d{2,5})(?:\/|$)/);
    return m ? m[1] : null;
}

// Kill whatever process is LISTENING on a TCP port (and its child tree). Used on
// shutdown so a reused/orphaned server — one the app adopted rather than spawned
// — is also taken down. Synchronous so it finishes before the app exits.
function killByPort(port) {
    if (!port) return;
    try {
        if (isWin) {
            const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true }).stdout || '';
            const pids = new Set();
            for (const line of out.split('\n')) {
                const c = line.trim().split(/\s+/);
                // proto local foreign state pid
                if (c.length >= 5 && /LISTENING/i.test(c[3]) && c[1].endsWith(':' + port)) {
                    if (/^\d+$/.test(c[4]) && c[4] !== '0') pids.add(c[4]);
                }
            }
            for (const pid of pids) {
                spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { windowsHide: true });
            }
        } else {
            const out = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' }).stdout || '';
            for (const pid of out.split('\n').map(s => s.trim()).filter(Boolean)) {
                try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ }
            }
        }
    } catch (err) {
        console.error(CAT, `killByPort ${port} failed:`, err.message);
    }
}

function isAlive(id) {
    const p = procs.get(id);
    return !!(p && p.child && p.child.exitCode === null && !p.child.killed);
}

// Normalise "127.0.0.1:8000" / "http://host:port" -> a full URL for a probe path.
function probeUrl(addr, probePath = '/') {
    let base = String(addr || '').trim();
    if (!base) return null;
    if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
    base = base.replace(/\/+$/, '');
    return base + probePath;
}

// A single connectivity probe. Resolves true once the server answers with ANY
// HTTP status (even 401/404) — that means the port is up and serving, which is
// all we need to call the backend "ready".
function probeOnce(url, timeoutMs = 4000) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        try {
            const req = http.get(url, (res) => {
                res.resume();           // drain
                finish(true);
            });
            req.setTimeout(timeoutMs, () => { req.destroy(); finish(false); });
            req.on('error', () => finish(false));
        } catch {
            finish(false);
        }
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll the backend until it answers or we time out / the process dies.
async function waitForReady(id, addr, probePath, { timeoutMs = 180000, intervalMs = 2000 } = {}) {
    const url = probeUrl(addr, probePath);
    if (!url) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (id && !isAlive(id)) return false;   // process exited before serving
        if (await probeOnce(url, Math.min(4000, intervalMs))) return true;
        await sleep(intervalMs);
    }
    return false;
}

// Split a user-typed extra-args string into argv, respecting simple quotes.
function parseArgs(str) {
    if (!str || typeof str !== 'string') return [];
    const out = str.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    return out.map((a) => a.replace(/^["']|["']$/g, ''));
}

// Spawn the server. command = full path to the user's launch script/executable
// (e.g. run_nvidia_gpu.bat or webui-user.bat). We run it from its own folder so
// relative paths inside the script resolve. On Windows a .bat must go through
// cmd.exe; elsewhere we start a detached process group so we can kill the tree.
function launch(id, { command, cwd, args = [] } = {}) {
    if (!command || typeof command !== 'string') {
        return { ok: false, error: 'No launch path configured' };
    }
    if (isAlive(id)) {
        return { ok: true, already: true, pid: procs.get(id).pid };
    }
    const resolvedCwd = cwd || path.dirname(command);
    let child;
    try {
        if (isWin) {
            child = spawn('cmd.exe', ['/c', command, ...args],
                { cwd: resolvedCwd, windowsHide: true, detached: false });
        } else {
            child = spawn(command, args,
                { cwd: resolvedCwd, detached: true });
        }
    } catch (err) {
        console.error(CAT, `launch ${id} failed:`, err.message);
        return { ok: false, error: err.message };
    }

    child.stdout?.on('data', (d) => console.log(`[${id}]`, String(d).trimEnd()));
    child.stderr?.on('data', (d) => console.warn(`[${id}]`, String(d).trimEnd()));
    child.on('exit', (code, signal) => {
        console.log(CAT, `${id} exited (code=${code}, signal=${signal})`);
        const cur = procs.get(id);
        if (cur && cur.child === child) procs.delete(id);
    });
    child.on('error', (err) => console.error(CAT, `${id} error:`, err.message));

    procs.set(id, { child, pid: child.pid, command });
    console.log(CAT, `started ${id} (pid ${child.pid}): ${command}`);
    return { ok: true, pid: child.pid };
}

// Kill the server and its whole child tree (the .bat spawns python, etc.).
function stop(id) {
    const p = procs.get(id);
    if (!p) return { ok: true, notRunning: true };
    try {
        if (isWin) {
            // Synchronous so the whole tree (cmd -> .bat -> python) is dead
            // BEFORE the app exits — an async spawn can be abandoned when
            // Electron quits, leaving the servers (and their consoles) running.
            spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
        } else {
            try { process.kill(-p.pid, 'SIGKILL'); }
            catch { try { p.child.kill('SIGKILL'); } catch { /* already gone */ } }
        }
    } catch (err) {
        console.error(CAT, `stop ${id} failed:`, err.message);
        return { ok: false, error: err.message };
    }
    procs.delete(id);
    console.log(CAT, `stopped ${id}`);
    return { ok: true };
}

export function stopAllServers() {
    // Kill processes this app spawned (whole cmd -> bat -> python tree)...
    for (const id of [...procs.keys()]) stop(id);
    // ...and anything still listening on the backend ports we used this session
    // (reused/orphaned instances the app adopted rather than spawned).
    for (const addr of Object.values(backendAddrs)) killByPort(portOf(addr));
}

function status(id) {
    return { running: isAlive(id), pid: isAlive(id) ? procs.get(id).pid : null };
}

// id -> which settings drive its address + readiness probe path.
const BACKENDS = {
    comfyui: { addrKey: 'video_comfy_addr', probe: '/system_stats' },
    webui: { addrKey: 'api_addr', probe: '/' },
};

// Start a backend from a launch request (used by both the manual buttons and the
// auto-start path). Spawns, then waits until the API answers.
async function startBackend(id, opts = {}) {
    const meta = BACKENDS[id] || { probe: '/' };
    const addr = opts.addr;
    const probePath = opts.probe || meta.probe;
    if (addr) backendAddrs[id] = addr;   // remember for kill-by-port on quit

    // If a server is ALREADY answering on this address (a leftover instance from
    // a previous session, ComfyUI Desktop, or a manual launch), don't spawn a
    // duplicate — that just crashes with "port already in use". Use the existing
    // one instead.
    if (!isAlive(id) && addr && await probeOnce(probeUrl(addr, probePath), 2500)) {
        console.log(CAT, `${id} already serving on ${addr} — reusing, not launching a duplicate`);
        return { ok: true, ready: true, already: 'external', pid: null };
    }

    const res = launch(id, opts);
    if (!res.ok) return { ...res, ready: false };
    if (!addr) return { ...res, ready: false, note: 'no address to probe' };
    const ready = await waitForReady(id, addr, probePath,
        { timeoutMs: opts.timeoutMs || 180000 });
    return { ...res, ready };
}

// Lightweight readiness check for the status indicator: is the API answering?
// `ready` reflects actual reachability (green = usable now), independent of
// whether THIS app launched the process — so a server you started by hand still
// shows ready. `running` means this app owns the process.
async function probeBackend(id, addr) {
    const meta = BACKENDS[id] || { probe: '/' };
    const url = probeUrl(addr, meta.probe);
    const ready = url ? await probeOnce(url, 3000) : false;
    return { running: isAlive(id), ready };
}

export function setupServerLauncher() {
    ipcMain.handle('server-launch', async (event, id, opts) => startBackend(id, opts || {}));
    ipcMain.handle('server-stop', async (event, id) => stop(id));
    ipcMain.handle('server-status', async (event, id) => status(id));
    ipcMain.handle('server-probe', async (event, id, addr) => probeBackend(id, addr));
}

// Auto-start whichever backends the user enabled, reading paths/args straight
// from the persisted settings. Fire-and-forget — failures are logged, not fatal.
export function autoStartServers(SETTINGS) {
    if (!SETTINGS) return;
    if (SETTINGS.comfy_exe_autostart && SETTINGS.comfy_exe_path) {
        startBackend('comfyui', {
            command: SETTINGS.comfy_exe_path,
            args: parseArgs(SETTINGS.comfy_exe_args),
            addr: SETTINGS.video_comfy_addr,
        }).then((r) => console.log(CAT, 'auto-start comfyui:', JSON.stringify(r)))
          .catch((e) => console.error(CAT, 'auto-start comfyui failed:', e.message));
    }
    if (SETTINGS.webui_exe_autostart && SETTINGS.webui_exe_path) {
        startBackend('webui', {
            command: SETTINGS.webui_exe_path,
            args: parseArgs(SETTINGS.webui_exe_args),
            addr: SETTINGS.api_addr,
        }).then((r) => console.log(CAT, 'auto-start webui:', JSON.stringify(r)))
          .catch((e) => console.error(CAT, 'auto-start webui failed:', e.message));
    }
}
