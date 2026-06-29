import { app, ipcMain } from 'electron';
import * as fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { getGlobalSettings } from './globalSettings.js';

const CAT = '[comfyVideo]';
const appPath = app.isPackaged ? path.join(path.dirname(app.getPath('exe')), 'resources', 'app') : app.getAppPath();
const WF_DIR = path.join(appPath, 'data', 'video_workflows');
const SCENES_PATH = path.join(appPath, 'data', 'video_scenes.json');

function comfyBase(addr) {
    return /^https?:\/\//i.test(addr) ? addr.replace(/\/$/, '') : `http://${addr}`;
}

function saveScenes(scenes) {
    try {
        fs.writeFileSync(SCENES_PATH, JSON.stringify(scenes, null, 4), 'utf8');
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// ---- Workflow templates (API-format ComfyUI graphs) -------------------------
function ensureDir() {
    try { fs.mkdirSync(WF_DIR, { recursive: true }); } catch { /* ignore */ }
}

function listWorkflows() {
    ensureDir();
    try {
        return fs.readdirSync(WF_DIR)
            .filter(f => f.toLowerCase().endsWith('.json'))
            .map(f => f.replace(/\.json$/i, ''));
    } catch {
        return [];
    }
}

function loadWorkflowGraph(name) {
    const p = path.join(WF_DIR, `${name}.json`);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function saveWorkflow(name, graph) {
    ensureDir();
    const safe = String(name || 'workflow').replaceAll(/[\\/:*?"<>|]/g, '_');
    const p = path.join(WF_DIR, `${safe}.json`);
    fs.writeFileSync(p, JSON.stringify(graph, null, 2), 'utf8');
    return safe;
}

// ---- ComfyUI API ------------------------------------------------------------
async function uploadImage(addr, dataUrl) {
    const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUrl || '');
    if (!m) throw new Error('invalid image data');
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    const fd = new FormData();
    fd.append('image', new Blob([buf], { type: `image/${m[1]}` }), `saa_input.${ext}`);
    fd.append('overwrite', 'true');
    const resp = await fetch(`${comfyBase(addr)}/upload/image`, { method: 'POST', body: fd });
    if (!resp.ok) {
        const hint = resp.status === 404
            ? ' — this address is not ComfyUI (A1111 has no /upload/image). Set the ComfyUI address (default 127.0.0.1:8188).'
            : '';
        throw new Error(`upload HTTP ${resp.status}${hint}`);
    }
    const j = await resp.json();
    return { name: j.name, subfolder: j.subfolder || '', type: j.type || 'input' };
}

// Auto-map a WAN-style API graph using the WanImageToVideo node as the anchor.
// This works with a user's own exported workflow without manual node mapping.
function patchGraph(graphIn, params, uploadedName) {
    const g = JSON.parse(JSON.stringify(graphIn));
    const entries = Object.entries(g);
    const typeIncludes = (n, s) => String(n.class_type || '').toLowerCase().includes(s);
    const setIn = (node, field, val) => { if (node && node.inputs && field in node.inputs) node.inputs[field] = val; };

    // Feed the uploaded image into every LoadImage node.
    for (const [, n] of entries) {
        if (typeIncludes(n, 'loadimage')) setIn(n, 'image', uploadedName);
    }

    // The image-to-video anchor (WanImageToVideo, or a WanVideo wrapper node).
    const anchorEntry = entries.find(([, n]) => typeIncludes(n, 'imagetovideo'))
        || entries.find(([, n]) => typeIncludes(n, 'wanvideo') && n.inputs && ('length' in n.inputs || 'num_frames' in n.inputs));
    if (anchorEntry) {
        const node = anchorEntry[1];
        if (params.width) setIn(node, 'width', Number(params.width));
        if (params.height) setIn(node, 'height', Number(params.height));
        if (params.length !== undefined) { setIn(node, 'length', Number(params.length)); setIn(node, 'num_frames', Number(params.length)); }
        if (params.batch_size) setIn(node, 'batch_size', Number(params.batch_size));

        // Trace the positive/negative conditioning back to their CLIPTextEncode nodes.
        const posRef = node.inputs?.positive?.[0];
        const negRef = node.inputs?.negative?.[0];
        if (posRef && g[posRef]?.inputs && 'text' in g[posRef].inputs && params.prompt !== undefined) g[posRef].inputs.text = params.prompt;
        if (negRef && g[negRef]?.inputs && 'text' in g[negRef].inputs && params.negative !== undefined) g[negRef].inputs.text = params.negative;
    }

    // Model / clip / vae / speed-LoRA loaders — let the user point the template
    // at their downloaded files without editing JSON.
    for (const [, n] of entries) {
        if (!n.inputs) continue;
        const ct = String(n.class_type || '').toLowerCase();
        if (params.modelName && (ct.includes('unetloader') || ct.includes('checkpointloader'))) {
            if ('unet_name' in n.inputs) n.inputs.unet_name = params.modelName;
            if ('ckpt_name' in n.inputs) n.inputs.ckpt_name = params.modelName;
        }
        // CLIPLoader (text encoder) but NOT CLIPVisionLoader.
        if (params.clipName && ct.includes('cliploader') && !ct.includes('vision')) {
            if ('clip_name' in n.inputs) n.inputs.clip_name = params.clipName;
        }
        if (params.vaeName && ct.includes('vaeloader')) {
            if ('vae_name' in n.inputs) n.inputs.vae_name = params.vaeName;
        }
        if (params.loraName && ct.includes('lora')) {
            if ('lora_name' in n.inputs) n.inputs.lora_name = params.loraName;
        }
    }

    // Samplers (WAN 2.2 may have two) and video output nodes.
    for (const [, n] of entries) {
        const ct = String(n.class_type || '').toLowerCase();
        if (ct.includes('ksampler') && n.inputs) {
            if (params.seed !== undefined && 'seed' in n.inputs) n.inputs.seed = Number(params.seed);
            if (params.seed !== undefined && 'noise_seed' in n.inputs) n.inputs.noise_seed = Number(params.seed);
            if (params.steps !== undefined && 'steps' in n.inputs) n.inputs.steps = Number(params.steps);
            if (params.cfg !== undefined && 'cfg' in n.inputs) n.inputs.cfg = Number(params.cfg);
        }
        if (n.inputs && (ct.includes('videocombine') || ct.includes('saveanimated') || ct.includes('savevideo') || ct.includes('savewebm') || ct.includes('createvideo'))) {
            if (params.fps !== undefined && 'fps' in n.inputs) n.inputs.fps = Number(params.fps);
            if (params.fps !== undefined && 'frame_rate' in n.inputs) n.inputs.frame_rate = Number(params.fps);
        }
    }
    return g;
}

async function submit(addr, graph, clientId) {
    const resp = await fetch(`${comfyBase(addr)}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: clientId })
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`submit HTTP ${resp.status} ${t.slice(0, 400)}`);
    }
    const j = await resp.json();
    if (!j.prompt_id) {
        throw new Error('workflow rejected: ' + JSON.stringify(j.error || j.node_errors || j).slice(0, 400));
    }
    return j.prompt_id;
}

function findVideoOutput(history, promptId) {
    const outs = history?.[promptId]?.outputs || {};
    for (const id of Object.keys(outs)) {
        const o = outs[id];
        const arr = o.gifs || o.videos || o.images;
        if (arr && arr.length) return arr[0];
    }
    return null;
}

async function pollResult(addr, promptId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const resp = await fetch(`${comfyBase(addr)}/history/${promptId}`).catch(() => null);
        if (resp && resp.ok) {
            const hist = await resp.json().catch(() => null);
            const out = hist && findVideoOutput(hist, promptId);
            if (out) return out;
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error('timed out waiting for the video');
}

async function fetchView(addr, out) {
    const q = `filename=${encodeURIComponent(out.filename)}&subfolder=${encodeURIComponent(out.subfolder || '')}&type=${encodeURIComponent(out.type || 'output')}`;
    const resp = await fetch(`${comfyBase(addr)}/view?${q}`);
    if (!resp.ok) throw new Error(`view HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
}

function saveVideo(buf, filename) {
    try {
        const S = getGlobalSettings();
        const baseDir = (S.auto_save_dir && String(S.auto_save_dir).trim())
            ? String(S.auto_save_dir).trim()
            : path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(), 'outputs');
        const dir = path.join(baseDir, 'video');
        fs.mkdirSync(dir, { recursive: true });
        const out = path.join(dir, `saa_${Date.now()}_${path.basename(filename)}`);
        fs.writeFileSync(out, buf);
        return out;
    } catch (err) {
        console.warn(CAT, 'save failed:', err.message);
        return null;
    }
}

// Listen to ComfyUI's websocket for sampling progress and forward it.
function openProgressWs(addr, clientId, onProgress) {
    try {
        const wsUrl = `${comfyBase(addr).replace(/^http/i, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`;
        const ws = new WebSocket(wsUrl);
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'progress' && msg.data) {
                    onProgress?.({ value: msg.data.value, max: msg.data.max });
                } else if (msg.type === 'executing' && msg.data && 'node' in msg.data) {
                    onProgress?.({ node: msg.data.node });
                }
            } catch { /* ignore */ }
        });
        ws.on('error', () => { /* progress is best-effort */ });
        return ws;
    } catch {
        return null;
    }
}

async function runVideo(params, onProgress) {
    let ws = null;
    try {
        const S = getGlobalSettings();
        const addr = params.addr || S.api_addr;
        if (!addr) return { ok: false, error: 'no ComfyUI address' };
        const graph = params.graph || loadWorkflowGraph(params.workflow);
        if (!graph) return { ok: false, error: 'workflow not found — import your WAN API JSON first' };
        if (!params.image) return { ok: false, error: 'no input image' };

        const clientId = params.clientId || 'saa-video';
        ws = openProgressWs(addr, clientId, onProgress);

        const uploaded = await uploadImage(addr, params.image);
        const patched = patchGraph(graph, params, uploaded.name);
        const promptId = await submit(addr, patched, clientId);
        const out = await pollResult(addr, promptId, params.timeoutMs || 1000 * 60 * 20);
        const buf = await fetchView(addr, out);

        const ext = (out.filename.split('.').pop() || 'mp4').toLowerCase();
        const mime = ext === 'webp' ? 'image/webp'
            : ext === 'gif' ? 'image/gif'
                : ext === 'webm' ? 'video/webm'
                    : 'video/mp4';
        const savedPath = saveVideo(buf, out.filename);
        return {
            ok: true,
            isImageFormat: mime.startsWith('image/'),
            mime,
            filename: out.filename,
            path: savedPath,
            dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
            promptId
        };
    } catch (err) {
        console.error(CAT, err.message);
        return { ok: false, error: err.message };
    } finally {
        try { if (ws) ws.close(); } catch { /* ignore */ }
    }
}

// Ask ComfyUI which model files it has, so the UI can offer dropdowns instead
// of free-text filenames (avoids "value not in list" errors).
async function objInfoRequired(addr, node) {
    try {
        const resp = await fetch(`${comfyBase(addr)}/object_info/${node}`);
        if (!resp.ok) return null;
        const j = await resp.json();
        const def = j?.[node]?.input;
        return def ? { ...(def.required || {}), ...(def.optional || {}) } : null;
    } catch {
        return null;
    }
}
function firstChoiceList(req, field) {
    const v = req?.[field];
    return (Array.isArray(v) && Array.isArray(v[0])) ? v[0].filter(x => typeof x === 'string') : [];
}
async function getComfyModels(addr) {
    if (!addr) return { ok: false, error: 'no address' };
    try {
        const [unet, gguf, ckpt, clip, vae, lora] = await Promise.all([
            objInfoRequired(addr, 'UNETLoader'),
            objInfoRequired(addr, 'UnetLoaderGGUF'),
            objInfoRequired(addr, 'CheckpointLoaderSimple'),
            objInfoRequired(addr, 'CLIPLoader'),
            objInfoRequired(addr, 'VAELoader'),
            objInfoRequired(addr, 'LoraLoaderModelOnly')
        ]);
        const uniq = (a) => [...new Set(a)].sort((x, y) => x.localeCompare(y));
        return {
            ok: true,
            unet: uniq([...firstChoiceList(unet, 'unet_name'), ...firstChoiceList(gguf, 'unet_name'), ...firstChoiceList(ckpt, 'ckpt_name')]),
            clip: uniq(firstChoiceList(clip, 'clip_name')),
            vae: uniq(firstChoiceList(vae, 'vae_name')),
            lora: uniq(firstChoiceList(lora, 'lora_name'))
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// Stream-download a model file into ComfyUI's models folder, reporting progress.
async function downloadModel(params, onProgress) {
    try {
        const { url, modelsDir, subdir } = params;
        if (!url) return { ok: false, error: 'no url' };
        if (!modelsDir) return { ok: false, error: 'set the ComfyUI models folder first' };
        const dir = path.join(modelsDir, subdir || '');
        fs.mkdirSync(dir, { recursive: true });
        const name = params.filename
            || decodeURIComponent((url.split('?')[0].split('/').pop() || 'model.safetensors'));
        const dest = path.join(dir, name);
        if (fs.existsSync(dest)) return { ok: true, already: true, path: dest, name };

        const resp = await fetch(url, { redirect: 'follow' });
        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
        const total = Number(resp.headers.get('content-length') || 0);
        const tmp = dest + '.part';
        const ws = fs.createWriteStream(tmp);
        let received = 0;
        const reader = resp.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            ws.write(Buffer.from(value));
            received += value.length;
            onProgress?.({ received, total, name });
        }
        await new Promise((res, rej) => { ws.end(); ws.on('finish', res); ws.on('error', rej); });
        fs.renameSync(tmp, dest);
        return { ok: true, path: dest, name };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

function loadCatalog() {
    try {
        return JSON.parse(fs.readFileSync(path.join(appPath, 'data', 'video_models_catalog.json'), 'utf8'));
    } catch {
        return [];
    }
}

// Quick reachability check: confirm something answers and that it's ComfyUI.
async function pingComfy(addr) {
    try {
        if (!addr) return { ok: false, error: 'no address' };
        const resp = await fetch(`${comfyBase(addr)}/system_stats`, { method: 'GET' });
        if (!resp.ok) return { ok: false, status: resp.status, isComfy: false };
        const j = await resp.json().catch(() => null);
        const isComfy = !!(j && (j.system || j.devices));
        return { ok: true, status: resp.status, isComfy };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

export function setupComfyVideo() {
    ipcMain.handle('comfy-video-ping', async (event, addr) => pingComfy(addr));
    ipcMain.handle('comfy-video-models', async (event, addr) => getComfyModels(addr));
    ipcMain.handle('comfy-video-catalog', async () => loadCatalog());
    ipcMain.handle('comfy-video-download-model', async (event, params) =>
        downloadModel(params, (p) => { try { event.sender.send('comfy-video-dl-progress', p); } catch { /* ignore */ } }));
    ipcMain.handle('comfy-video-list', async () => listWorkflows());
    ipcMain.handle('comfy-video-get', async (event, name) => loadWorkflowGraph(name));
    ipcMain.handle('comfy-video-save', async (event, name, graph) => saveWorkflow(name, graph));
    ipcMain.handle('comfy-video-save-scenes', async (event, scenes) => saveScenes(scenes));
    ipcMain.handle('comfy-video-run', async (event, params) =>
        runVideo(params, (p) => { try { event.sender.send('comfy-video-progress', p); } catch { /* ignore */ } }));
}

export { listWorkflows, loadWorkflowGraph, saveWorkflow, saveScenes, runVideo };
