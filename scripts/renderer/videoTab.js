// Video (ComfyUI) tab: animate a generated image with a WAN image-to-video
// workflow. Pick a Scene/Motion and a Position (like the view-tag dropdowns),
// set a few controls, and Run. The heavy lifting (upload image -> patch the
// WAN workflow -> submit -> poll -> fetch video) is done in the main process
// (scripts/main/comfyVideo.js); this is just the front-end.

const CAT = '[videoTab]';

const DEFAULT_SCENES = {
    motion: ['subtle idle motion, gentle breathing', 'slow camera push in', 'hair and clothes swaying in the wind'],
    position: ['riding, moving up and down', 'thrusting', 'bouncing, breasts bouncing']
};

export function setupVideoTab(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    // ---- IPC helpers ----
    const api = {
        list: () => (globalThis.api?.comfyVideoList ? globalThis.api.comfyVideoList() : Promise.resolve([])),
        get: (n) => (globalThis.api?.comfyVideoGet ? globalThis.api.comfyVideoGet(n) : Promise.resolve(null)),
        save: (n, g) => (globalThis.api?.comfyVideoSave ? globalThis.api.comfyVideoSave(n, g) : Promise.resolve(null)),
        saveScenes: (s) => (globalThis.api?.comfyVideoSaveScenes ? globalThis.api.comfyVideoSaveScenes(s) : Promise.resolve(null)),
        run: (p) => (globalThis.api?.comfyVideoRun ? globalThis.api.comfyVideoRun(p) : Promise.resolve({ ok: false, error: 'desktop only' }))
    };

    let scenes = DEFAULT_SCENES;
    let inputImage = null;   // data URL of the image to animate

    // ---- UI ----
    container.innerHTML = '';
    container.classList.add('video-tab');

    const note = document.createElement('div');
    note.className = 'video-note';
    note.textContent = getLang().video_note
        || 'Animate a generated image with a WAN image-to-video workflow in ComfyUI (set Image API to ComfyUI). Pick a scene/position, then Run.';
    container.appendChild(note);

    // Input image row
    const imgRow = document.createElement('div');
    imgRow.className = 'video-img-row';
    const preview = document.createElement('img');
    preview.className = 'video-input-preview';
    preview.alt = 'input';
    const imgBtns = document.createElement('div');
    imgBtns.className = 'video-img-btns';
    const useLastBtn = document.createElement('button');
    useLastBtn.className = 'video-btn';
    useLastBtn.textContent = getLang().video_use_last || 'Use last image';
    useLastBtn.addEventListener('click', () => {
        const src = document.querySelector('.cg-main-image')?.src || globalThis.generate?.lastThumb;
        if (src) { inputImage = src; preview.src = src; }
        else setStatus(getLang().video_no_image || 'No gallery image yet — generate one first.');
    });
    imgBtns.appendChild(useLastBtn);
    const dropHint = document.createElement('div');
    dropHint.className = 'video-drop-hint';
    dropHint.textContent = getLang().video_drop || 'or drop an image here';
    imgBtns.appendChild(dropHint);
    // Animate preview window (progress + finished animation), to the right.
    const outBox = document.createElement('div');
    outBox.className = 'video-outbox';
    const outLabel = document.createElement('div');
    outLabel.className = 'video-outbox-label';
    outLabel.textContent = getLang().video_preview || 'Animation preview';
    outBox.appendChild(outLabel);

    imgRow.appendChild(preview);
    imgRow.appendChild(imgBtns);
    imgRow.appendChild(outBox);
    container.appendChild(imgRow);

    // drag-drop image onto the preview
    preview.addEventListener('dragover', (e) => { e.preventDefault(); preview.classList.add('drag'); });
    preview.addEventListener('dragleave', () => preview.classList.remove('drag'));
    preview.addEventListener('drop', (e) => {
        e.preventDefault();
        preview.classList.remove('drag');
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => { inputImage = reader.result; preview.src = reader.result; };
        reader.readAsDataURL(file);
    });

    // Scene + Position selectors (editable lists, like the view tags)
    function makeSelectRow(labelText, key) {
        const row = document.createElement('div');
        row.className = 'video-row';
        const label = document.createElement('span');
        label.className = 'video-label';
        label.textContent = labelText;
        const sel = document.createElement('select');
        sel.className = 'video-select';
        const rebuild = () => {
            sel.innerHTML = '';
            const none = document.createElement('option');
            none.value = ''; none.textContent = '(none)';
            sel.appendChild(none);
            for (const item of (scenes[key] || [])) {
                const o = document.createElement('option');
                o.value = item; o.textContent = item;
                sel.appendChild(o);
            }
        };
        rebuild();
        row.appendChild(label);
        row.appendChild(sel);
        row._rebuild = rebuild;
        row._select = sel;
        return row;
    }
    const motionRow = makeSelectRow(getLang().video_scene || 'Scene / motion', 'motion');
    const positionRow = makeSelectRow(getLang().video_position || 'Position', 'position');
    container.appendChild(motionRow);
    container.appendChild(positionRow);

    const editRow = document.createElement('div');
    editRow.className = 'video-row';
    const editBtn = document.createElement('button');
    editBtn.className = 'video-btn';
    editBtn.textContent = getLang().video_edit_lists || '✎ Edit scene / position lists';
    editBtn.addEventListener('click', openSceneEditor);
    editRow.appendChild(editBtn);
    container.appendChild(editRow);

    // Extra prompt
    const extraRow = document.createElement('div');
    extraRow.className = 'video-row';
    const extraLabel = document.createElement('span');
    extraLabel.className = 'video-label';
    extraLabel.textContent = getLang().video_extra || 'Extra prompt';
    const extraInput = document.createElement('input');
    extraInput.type = 'text';
    extraInput.className = 'video-text';
    extraInput.placeholder = getLang().video_extra_ph || 'optional extra motion words';
    extraRow.appendChild(extraLabel);
    extraRow.appendChild(extraInput);
    container.appendChild(extraRow);

    // Numeric controls (defaults tuned for ~16GB GPU, 480p, 4-step speed LoRA)
    function num(label, value, min, max, step) {
        const row = document.createElement('div');
        row.className = 'video-num';
        const l = document.createElement('span'); l.textContent = label;
        const i = document.createElement('input');
        i.type = 'number'; i.value = value;
        if (min !== undefined) i.min = min;
        if (max !== undefined) i.max = max;
        if (step !== undefined) i.step = step;
        row.appendChild(l); row.appendChild(i);
        row._input = i;
        return row;
    }
    const numWrap = document.createElement('div');
    numWrap.className = 'video-num-wrap';
    const wNum = num(getLang().video_width || 'Width', 480, 64, 1280, 16);
    const hNum = num(getLang().video_height || 'Height', 832, 64, 1280, 16);
    const lenNum = num(getLang().video_frames || 'Frames', 49, 5, 161, 4);
    const fpsNum = num(getLang().video_fps || 'FPS', 16, 1, 60, 1);
    const stepsNum = num(getLang().video_steps || 'Steps', 6, 1, 60, 1);
    const cfgNum = num(getLang().video_cfg || 'CFG', 1, 0, 15, 0.5);
    const seedNum = num(getLang().video_seed || 'Seed (-1 random)', -1, -1, undefined, 1);
    for (const r of [wNum, hNum, lenNum, fpsNum, stepsNum, cfgNum, seedNum]) numWrap.appendChild(r);
    container.appendChild(numWrap);

    // ComfyUI address (separate from the A1111 image API — ComfyUI is its own
    // server, default port 8188).
    const addrRow = document.createElement('div');
    addrRow.className = 'video-row';
    const addrLabel = document.createElement('span');
    addrLabel.className = 'video-label';
    addrLabel.textContent = getLang().video_comfy_addr || 'ComfyUI address';
    const addrInput = document.createElement('input');
    addrInput.type = 'text';
    addrInput.className = 'video-text';
    addrInput.placeholder = '127.0.0.1:8000';
    addrInput.value = globalThis.globalSettings.video_comfy_addr || '127.0.0.1:8000';
    addrInput.addEventListener('change', () => { globalThis.globalSettings.video_comfy_addr = addrInput.value.trim(); });
    const testBtn = document.createElement('button');
    testBtn.className = 'video-btn';
    testBtn.textContent = getLang().video_test || 'Test';
    const testStatus = document.createElement('span');
    testStatus.className = 'video-test-status';
    testStatus.textContent = '●';
    testBtn.addEventListener('click', async () => {
        const addr = addrInput.value.trim() || '127.0.0.1:8000';
        globalThis.globalSettings.video_comfy_addr = addr;
        testStatus.className = 'video-test-status';
        testStatus.textContent = getLang().video_testing || 'Testing…';
        const res = globalThis.api?.comfyVideoPing
            ? await globalThis.api.comfyVideoPing(addr).catch(err => ({ ok: false, error: err.message }))
            : { ok: false, error: 'desktop only' };
        if (res && res.ok && res.isComfy) {
            testStatus.className = 'video-test-status ok';
            testStatus.textContent = getLang().video_connected || 'ComfyUI connected ✓';
            loadModels();   // auto-populate the model dropdowns on connect
        } else if (res && res.ok) {
            testStatus.className = 'video-test-status warn';
            testStatus.textContent = getLang().video_not_comfy || 'Reachable, but not ComfyUI ✗';
        } else {
            testStatus.className = 'video-test-status err';
            testStatus.textContent = (getLang().video_unreachable || 'Unreachable ✗')
                + (res?.status ? ` (${res.status})` : (res?.error ? ` (${res.error})` : ''));
        }
    });
    addrRow.appendChild(addrLabel);
    addrRow.appendChild(addrInput);
    addrRow.appendChild(testBtn);
    addrRow.appendChild(testStatus);
    container.appendChild(addrRow);

    // Workflow + model files
    const wfRow = document.createElement('div');
    wfRow.className = 'video-row';
    const wfLabel = document.createElement('span');
    wfLabel.className = 'video-label';
    wfLabel.textContent = getLang().video_workflow || 'Workflow';
    const wfSelect = document.createElement('select');
    wfSelect.className = 'video-select';
    const importBtn = document.createElement('button');
    importBtn.className = 'video-btn';
    importBtn.textContent = getLang().video_import || 'Import API JSON…';
    wfRow.appendChild(wfLabel);
    wfRow.appendChild(wfSelect);
    wfRow.appendChild(importBtn);
    container.appendChild(wfRow);

    const modelsWrap = document.createElement('div');
    modelsWrap.className = 'video-models';

    function rebuildOptions(sel, list, selected) {
        sel.innerHTML = '';
        const def = document.createElement('option');
        def.value = ''; def.textContent = getLang().video_default_opt || '(keep workflow default)';
        sel.appendChild(def);
        const all = [...new Set([...(selected ? [selected] : []), ...(list || [])])].filter(Boolean);
        for (const name of all) {
            const o = document.createElement('option');
            o.value = name; o.textContent = name;
            sel.appendChild(o);
        }
        sel.value = selected || '';
    }
    function selectField(label, settingKey) {
        const row = document.createElement('div');
        row.className = 'video-row';
        const l = document.createElement('span'); l.className = 'video-label'; l.textContent = label;
        const sel = document.createElement('select');
        sel.className = 'video-select';
        rebuildOptions(sel, [], globalThis.globalSettings[settingKey] || '');
        sel.addEventListener('change', () => { globalThis.globalSettings[settingKey] = sel.value; });
        row.appendChild(l); row.appendChild(sel);
        row._input = sel;
        return row;
    }
    const modelField = selectField(getLang().video_model || 'Diffusion model', 'video_model_name');
    // Second diffusion model for two-model WAN 2.2 (high + low noise). Left on
    // "(keep workflow default)" for single-model workflows.
    const modelLowField = selectField(getLang().video_model_low || 'Diffusion model (low noise)', 'video_model_name_low');
    const clipField = selectField(getLang().video_clip || 'Text encoder (CLIP)', 'video_clip_name');
    const vaeField = selectField(getLang().video_vae || 'VAE', 'video_vae_name');
    const loraField = selectField(getLang().video_lora || 'Speed LoRA', 'video_lora_name');

    // Extra LoRA (e.g. an NSFW / motion LoRA) — stacked onto every model path.
    const extraLoraRow = document.createElement('div');
    extraLoraRow.className = 'video-row';
    const elLabel = document.createElement('span');
    elLabel.className = 'video-label';
    elLabel.textContent = getLang().video_extra_lora || 'Extra LoRA (NSFW/motion)';
    const elSel = document.createElement('select');
    elSel.className = 'video-select';
    rebuildOptions(elSel, [], globalThis.globalSettings.video_extra_lora || '');
    elSel.addEventListener('change', () => { globalThis.globalSettings.video_extra_lora = elSel.value; });
    const elStrength = document.createElement('input');
    elStrength.type = 'number'; elStrength.step = '0.05'; elStrength.min = '0'; elStrength.max = '2';
    elStrength.style.maxWidth = '70px'; elStrength.title = getLang().video_extra_lora_strength || 'strength';
    elStrength.value = globalThis.globalSettings.video_extra_lora_strength ?? 1.0;
    elStrength.addEventListener('change', () => { globalThis.globalSettings.video_extra_lora_strength = Number(elStrength.value); });
    extraLoraRow.appendChild(elLabel);
    extraLoraRow.appendChild(elSel);
    extraLoraRow.appendChild(elStrength);

    const loadModelsRow = document.createElement('div');
    loadModelsRow.className = 'video-row';
    const loadModelsBtn = document.createElement('button');
    loadModelsBtn.className = 'video-btn';
    loadModelsBtn.textContent = getLang().video_load_models || 'Load model lists from ComfyUI';
    const modelsStatus = document.createElement('span');
    modelsStatus.className = 'video-status';
    loadModelsRow.appendChild(loadModelsBtn);
    loadModelsRow.appendChild(modelsStatus);

    async function loadModels() {
        const addr = addrInput.value.trim() || '127.0.0.1:8000';
        modelsStatus.textContent = getLang().video_loading_models || 'Loading…';
        const res = globalThis.api?.comfyVideoModels
            ? await globalThis.api.comfyVideoModels(addr).catch(e => ({ ok: false, error: e.message }))
            : { ok: false, error: 'desktop only' };
        if (!res || !res.ok) { modelsStatus.textContent = (getLang().video_models_failed || 'Failed: ') + (res?.error || '?'); return; }
        rebuildOptions(modelField._input, res.unet, globalThis.globalSettings.video_model_name);
        rebuildOptions(modelLowField._input, res.unet, globalThis.globalSettings.video_model_name_low);
        rebuildOptions(clipField._input, res.clip, globalThis.globalSettings.video_clip_name);
        rebuildOptions(vaeField._input, res.vae, globalThis.globalSettings.video_vae_name);
        rebuildOptions(loraField._input, res.lora, globalThis.globalSettings.video_lora_name);
        rebuildOptions(elSel, res.lora, globalThis.globalSettings.video_extra_lora);
        modelsStatus.textContent = (getLang().video_models_loaded || '{0} models, {1} loras')
            .replace('{0}', res.unet.length).replace('{1}', res.lora.length);
    }
    loadModelsBtn.addEventListener('click', loadModels);

    for (const r of [loadModelsRow, modelField, modelLowField, clipField, vaeField, loraField, extraLoraRow]) modelsWrap.appendChild(r);
    container.appendChild(modelsWrap);

    // ---- Download models into ComfyUI's folder ----
    const dlWrap = document.createElement('div');
    dlWrap.className = 'video-models';
    const dlTitle = document.createElement('div');
    dlTitle.className = 'video-outbox-label';
    dlTitle.textContent = getLang().video_dl_title || 'Download a model into ComfyUI';
    dlWrap.appendChild(dlTitle);

    // ComfyUI models folder
    const dirRow = document.createElement('div');
    dirRow.className = 'video-row';
    const dirLabel = document.createElement('span');
    dirLabel.className = 'video-label';
    dirLabel.textContent = getLang().video_models_dir || 'ComfyUI models folder';
    const dirInput = document.createElement('input');
    dirInput.type = 'text';
    dirInput.className = 'video-text';
    dirInput.placeholder = '…/ComfyUI/models';
    dirInput.value = globalThis.globalSettings.comfy_models_dir || '';
    dirInput.addEventListener('change', () => { globalThis.globalSettings.comfy_models_dir = dirInput.value.trim(); });
    const browseDirBtn = document.createElement('button');
    browseDirBtn.className = 'video-btn';
    browseDirBtn.textContent = getLang().video_browse || 'Browse…';
    browseDirBtn.addEventListener('click', async () => {
        if (!globalThis.api?.pickSaveFolder) return;
        const res = await globalThis.api.pickSaveFolder().catch(() => null);
        if (res?.ok && res.path) { dirInput.value = res.path; globalThis.globalSettings.comfy_models_dir = res.path; }
    });
    dirRow.appendChild(dirLabel);
    dirRow.appendChild(dirInput);
    if (!globalThis.inBrowser && globalThis.api?.pickSaveFolder) dirRow.appendChild(browseDirBtn);
    dlWrap.appendChild(dirRow);

    // Catalog picker + URL + subfolder + download
    const catRow = document.createElement('div');
    catRow.className = 'video-row';
    const catLabel = document.createElement('span');
    catLabel.className = 'video-label';
    catLabel.textContent = getLang().video_dl_pick || 'Pick a model';
    const catSel = document.createElement('select');
    catSel.className = 'video-select';
    catRow.appendChild(catLabel);
    catRow.appendChild(catSel);
    dlWrap.appendChild(catRow);

    const urlRow = document.createElement('div');
    urlRow.className = 'video-row';
    const urlLabel = document.createElement('span');
    urlLabel.className = 'video-label';
    urlLabel.textContent = getLang().video_dl_url || 'or URL';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'video-text';
    urlInput.placeholder = 'https://huggingface.co/.../model.safetensors';
    const subSel = document.createElement('select');
    subSel.className = 'video-select';
    subSel.style.maxWidth = '150px';
    for (const s of ['diffusion_models', 'text_encoders', 'vae', 'clip_vision', 'loras']) {
        const o = document.createElement('option'); o.value = s; o.textContent = s; subSel.appendChild(o);
    }
    urlRow.appendChild(urlLabel);
    urlRow.appendChild(urlInput);
    urlRow.appendChild(subSel);
    dlWrap.appendChild(urlRow);

    let catalog = [];
    catSel.addEventListener('change', () => {
        const item = catalog[Number(catSel.value)];
        if (item) { urlInput.value = item.url; subSel.value = item.subdir; }
    });

    const dlBtnRow = document.createElement('div');
    dlBtnRow.className = 'video-run-row';
    const dlBtn = document.createElement('button');
    dlBtn.className = 'video-btn';
    dlBtn.textContent = getLang().video_dl_btn || 'Download';
    const dlStatus = document.createElement('span');
    dlStatus.className = 'video-status';
    const dlProg = document.createElement('div');
    dlProg.className = 'video-progress';
    dlProg.style.display = 'none';
    const dlProgBar = document.createElement('div');
    dlProgBar.className = 'video-progress-bar';
    dlProg.appendChild(dlProgBar);
    dlBtnRow.appendChild(dlBtn);
    dlBtnRow.appendChild(dlStatus);
    dlWrap.appendChild(dlBtnRow);
    dlWrap.appendChild(dlProg);

    if (globalThis.api?.onComfyVideoDlProgress) {
        globalThis.api.onComfyVideoDlProgress((p) => {
            if (!p || !p.total) { dlStatus.textContent = `${Math.round((p?.received || 0) / 1048576)} MB`; return; }
            dlProg.style.display = 'block';
            dlProgBar.style.width = `${(p.received / p.total) * 100}%`;
            dlStatus.textContent = `${Math.round(p.received / 1048576)} / ${Math.round(p.total / 1048576)} MB`;
        });
    }

    dlBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        const modelsDir = dirInput.value.trim() || globalThis.globalSettings.comfy_models_dir;
        if (!url) { dlStatus.textContent = getLang().video_dl_no_url || 'Pick a model or paste a URL.'; return; }
        if (!modelsDir) { dlStatus.textContent = getLang().video_dl_no_dir || 'Set the ComfyUI models folder first.'; return; }
        dlBtn.disabled = true;
        dlProg.style.display = 'block';
        dlProgBar.style.width = '0%';
        dlStatus.textContent = getLang().video_dl_start || 'Downloading…';
        const res = globalThis.api?.comfyVideoDownloadModel
            ? await globalThis.api.comfyVideoDownloadModel({ url, modelsDir, subdir: subSel.value }).catch(e => ({ ok: false, error: e.message }))
            : { ok: false, error: 'desktop only' };
        dlBtn.disabled = false;
        dlProg.style.display = 'none';
        if (res && res.ok) {
            dlStatus.textContent = res.already
                ? (getLang().video_dl_have || 'Already downloaded ✓')
                : (getLang().video_dl_done || 'Downloaded ✓ — reloading models');
            loadModels();   // refresh dropdowns so the new file is selectable
        } else {
            dlStatus.textContent = (getLang().video_dl_failed || 'Download failed: ') + (res?.error || '?');
        }
    });

    container.appendChild(dlWrap);

    // Load the download catalog.
    if (globalThis.api?.comfyVideoCatalog) {
        globalThis.api.comfyVideoCatalog().then((items) => {
            catalog = items || [];
            catSel.innerHTML = '';
            const def = document.createElement('option'); def.value = ''; def.textContent = '(choose…)'; catSel.appendChild(def);
            catalog.forEach((it, i) => {
                const o = document.createElement('option'); o.value = String(i); o.textContent = it.label; catSel.appendChild(o);
            });
        }).catch(() => {});
    }

    // Run + status
    const runRow = document.createElement('div');
    runRow.className = 'video-run-row';
    const runBtn = document.createElement('button');
    runBtn.className = 'video-run';
    runBtn.textContent = getLang().video_run || 'Animate ▶';
    const status = document.createElement('span');
    status.className = 'video-status';
    runRow.appendChild(runBtn);
    runRow.appendChild(status);
    container.appendChild(runRow);
    function setStatus(t) { status.textContent = t; }

    const progWrap = document.createElement('div');
    progWrap.className = 'video-progress';
    progWrap.style.display = 'none';
    const progBar = document.createElement('div');
    progBar.className = 'video-progress-bar';
    progWrap.appendChild(progBar);
    outBox.appendChild(progWrap);
    function setProgress(pct) {
        if (pct === null) { progWrap.style.display = 'none'; return; }
        progWrap.style.display = 'block';
        progBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }

    // Live sampling progress from ComfyUI's websocket.
    if (globalThis.api?.onComfyVideoProgress) {
        globalThis.api.onComfyVideoProgress((p) => {
            if (!running) return;
            if (p && typeof p.value === 'number' && typeof p.max === 'number' && p.max > 0) {
                setProgress((p.value / p.max) * 100);
            }
        });
    }

    const resultWrap = document.createElement('div');
    resultWrap.className = 'video-result';
    outBox.appendChild(resultWrap);

    // ---- Workflow list + import ----
    async function refreshWorkflows(selectName) {
        const list = await api.list().catch(() => []);
        wfSelect.innerHTML = '';
        if (!list.length) {
            const o = document.createElement('option');
            o.value = ''; o.textContent = getLang().video_no_workflow || '(none — import your API JSON)';
            wfSelect.appendChild(o);
        }
        for (const name of list) {
            const o = document.createElement('option');
            o.value = name; o.textContent = name;
            wfSelect.appendChild(o);
        }
        if (selectName) wfSelect.value = selectName;
    }
    importBtn.addEventListener('click', async () => {
        const json = prompt(getLang().video_import_paste || 'Paste your ComfyUI "Save (API Format)" JSON here:');
        if (!json) return;
        let graph;
        try { graph = JSON.parse(json); } catch { setStatus(getLang().video_bad_json || 'Invalid JSON.'); return; }
        const name = (prompt(getLang().video_import_name || 'Name this workflow:', 'my_wan_i2v') || 'my_wan_i2v').trim();
        const saved = await api.save(name, graph).catch(() => null);
        if (saved) { await refreshWorkflows(saved); setStatus(getLang().video_imported || 'Imported ✓'); }
        else setStatus(getLang().video_import_failed || 'Import failed.');
    });

    // ---- Build prompt + run ----
    function buildPrompt() {
        const parts = [
            motionRow._select.value,
            positionRow._select.value,
            extraInput.value.trim()
        ].map(s => (s || '').trim()).filter(Boolean);
        return parts.join(', ');
    }

    let running = false;
    let timer = null;
    runBtn.addEventListener('click', async () => {
        if (running) return;
        if (!inputImage) { setStatus(getLang().video_no_image || 'Pick an input image first.'); return; }
        if (!wfSelect.value) { setStatus(getLang().video_no_workflow || 'Import a workflow first.'); return; }
        running = true;
        runBtn.disabled = true;
        resultWrap.innerHTML = '';
        setProgress(0);
        const seedVal = Number(seedNum._input.value);
        const seed = (Number.isNaN(seedVal) || seedVal < 0) ? Math.floor(Math.random() * 2 ** 31) : seedVal;
        const start = Date.now();
        timer = setInterval(() => setStatus((getLang().video_running || 'Generating… {0}s').replace('{0}', Math.floor((Date.now() - start) / 1000))), 500);

        const params = {
            workflow: wfSelect.value,
            image: inputImage,
            prompt: buildPrompt(),
            negative: globalThis.globalSettings.video_negative || '',
            width: Number(wNum._input.value),
            height: Number(hNum._input.value),
            length: Number(lenNum._input.value),
            fps: Number(fpsNum._input.value),
            steps: Number(stepsNum._input.value),
            cfg: Number(cfgNum._input.value),
            seed,
            modelName: modelField._input.value.trim() || undefined,
            modelNameLow: modelLowField._input.value.trim() || undefined,
            clipName: clipField._input.value.trim() || undefined,
            vaeName: vaeField._input.value.trim() || undefined,
            loraName: loraField._input.value.trim() || undefined,
            extraLoraName: elSel.value.trim() || undefined,
            extraLoraStrength: Number(elStrength.value) || 1.0,
            addr: (addrInput.value.trim() || globalThis.globalSettings.video_comfy_addr || '127.0.0.1:8000')
        };

        const res = await api.run(params).catch(err => ({ ok: false, error: err.message }));
        clearInterval(timer);
        running = false;
        runBtn.disabled = false;
        setProgress(null);
        if (res && res.ok && res.dataUrl) {
            setStatus((getLang().video_done || 'Done in {0}s').replace('{0}', Math.floor((Date.now() - start) / 1000)));
            resultWrap.innerHTML = '';
            if (res.isImageFormat) {
                const img = document.createElement('img');
                img.className = 'video-out';
                img.src = res.dataUrl;
                resultWrap.appendChild(img);
            } else {
                const vid = document.createElement('video');
                vid.className = 'video-out';
                vid.src = res.dataUrl;
                vid.controls = true; vid.loop = true; vid.autoplay = true; vid.muted = true;
                resultWrap.appendChild(vid);
            }
            if (res.path) {
                const p = document.createElement('div');
                p.className = 'video-saved-path';
                p.textContent = (getLang().video_saved || 'Saved: {0}').replace('{0}', res.path);
                resultWrap.appendChild(p);
            }
        } else {
            setStatus((getLang().video_error || 'Error: {0}').replace('{0}', res?.error || 'unknown'));
        }
    });

    // ---- Scene / position list editor ----
    let editorPopup = null;
    function closeSceneEditor() { if (editorPopup) { editorPopup.remove(); editorPopup = null; } }

    async function persistScenes() {
        await api.saveScenes(scenes).catch(() => {});
        motionRow._rebuild();
        positionRow._rebuild();
    }

    function openSceneEditor() {
        closeSceneEditor();
        let cat = 'motion';
        editorPopup = document.createElement('div');
        editorPopup.className = 'video-editor-popup';

        const header = document.createElement('div');
        header.className = 'video-editor-header';
        const title = document.createElement('span');
        title.textContent = getLang().video_edit_title || 'Edit scene / position lists';
        const close = document.createElement('button');
        close.className = 'video-editor-close';
        close.textContent = '✕';
        close.addEventListener('click', closeSceneEditor);
        header.appendChild(title);
        header.appendChild(close);
        editorPopup.appendChild(header);

        const catRow = document.createElement('div');
        catRow.className = 'video-row';
        const catSel = document.createElement('select');
        catSel.className = 'video-select';
        for (const [val, label] of [['motion', getLang().video_scene || 'Scene / motion'], ['position', getLang().video_position || 'Position']]) {
            const o = document.createElement('option');
            o.value = val; o.textContent = label;
            catSel.appendChild(o);
        }
        catRow.appendChild(catSel);
        editorPopup.appendChild(catRow);

        const listEl = document.createElement('div');
        listEl.className = 'video-editor-list';
        editorPopup.appendChild(listEl);

        function buildRows() {
            listEl.innerHTML = '';
            if (!Array.isArray(scenes[cat])) scenes[cat] = [];
            const arr = scenes[cat];
            for (let i = 0; i < arr.length; i++) {
                const row = document.createElement('div');
                row.className = 'video-editor-row';
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'video-text';
                input.value = arr[i];
                input.addEventListener('change', async () => { arr[i] = input.value.trim(); await persistScenes(); });
                const del = document.createElement('button');
                del.className = 'video-editor-del';
                del.textContent = '✕';
                del.addEventListener('click', async () => { arr.splice(i, 1); buildRows(); await persistScenes(); });
                row.appendChild(input);
                row.appendChild(del);
                listEl.appendChild(row);
            }
        }
        catSel.addEventListener('change', () => { cat = catSel.value; buildRows(); });
        buildRows();

        const addBtn = document.createElement('button');
        addBtn.className = 'video-btn';
        addBtn.textContent = getLang().video_edit_add || '+ Add entry';
        addBtn.addEventListener('click', () => {
            scenes[cat].push('');
            buildRows();
            const inputs = listEl.querySelectorAll('input');
            if (inputs.length) inputs[inputs.length - 1].focus();
        });
        editorPopup.appendChild(addBtn);

        document.body.appendChild(editorPopup);
    }

    // ---- Load scenes + workflows ----
    (async () => {
        try {
            const resp = await fetch('data/video_scenes.json');
            if (resp.ok) {
                const data = await resp.json();
                if (data && (data.motion || data.position)) scenes = data;
                motionRow._rebuild();
                positionRow._rebuild();
            }
        } catch (err) {
            console.warn(CAT, 'scenes load failed, using defaults', err);
        }
        await refreshWorkflows();
    })();

    return {
        setInputImage: (src) => { inputImage = src; preview.src = src; }
    };
}
