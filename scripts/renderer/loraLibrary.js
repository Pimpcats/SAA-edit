import { sendWebSocketMessage } from '../../webserver/front/wsRequest.js';
import { SAMPLER_WEBUI, SCHEDULER_WEBUI } from './language.js';

const CAT = '[loraLibrary]';

// LoRA library browser. Shows each LoRA's local same-named thumbnail image
// (e.g. myLora.png / myLora.preview.png next to the .safetensors), lazy-loaded
// from disk — no network and no full-library civitai scan. For LoRAs missing a
// local thumbnail, you can download one from civitai.red on demand; it is saved
// next to the .safetensors so it becomes the cached local thumbnail.
// Left-click a thumbnail loads the LoRA into a slot; right-click also pulls and
// applies that LoRA's civitai sample settings.
export function setupLoraLibrary(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    function loraNames() {
        const all = globalThis.cachedFiles.loraList || [];
        return all.filter(n => n && n !== 'None' && n !== 'Default LoRA');
    }

    // ---- IPC helpers ----
    async function thumbLocal(name) {
        if (globalThis.inBrowser) return sendWebSocketMessage({ type: 'API', method: 'getLoraThumb', params: [name] });
        return globalThis.api.getLoraThumb(name);
    }
    async function thumbDownload(name) {
        const apiKey = globalThis.globalSettings.civitai_api_key || '';
        if (globalThis.inBrowser) return sendWebSocketMessage({ type: 'API', method: 'downloadLoraThumb', params: [name, apiKey] });
        return globalThis.api.downloadLoraThumb(name, apiKey);
    }
    async function lookup(name) {
        const apiInterface = globalThis.generate?.api_interface?.getValue?.() || globalThis.globalSettings.api_interface;
        const apiKey = globalThis.globalSettings.civitai_api_key || '';
        if (globalThis.inBrowser) return sendWebSocketMessage({ type: 'API', method: 'civitaiLookupLora', params: [name, apiInterface, apiKey] });
        return globalThis.api.civitaiLookupLora(name, apiInterface, apiKey);
    }

    // ---- Apply a civitai image's settings to the generate area ----
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
        if (!meta) return false;
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
        return true;
    }

    function flash(cell, text) {
        const badge = document.createElement('div');
        badge.className = 'lora-gallery-badge';
        badge.textContent = text;
        cell.appendChild(badge);
        setTimeout(() => badge.remove(), 1500);
    }

    // ---- Grid of LoRA thumbnails ----
    function groupByFolder(names) {
        const groups = {};
        for (const name of names) {
            const parts = name.split(/[/\\]/);
            const folder = parts.slice(0, -1).join('/') || '(root)';
            (groups[folder] = groups[folder] || []).push({
                name, label: parts[parts.length - 1].replace(/\.safetensors$/i, '')
            });
        }
        return groups;
    }

    let observer = null;
    function ensureObserver() {
        if (observer) return observer;
        observer = new IntersectionObserver((entries) => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    observer.unobserve(e.target);
                    loadCellThumb(e.target);
                }
            }
        }, { root: results, rootMargin: '300px' });
        return observer;
    }

    async function loadCellThumb(cell) {
        if (cell.dataset.loaded) return;
        cell.dataset.loaded = '1';
        const name = cell.dataset.lora;
        const img = cell.querySelector('.lora-cell-img');
        const res = await thumbLocal(name).catch(() => null);
        if (res && res.ok && res.found && res.thumb) {
            img.src = res.thumb;
            cell.classList.remove('no-thumb');
        } else {
            cell.classList.add('no-thumb');
        }
    }

    function buildCell({ name, label }) {
        const cell = document.createElement('div');
        cell.className = 'lora-cell';
        cell.dataset.lora = name;
        cell.title = label;

        const img = document.createElement('img');
        img.className = 'lora-cell-img';
        img.loading = 'lazy';
        cell.appendChild(img);

        const cap = document.createElement('div');
        cap.className = 'lora-cell-label';
        cap.textContent = label;
        cell.appendChild(cap);

        const dl = document.createElement('button');
        dl.className = 'lora-cell-dl';
        dl.textContent = getLang().lora_library_dl || '⬇ civitai';
        dl.title = getLang().lora_library_dl_title || 'Download thumbnail from civitai.red';
        dl.addEventListener('click', async (e) => {
            e.stopPropagation();
            await downloadCellThumb(cell, dl);
        });
        cell.appendChild(dl);

        // Left-click: load this LoRA into a slot.
        cell.addEventListener('click', () => {
            if (globalThis.lora?.addLoRAByName) {
                globalThis.lora.addLoRAByName(name);
                flash(cell, getLang().lora_library_loaded_nometa || 'LoRA loaded');
            }
        });
        // Right-click: load + pull and apply civitai sample settings.
        cell.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (globalThis.lora?.addLoRAByName) globalThis.lora.addLoRAByName(name);
            const res = await lookup(name).catch(() => null);
            const meta = res && res.found && (res.images || []).find(im => im.meta)?.meta;
            if (meta && applyMeta(meta)) flash(cell, getLang().lora_library_loaded || 'LoRA + settings applied');
            else flash(cell, getLang().lora_library_loaded_nometa || 'LoRA loaded');
        });

        ensureObserver().observe(cell);
        return cell;
    }

    async function downloadCellThumb(cell, dl) {
        const name = cell.dataset.lora;
        const img = cell.querySelector('.lora-cell-img');
        const prev = dl.textContent;
        dl.textContent = '…';
        dl.disabled = true;
        const res = await thumbDownload(name).catch(err => ({ ok: false, error: err.message }));
        dl.disabled = false;
        if (res && res.ok && res.found && res.thumb) {
            img.src = res.thumb;
            cell.classList.remove('no-thumb');
            return true;
        }
        dl.textContent = (res && res.error) ? '✗' : (getLang().lora_library_no_match || 'no match');
        setTimeout(() => { dl.textContent = prev; }, 2500);
        return false;
    }

    function buildGrid(filter) {
        results.innerHTML = '';
        if (observer) { observer.disconnect(); observer = null; }
        const f = (filter || '').trim().toLowerCase();
        const names = loraNames().filter(n => !f || n.toLowerCase().includes(f));
        if (!names.length) {
            setStatus(getLang().lora_library_empty
                || 'No LoRAs found. Set your WebUI model path in System Settings, connect, then click "Refresh list".');
            return;
        }
        const groups = groupByFolder(names);
        for (const folder of Object.keys(groups).sort((a, b) => a.localeCompare(b))) {
            const items = groups[folder].sort((a, b) => a.label.localeCompare(b.label));
            const sec = document.createElement('div');
            sec.className = 'lora-grid-section';
            const head = document.createElement('div');
            head.className = 'lora-grid-folder';
            const grid = document.createElement('div');
            grid.className = 'lora-grid';
            let open = true;
            const setHead = () => { head.textContent = `${open ? '▾' : '▸'} ${folder} (${items.length})`; };
            setHead();
            head.addEventListener('click', () => { open = !open; grid.style.display = open ? '' : 'none'; setHead(); });
            sec.appendChild(head);
            for (const it of items) grid.appendChild(buildCell(it));
            sec.appendChild(grid);
            results.appendChild(sec);
        }
        setStatus((getLang().lora_library_count || '{0} LoRAs found.').replace('{0}', names.length));
    }

    // Download civitai thumbnails for every visible LoRA that has none locally.
    async function downloadAllMissing() {
        const cells = [...results.querySelectorAll('.lora-cell.no-thumb')];
        if (!cells.length) { setStatus(getLang().lora_library_none_missing || 'All visible LoRAs already have thumbnails.'); return; }
        dlAllBtn.disabled = true;
        let done = 0; let ok = 0;
        for (const cell of cells) {
            done++;
            setStatus((getLang().lora_library_downloading || 'Downloading {0}/{1}...').replace('{0}', done).replace('{1}', cells.length));
            const dl = cell.querySelector('.lora-cell-dl');
            const got = await downloadCellThumb(cell, dl);
            if (got) ok++;
        }
        dlAllBtn.disabled = false;
        setStatus((getLang().lora_library_dl_done || 'Downloaded {0}/{1} thumbnails.').replace('{0}', ok).replace('{1}', cells.length));
    }

    // ---- Panel UI ----
    container.innerHTML = '';
    container.classList.add('lora-library');

    // API key row
    const keyRow = document.createElement('div');
    keyRow.className = 'lora-library-key-row';
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'lora-library-key';
    keyInput.placeholder = getLang().lora_library_api_key || 'Civitai API Key (optional)';
    keyInput.value = globalThis.globalSettings.civitai_api_key || '';
    const testBtn = document.createElement('button');
    testBtn.className = 'lora-library-scan';
    testBtn.textContent = getLang().lora_library_test || 'Test';
    const keyStatus = document.createElement('span');
    keyStatus.className = 'lora-library-keystatus';
    keyStatus.textContent = '●';
    keyInput.addEventListener('change', () => {
        globalThis.globalSettings.civitai_api_key = keyInput.value.trim();
        keyStatus.className = 'lora-library-keystatus saved';
        keyStatus.textContent = getLang().lora_library_saved || 'Saved ✓';
    });
    testBtn.addEventListener('click', async () => {
        globalThis.globalSettings.civitai_api_key = keyInput.value.trim();
        keyStatus.className = 'lora-library-keystatus';
        keyStatus.textContent = getLang().lora_library_testing || 'Testing…';
        let res;
        try {
            if (globalThis.inBrowser) res = await sendWebSocketMessage({ type: 'API', method: 'civitaiTestKey', params: [keyInput.value.trim()] });
            else res = await globalThis.api.civitaiTestKey(keyInput.value.trim());
        } catch (err) {
            res = { ok: false, error: err.message };
        }
        if (res && res.ok) {
            keyStatus.className = 'lora-library-keystatus ok';
            keyStatus.textContent = getLang().lora_library_connected || 'Connected ✓';
        } else {
            keyStatus.className = 'lora-library-keystatus err';
            keyStatus.textContent = (getLang().lora_library_test_failed || 'Failed ✗') + (res?.status ? ` (${res.status})` : '');
        }
    });
    keyRow.appendChild(keyInput);
    keyRow.appendChild(testBtn);
    keyRow.appendChild(keyStatus);

    // Controls: search + refresh + download-missing
    const controls = document.createElement('div');
    controls.className = 'lora-library-controls';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'lora-library-search';
    searchInput.placeholder = getLang().lora_library_search || 'Filter LoRAs…';
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => buildGrid(searchInput.value), 200);
    });
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'lora-library-scan';
    refreshBtn.textContent = getLang().lora_library_refresh || 'Refresh list';
    const dlAllBtn = document.createElement('button');
    dlAllBtn.className = 'lora-library-scan';
    dlAllBtn.textContent = getLang().lora_library_dl_missing || 'Download missing thumbs';
    controls.appendChild(searchInput);
    controls.appendChild(refreshBtn);
    controls.appendChild(dlAllBtn);

    const status = document.createElement('div');
    status.className = 'lora-library-status-line';
    function setStatus(text) { status.textContent = text; }

    const results = document.createElement('div');
    results.className = 'lora-library-results';

    async function refreshLoraList() {
        const SETTINGS = globalThis.globalSettings;
        try {
            if (globalThis.inBrowser) globalThis.cachedFiles.loraList = await sendWebSocketMessage({ type: 'API', method: 'getLoRAList', params: [SETTINGS.api_interface] });
            else globalThis.cachedFiles.loraList = await globalThis.api.getLoRAList(SETTINGS.api_interface);
        } catch (err) {
            console.error(CAT, 'refresh lora list failed:', err);
        }
        buildGrid(searchInput.value);
    }

    refreshBtn.addEventListener('click', refreshLoraList);
    dlAllBtn.addEventListener('click', downloadAllMissing);

    container.appendChild(keyRow);
    container.appendChild(controls);
    container.appendChild(status);
    container.appendChild(results);

    // Build the grid once from the already-loaded LoRA list (thumbnails lazy-load).
    buildGrid('');

    return { refreshLoraList, buildGrid: () => buildGrid(searchInput.value) };
}
