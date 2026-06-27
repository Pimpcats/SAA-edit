import { sendWebSocketMessage } from '../../webserver/front/wsRequest.js';
import { SAMPLER_WEBUI, SCHEDULER_WEBUI } from './language.js';

const CAT = '[loraLibrary]';

// LoRA library browser: matches local LoRAs to civitai (by SHA256 hash) and
// shows their example images + settings. Right-click an image to apply its
// generation settings to the generate area.
export function setupLoraLibrary(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    async function lookup(loraName) {
        const apiInterface = globalThis.generate?.api_interface?.getValue?.() || globalThis.globalSettings.api_interface;
        const apiKey = globalThis.globalSettings.civitai_api_key || '';
        if (globalThis.inBrowser) {
            return await sendWebSocketMessage({ type: 'API', method: 'civitaiLookupLora', params: [loraName, apiInterface, apiKey] });
        }
        return await globalThis.api.civitaiLookupLora(loraName, apiInterface, apiKey);
    }

    // ---- Apply civitai image meta to the generate area ----
    function resolveSampler(sampler, scheduler) {
        let s = (sampler || '').trim();
        let sch = (scheduler || '').trim();
        if (s && !SAMPLER_WEBUI.includes(s)) {
            for (const c of SCHEDULER_WEBUI) {
                if (c === 'Automatic') continue;
                if (s.toLowerCase().endsWith(` ${c.toLowerCase()}`)) {
                    if (!sch) sch = c;
                    s = s.slice(0, s.length - c.length - 1).trim();
                    break;
                }
            }
        }
        return {
            sampler: SAMPLER_WEBUI.find(x => x.toLowerCase() === s.toLowerCase()) || null,
            scheduler: sch ? (SCHEDULER_WEBUI.find(x => x.toLowerCase() === sch.toLowerCase()) || null) : null
        };
    }

    function applyMeta(meta) {
        if (!meta) return;
        if (meta.prompt) globalThis.prompt.common.setValue(meta.prompt);
        if (meta.negativePrompt) globalThis.prompt.negative.setValue(meta.negativePrompt);
        if (meta.seed !== undefined) globalThis.generate.seed.setValue(meta.seed);
        if (meta.cfgScale !== undefined) globalThis.generate.cfg.setValue(meta.cfgScale);
        if (meta.steps !== undefined) globalThis.generate.step.setValue(meta.steps);

        let w; let h;
        if (meta.Size && /(\d+)\s*x\s*(\d+)/i.test(meta.Size)) {
            const m = meta.Size.match(/(\d+)\s*x\s*(\d+)/i);
            w = m[1]; h = m[2];
        } else {
            if (meta.width) w = meta.width;
            if (meta.height) h = meta.height;
        }
        if (w) globalThis.generate.width.setValue(w);
        if (h) globalThis.generate.height.setValue(h);

        const { sampler, scheduler } = resolveSampler(meta.sampler, meta['Schedule type'] || meta.scheduler);
        if (sampler) globalThis.generate.sampler.updateDefaults(sampler);
        if (scheduler) globalThis.generate.scheduler.updateDefaults(scheduler);

        globalThis.generate.landscape.setValue(false);
    }

    // ---- Gallery overlay ----
    function openGallery(result) {
        const old = document.getElementById('lora-library-gallery');
        if (old) old.remove();

        const LANG = getLang();
        const overlay = document.createElement('div');
        overlay.id = 'lora-library-gallery';
        overlay.className = 'lora-gallery-overlay';

        const header = document.createElement('div');
        header.className = 'lora-gallery-header';
        const title = document.createElement('a');
        title.textContent = result.name || result.loraName;
        if (result.modelUrl) { title.href = result.modelUrl; title.target = '_blank'; }
        title.className = 'lora-gallery-title';
        const hint = document.createElement('span');
        hint.className = 'lora-gallery-hint';
        hint.textContent = LANG.lora_library_apply_hint || '(right-click an image to use its settings)';
        const close = document.createElement('button');
        close.className = 'lora-gallery-close';
        close.textContent = '✕';
        close.addEventListener('click', () => overlay.remove());
        header.appendChild(title);
        header.appendChild(hint);
        header.appendChild(close);
        overlay.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'lora-gallery-grid';
        for (const im of result.images) {
            const cell = document.createElement('div');
            cell.className = 'lora-gallery-cell';
            const img = document.createElement('img');
            img.src = im.url;
            img.loading = 'lazy';
            img.title = im.meta ? (LANG.lora_library_apply_hint || 'right-click to use these settings') : (LANG.lora_library_no_meta || 'no settings on this image');
            img.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (im.meta) {
                    applyMeta(im.meta);
                    flash(cell, LANG.lora_library_applied || 'Settings applied');
                } else {
                    flash(cell, LANG.lora_library_no_meta || 'No settings');
                }
            });
            cell.appendChild(img);
            grid.appendChild(cell);
        }
        overlay.appendChild(grid);
        document.body.appendChild(overlay);
    }

    function flash(cell, text) {
        const badge = document.createElement('div');
        badge.className = 'lora-gallery-badge';
        badge.textContent = text;
        cell.appendChild(badge);
        setTimeout(() => badge.remove(), 1500);
    }

    // ---- Panel UI ----
    container.innerHTML = '';
    container.classList.add('lora-library');

    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'lora-library-key';
    keyInput.placeholder = getLang().lora_library_api_key || 'Civitai API Key (optional)';
    keyInput.value = globalThis.globalSettings.civitai_api_key || '';
    keyInput.addEventListener('change', () => {
        globalThis.globalSettings.civitai_api_key = keyInput.value.trim();
    });

    const controls = document.createElement('div');
    controls.className = 'lora-library-controls';
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'lora-library-filter';
    filterInput.placeholder = getLang().lora_library_filter || 'Filter LoRAs...';
    const scanBtn = document.createElement('button');
    scanBtn.className = 'lora-library-scan';
    scanBtn.textContent = getLang().lora_library_scan || 'Scan all';
    controls.appendChild(filterInput);
    controls.appendChild(scanBtn);

    const list = document.createElement('div');
    list.className = 'lora-library-list';

    function loraNames() {
        const all = globalThis.cachedFiles.loraList || [];
        return all.filter(n => n && n !== 'None' && n !== 'Default LoRA');
    }

    function renderList(filter = '') {
        list.innerHTML = '';
        const f = filter.trim().toLowerCase();
        for (const name of loraNames()) {
            if (f && !name.toLowerCase().includes(f)) continue;
            const row = document.createElement('div');
            row.className = 'lora-library-row';
            const label = document.createElement('span');
            label.className = 'lora-library-name';
            label.textContent = name;
            const status = document.createElement('span');
            status.className = 'lora-library-status';
            row.appendChild(label);
            row.appendChild(status);
            row.addEventListener('click', async () => {
                status.textContent = '…';
                const res = await lookup(name).catch(err => ({ ok: false, error: err.message }));
                row._res = res;
                applyStatus(status, res);
                if (res && res.ok && res.found) openGallery(res);
            });
            list.appendChild(row);
        }
    }

    function applyStatus(status, res) {
        const LANG = getLang();
        if (!res || !res.ok) {
            status.textContent = res?.error === 'file-not-found'
                ? (LANG.lora_library_not_found_local || 'file?')
                : (LANG.lora_library_error || 'error');
            status.className = 'lora-library-status err';
        } else if (!res.found) {
            status.textContent = LANG.lora_library_no_match || 'no match';
            status.className = 'lora-library-status none';
        } else {
            status.textContent = `${res.images.length} ✓`;
            status.className = 'lora-library-status ok';
        }
    }

    filterInput.addEventListener('input', () => renderList(filterInput.value));

    scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true;
        const rows = [...list.querySelectorAll('.lora-library-row')];
        for (const row of rows) {
            const name = row.querySelector('.lora-library-name').textContent;
            const status = row.querySelector('.lora-library-status');
            status.textContent = '…';
            const res = await lookup(name).catch(err => ({ ok: false, error: err.message }));
            row._res = res;
            applyStatus(status, res);
        }
        scanBtn.disabled = false;
    });

    container.appendChild(keyInput);
    container.appendChild(controls);
    container.appendChild(list);
    renderList();

    return { renderList, refresh: () => renderList(filterInput.value) };
}
