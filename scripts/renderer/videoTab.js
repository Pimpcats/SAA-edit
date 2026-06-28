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
    imgRow.appendChild(preview);
    imgRow.appendChild(imgBtns);
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
    function fileField(label, ph, settingKey, def) {
        const row = document.createElement('div');
        row.className = 'video-row';
        const l = document.createElement('span'); l.className = 'video-label'; l.textContent = label;
        const i = document.createElement('input');
        i.type = 'text'; i.className = 'video-text'; i.placeholder = ph;
        i.value = globalThis.globalSettings[settingKey] || def || '';
        i.addEventListener('change', () => { globalThis.globalSettings[settingKey] = i.value.trim(); });
        row.appendChild(l); row.appendChild(i);
        row._input = i;
        return row;
    }
    const modelField = fileField(getLang().video_model || 'Diffusion model', 'wan2.x i2v .safetensors', 'video_model_name', '');
    const clipField = fileField(getLang().video_clip || 'Text encoder (CLIP)', 'umt5_xxl_*.safetensors', 'video_clip_name', '');
    const vaeField = fileField(getLang().video_vae || 'VAE', 'wan_2.1_vae.safetensors', 'video_vae_name', '');
    const loraField = fileField(getLang().video_lora || 'Speed LoRA', 'lightx2v / lightning .safetensors', 'video_lora_name', '');
    for (const r of [modelField, clipField, vaeField, loraField]) modelsWrap.appendChild(r);
    container.appendChild(modelsWrap);

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

    const resultWrap = document.createElement('div');
    resultWrap.className = 'video-result';
    container.appendChild(resultWrap);

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
            clipName: clipField._input.value.trim() || undefined,
            vaeName: vaeField._input.value.trim() || undefined,
            loraName: loraField._input.value.trim() || undefined,
            addr: globalThis.generate?.api_address?.getValue?.() || globalThis.globalSettings.api_addr
        };

        const res = await api.run(params).catch(err => ({ ok: false, error: err.message }));
        clearInterval(timer);
        running = false;
        runBtn.disabled = false;
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
