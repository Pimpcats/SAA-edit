import { app, ipcMain } from 'electron';
import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getGlobalSettings } from './globalSettings.js';
import { getLoraBaseDirs } from './modelList.js';

const CAT = '[civitai]';
const appPath = app.isPackaged ? path.join(path.dirname(app.getPath('exe')), 'resources', 'app') : app.getAppPath();
const CACHE_PATH = path.join(appPath, 'settings', 'civitai_hash_cache.json');

let hashCache = null;

function loadHashCache() {
    if (hashCache) return hashCache;
    try {
        hashCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch {
        hashCache = {};
    }
    return hashCache;
}

function saveHashCache() {
    try {
        fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
        fs.writeFileSync(CACHE_PATH, JSON.stringify(hashCache, null, 2), 'utf8');
    } catch (err) {
        console.error(CAT, 'Failed to save hash cache:', err.message);
    }
}

// Candidate directories that hold LoRA files (uses the same resolution as the
// LoRA list, so custom paths are honoured).
function loraDirs() {
    const S = getGlobalSettings();
    const dirs = [];
    // Explicit override first: point this straight at your LoRA folder when the
    // model-path guesswork doesn't match where the files actually live.
    if (S.lora_library_dir && String(S.lora_library_dir).trim()) {
        dirs.push(String(S.lora_library_dir).trim());
    }
    dirs.push(...getLoraBaseDirs(S.model_path_comfyui, S.model_path_webui));
    // Extra fallbacks just in case.
    if (S.model_path_webui) {
        dirs.push(path.join(path.dirname(S.model_path_webui), 'Lora'));
        dirs.push(path.join(path.dirname(S.model_path_webui), 'models', 'Lora'));
    }
    if (S.model_path_comfyui) {
        dirs.push(path.join(path.dirname(S.model_path_comfyui), 'loras'));
    }
    return [...new Set(dirs)];
}

// Diagnostic: report exactly how a LoRA name resolves to a file + thumbnail, so
// the UI can explain why a thumbnail isn't showing.
function debugLoraThumb(loraName) {
    const dirs = loraDirs();
    const filePath = resolveLoraPath(loraName);
    const out = {
        loraName,
        dirsSearched: dirs.map(d => ({ dir: d, exists: (() => { try { return fs.existsSync(d); } catch { return false; } })() })),
        resolvedFile: filePath,
        thumbPath: null,
        thumbCandidates: []
    };
    if (filePath) {
        const dir = path.dirname(filePath);
        const base = path.basename(filePath).replace(/\.safetensors$/i, '');
        for (const c of [`${base}.png`, `${base}.preview.png`, `${base}.jpg`, `${base}.preview.jpg`, `${base}.jpeg`, `${base}.webp`, `${base}.preview.webp`]) {
            out.thumbCandidates.push({ name: c, exists: fs.existsSync(path.join(dir, c)) });
        }
        out.thumbPath = findLoraThumbPath(filePath);
    }
    return out;
}

function deepFind(dir, baseLower) {
    if (!fs.existsSync(dir)) return null;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            const r = deepFind(full, baseLower);
            if (r) return r;
        } else if (e.isFile() && e.name.toLowerCase() === `${baseLower}.safetensors`) {
            return full;
        }
    }
    return null;
}

function resolveLoraPath(loraName) {
    const dirs = loraDirs();
    const names = [loraName, `${loraName}.safetensors`];
    for (const dir of dirs) {
        for (const n of names) {
            const c = path.join(dir, n);
            if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
        }
    }
    const baseLower = path.basename(loraName).replace(/\.safetensors$/i, '').toLowerCase();
    for (const dir of dirs) {
        const found = deepFind(dir, baseLower);
        if (found) return found;
    }
    return null;
}

function hashFile(filePath) {
    const cache = loadHashCache();
    const stat = fs.statSync(filePath);
    const sig = `${stat.size}:${stat.mtimeMs}`;
    if (cache[filePath] && cache[filePath].sig === sig) {
        return cache[filePath].hash;
    }
    const buf = fs.readFileSync(filePath);
    const digest = crypto.createHash('sha256').update(buf).digest('hex');
    cache[filePath] = { sig, hash: digest };
    saveHashCache();
    return digest;
}

// ---- Local LoRA thumbnails (same-named image next to the .safetensors) ----
function findLoraThumbPath(loraFilePath) {
    const dir = path.dirname(loraFilePath);
    const base = path.basename(loraFilePath).replace(/\.safetensors$/i, '');
    // Fast path: the common exact conventions (<base>.png, civitai-helper
    // <base>.preview.png, plus jpg/jpeg/webp).
    const candidates = [
        `${base}.png`, `${base}.preview.png`,
        `${base}.jpg`, `${base}.preview.jpg`,
        `${base}.jpeg`, `${base}.preview.jpeg`,
        `${base}.webp`, `${base}.preview.webp`
    ];
    for (const c of candidates) {
        const p = path.join(dir, c);
        if (fs.existsSync(p)) return p;
    }
    // Tolerant fallback: scan the folder for any image whose name relates to the
    // LoRA's base (handles _preview/.1/version suffixes, prefixes, case, etc.).
    try {
        const imgExt = /\.(png|jpe?g|webp|gif)$/i;
        const baseLower = base.toLowerCase();
        const stems = fs.readdirSync(dir)
            .filter(f => imgExt.test(f))
            .map(f => ({ file: f, stem: f.replace(imgExt, '').toLowerCase() }));
        let hit = stems.find(s => s.stem === baseLower)
            || stems.find(s => s.stem === `${baseLower}.preview` || s.stem === `${baseLower}_preview`)
            || stems.find(s => s.stem.startsWith(`${baseLower}.`) || s.stem.startsWith(`${baseLower}_`) || s.stem.startsWith(`${baseLower}-`))
            || stems.find(s => s.stem.startsWith(baseLower))
            || stems.find(s => s.stem.endsWith(baseLower));
        if (hit) return path.join(dir, hit.file);
    } catch { /* ignore */ }
    return null;
}

function imageFileToDataUrl(p) {
    let ext = path.extname(p).toLowerCase().replace('.', '');
    if (ext === 'jpg') ext = 'jpeg';
    if (!['png', 'jpeg', 'webp', 'gif'].includes(ext)) ext = 'png';
    return `data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}`;
}

// Return the local same-named thumbnail for a LoRA (no network).
function getLoraThumb(loraName) {
    try {
        const filePath = resolveLoraPath(loraName);
        if (!filePath) return { ok: false, error: 'file-not-found' };
        const thumbPath = findLoraThumbPath(filePath);
        if (!thumbPath) return { ok: true, found: false };
        return { ok: true, found: true, thumb: imageFileToDataUrl(thumbPath), path: thumbPath };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// If no local thumbnail exists, fetch the LoRA's first civitai image and save it
// next to the .safetensors (as <base>.png/.jpg/...) so it becomes the cached
// local thumbnail. Returns the data URL.
async function downloadLoraThumb(loraName, apiKey) {
    try {
        const filePath = resolveLoraPath(loraName);
        if (!filePath) return { ok: false, error: 'file-not-found' };
        const existing = findLoraThumbPath(filePath);
        if (existing) return { ok: true, found: true, source: 'local', thumb: imageFileToDataUrl(existing), path: existing };

        const hash = hashFile(filePath);
        const res = await lookupByHash(hash, apiKey);
        if (!res.found) return { ok: true, found: false };
        const imgUrl = (res.data.images || []).find(im => im && im.url)?.url;
        if (!imgUrl) return { ok: true, found: false };

        const resp = await fetch(imgUrl);
        if (!resp.ok) throw new Error(`download HTTP ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        let ext = (imgUrl.split('?')[0].split('.').pop() || 'png').toLowerCase();
        if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) ext = 'png';
        const savePath = filePath.replace(/\.safetensors$/i, '') + `.${ext}`;
        fs.writeFileSync(savePath, buf);
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        return { ok: true, found: true, source: 'civitai', path: savePath, thumb: `data:image/${mime};base64,${buf.toString('base64')}` };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// Use the civitai.red mirror (proxies the civitai API + media).
const CIVITAI_BASE = 'https://civitai.red';

async function lookupByHash(hash, apiKey) {
    const url = `${CIVITAI_BASE}/api/v1/model-versions/by-hash/${hash}`;
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    console.log(CAT, 'lookup', url);
    const resp = await fetch(url, { headers });
    if (resp.status === 404) return { found: false };
    if (!resp.ok) throw new Error(`civitai HTTP ${resp.status}`);
    return { found: true, data: await resp.json() };
}

async function civitaiLookupLora(loraName, apiInterface, apiKey) {
    try {
        const filePath = resolveLoraPath(loraName);
        if (!filePath) return { ok: false, error: 'file-not-found', loraName };

        const hash = hashFile(filePath);
        const res = await lookupByHash(hash, apiKey);
        if (!res.found) return { ok: true, found: false, loraName, hash };

        const d = res.data;
        const images = (d.images || []).map(im => ({
            url: im.url,
            width: im.width,
            height: im.height,
            nsfw: im.nsfwLevel ?? im.nsfw,
            meta: im.meta || null
        }));
        return {
            ok: true,
            found: true,
            loraName,
            hash,
            modelId: d.modelId,
            name: d.model?.name || d.name || loraName,
            versionName: d.name,
            trainedWords: d.trainedWords || [],
            modelUrl: d.modelId ? `${CIVITAI_BASE}/models/${d.modelId}` : null,
            images
        };
    } catch (err) {
        return { ok: false, error: err.message, loraName };
    }
}

// Quick connectivity / key check against the civitai API.
async function civitaiTestKey(apiKey) {
    try {
        const headers = {};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const resp = await fetch(`${CIVITAI_BASE}/api/v1/models?limit=1`, { headers });
        return { ok: resp.ok, status: resp.status };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

export function setupCivitai() {
    ipcMain.handle('civitai-lookup-lora', async (event, loraName, apiInterface, apiKey) => {
        return civitaiLookupLora(loraName, apiInterface, apiKey);
    });
    ipcMain.handle('civitai-test-key', async (event, apiKey) => {
        return civitaiTestKey(apiKey);
    });
    ipcMain.handle('lora-thumb', async (event, loraName) => getLoraThumb(loraName));
    ipcMain.handle('lora-thumb-download', async (event, loraName, apiKey) => downloadLoraThumb(loraName, apiKey));
    ipcMain.handle('lora-thumb-debug', async (event, loraName) => debugLoraThumb(loraName));
}

export { civitaiLookupLora, civitaiTestKey, getLoraThumb, downloadLoraThumb };
