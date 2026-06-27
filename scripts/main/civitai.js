import { app, ipcMain } from 'electron';
import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getGlobalSettings } from './globalSettings.js';

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

// Candidate directories that hold LoRA files for the active backend.
function loraDirs(apiInterface) {
    const S = getGlobalSettings();
    const dirs = [];
    if (apiInterface === 'ComfyUI' && S.model_path_comfyui) {
        dirs.push(path.join(path.dirname(S.model_path_comfyui), 'loras'));
    }
    if (S.model_path_webui) {
        dirs.push(path.join(path.dirname(S.model_path_webui), 'Lora'));
        dirs.push(path.join(path.dirname(S.model_path_webui), 'models', 'Lora'));
    }
    return dirs;
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

function resolveLoraPath(loraName, apiInterface) {
    const names = [loraName, `${loraName}.safetensors`];
    for (const dir of loraDirs(apiInterface)) {
        for (const n of names) {
            const c = path.join(dir, n);
            if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
        }
    }
    const baseLower = path.basename(loraName).replace(/\.safetensors$/i, '').toLowerCase();
    for (const dir of loraDirs(apiInterface)) {
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
        const filePath = resolveLoraPath(loraName, apiInterface);
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
}

export { civitaiLookupLora, civitaiTestKey };
