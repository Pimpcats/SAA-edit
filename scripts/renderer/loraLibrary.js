import { sendWebSocketMessage } from '../../webserver/front/wsRequest.js';
import { SAMPLER_WEBUI, SCHEDULER_WEBUI } from './language.js';

const CAT = '[loraLibrary]';

// LoRA library browser: matches local LoRAs to civitai (by SHA256 hash, via the
// civitai.red mirror) and shows their example images + settings in an inline,
// scrollable view. Right-click an image to apply its settings.
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

    // Append one LoRA's result (title + scrollable image strip) to the view.
    function appendResult(result) {
        const LANG = getLang();
        const section = document.createElement('div');
        section.className = 'lora-result-section';

        const head = document.createElement('div');
        head.className = 'lora-result-head';
        const title = document.createElement('a');
        title.className = 'lora-result-title';
        title.textContent = result.name || result.loraName;
        if (result.modelUrl) { title.href = result.modelUrl; title.target = '_blank'; }
        head.appendChild(title);
        const hint = document.createElement('span');
        hint.className = 'lora-result-hint';
        hint.textContent = LANG.lora_library_apply_hint || '(right-click an image to use its settings)';
        head.appendChild(hint);
        section.appendChild(head);

        const strip = document.createElement('div');
        strip.className = 'lora-result-strip';
        for (const im of result.images) {
            const cell = document.createElement('div');
            cell.className = 'lora-gallery-cell';
            const img = document.createElement('img');
            img.src = im.url;
            img.loading = 'lazy';
            img.title = im.meta
                ? (LANG.lora_library_apply_hint || 'right-click to use these settings')
                : (LANG.lora_library_no_meta || 'no settings on this image');
            img.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Load this LoRA into a LoRA slot...
                if (globalThis.lora?.addLoRAByName) {
                    globalThis.lora.addLoRAByName(result.loraName);
                }
                // ...and apply the image's settings.
                if (im.meta && applyMeta(im.meta)) flash(cell, LANG.lora_library_loaded || 'LoRA + settings applied');
                else flash(cell, LANG.lora_library_loaded_nometa || 'LoRA loaded');
            });
            cell.appendChild(img);
            strip.appendChild(cell);
        }
        section.appendChild(strip);
        results.appendChild(section);
    }

    // ---- Folder tree (navigate LoRAs by their folder hierarchy) ----
    function buildTree(names) {
        const root = { folders: {}, files: [] };
        for (const name of names) {
            const parts = name.split(/[/\\]/);
            let node = root;
            for (let i = 0; i < parts.length - 1; i++) {
                const p = parts[i];
                node.folders[p] = node.folders[p] || { folders: {}, files: [] };
                node = node.folders[p];
            }
            node.files.push({ name, label: parts[parts.length - 1] });
        }
        return root;
    }

    function renderTree(node, el, depth) {
        for (const fname of Object.keys(node.folders).sort((a, b) => a.localeCompare(b))) {
            const header = document.createElement('div');
            header.className = 'lora-tree-folder-header';
            header.style.paddingLeft = `${depth * 12}px`;
            header.textContent = `▸ ${fname}`;
            const childWrap = document.createElement('div');
            childWrap.style.display = 'none';
            let open = false;
            header.addEventListener('click', () => {
                open = !open;
                childWrap.style.display = open ? 'block' : 'none';
                header.textContent = `${open ? '▾' : '▸'} ${fname}`;
            });
            el.appendChild(header);
            renderTree(node.folders[fname], childWrap, depth + 1);
            el.appendChild(childWrap);
        }
        for (const f of node.files.sort((a, b) => a.label.localeCompare(b.label))) {
            const leaf = document.createElement('div');
            leaf.className = 'lora-tree-leaf';
            leaf.style.paddingLeft = `${depth * 12 + 14}px`;
            leaf.textContent = f.label;
            leaf.addEventListener('click', async () => {
                leaf.style.opacity = '0.5';
                const res = await lookup(f.name).catch(err => ({ ok: false, error: err.message }));
                leaf.style.opacity = '1';
                if (res && res.ok && res.found && res.images.length) {
                    appendResult(res);
                } else {
                    setStatus(`${f.label}: ${res && res.error ? res.error : (res && !res.found ? 'no civitai match' : 'no images')}`);
                }
            });
            el.appendChild(leaf);
        }
    }

    // ---- Panel UI ----
    container.innerHTML = '';
    container.classList.add('lora-library');

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
            if (globalThis.inBrowser) {
                res = await sendWebSocketMessage({ type: 'API', method: 'civitaiTestKey', params: [keyInput.value.trim()] });
            } else {
                res = await globalThis.api.civitaiTestKey(keyInput.value.trim());
            }
        } catch (err) {
            res = { ok: false, error: err.message };
        }
        if (res && res.ok) {
            keyStatus.className = 'lora-library-keystatus ok';
            keyStatus.textContent = getLang().lora_library_connected || 'Connected ✓';
        } else {
            keyStatus.className = 'lora-library-keystatus err';
            keyStatus.textContent = (getLang().lora_library_test_failed || 'Failed ✗')
                + (res?.status ? ` (${res.status})` : '');
        }
    });
    keyRow.appendChild(keyInput);
    keyRow.appendChild(testBtn);
    keyRow.appendChild(keyStatus);

    const controls = document.createElement('div');
    controls.className = 'lora-library-controls';
    const browseBtn = document.createElement('button');
    browseBtn.className = 'lora-library-scan';
    browseBtn.textContent = getLang().lora_library_browse || 'Browse folders';
    const scanBtn = document.createElement('button');
    scanBtn.className = 'lora-library-scan';
    scanBtn.textContent = getLang().lora_library_scan || 'Scan all';
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'lora-library-scan';
    refreshBtn.textContent = getLang().lora_library_refresh || 'Refresh list';
    controls.appendChild(browseBtn);
    controls.appendChild(scanBtn);
    controls.appendChild(refreshBtn);

    const treeContainer = document.createElement('div');
    treeContainer.className = 'lora-library-tree';
    treeContainer.style.display = 'none';

    function rebuildTree() {
        treeContainer.innerHTML = '';
        renderTree(buildTree(loraNames()), treeContainer, 0);
    }
    browseBtn.addEventListener('click', () => {
        const show = treeContainer.style.display === 'none';
        treeContainer.style.display = show ? 'block' : 'none';
        if (show && treeContainer.childElementCount === 0) rebuildTree();
    });

    const status = document.createElement('div');
    status.className = 'lora-library-status-line';

    const results = document.createElement('div');
    results.className = 'lora-library-results';

    function setStatus(text) { status.textContent = text; }

    async function refreshLoraList() {
        const SETTINGS = globalThis.globalSettings;
        try {
            if (globalThis.inBrowser) {
                globalThis.cachedFiles.loraList = await sendWebSocketMessage({ type: 'API', method: 'getLoRAList', params: [SETTINGS.api_interface] });
            } else {
                globalThis.cachedFiles.loraList = await globalThis.api.getLoRAList(SETTINGS.api_interface);
            }
        } catch (err) {
            console.error(CAT, 'refresh lora list failed:', err);
        }
        const n = loraNames().length;
        setStatus((getLang().lora_library_count || '{0} LoRAs found.').replace('{0}', n));
        if (treeContainer.style.display !== 'none') rebuildTree();
    }

    async function scanAll() {
        const names = loraNames();
        results.innerHTML = '';
        if (names.length === 0) {
            setStatus(getLang().lora_library_empty
                || 'No LoRAs found. Set your WebUI model path in System Settings, connect, then click "Refresh list".');
            return;
        }
        scanBtn.disabled = true;
        let found = 0; let errors = 0; let firstError = '';
        for (let i = 0; i < names.length; i++) {
            setStatus((getLang().lora_library_scanning || 'Scanning {0}/{1}...').replace('{0}', i + 1).replace('{1}', names.length));
            const res = await lookup(names[i]).catch(err => ({ ok: false, error: err.message }));
            if (res && res.ok && res.found && res.images.length) {
                found++;
                appendResult(res);
            } else if (!res || !res.ok) {
                errors++;
                if (!firstError) firstError = (res && res.error) ? `${names[i]}: ${res.error}` : `${names[i]}: unknown`;
            }
        }
        scanBtn.disabled = false;
        const tail = errors ? ` (${errors} errors — e.g. ${firstError})` : '';
        setStatus((getLang().lora_library_done || 'Done. {0}/{1} matched on civitai{2}.')
            .replace('{0}', found).replace('{1}', names.length).replace('{2}', tail));
    }

    scanBtn.addEventListener('click', scanAll);
    refreshBtn.addEventListener('click', refreshLoraList);

    container.appendChild(keyRow);
    container.appendChild(controls);
    container.appendChild(status);
    container.appendChild(treeContainer);
    container.appendChild(results);

    setStatus((getLang().lora_library_count || '{0} LoRAs found.').replace('{0}', loraNames().length));

    return { scanAll, refreshLoraList };
}
