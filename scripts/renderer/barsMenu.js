const CAT = '[settingsPanel]';

// The collapsible "bars" (panels) that can be hidden/shown.
const BARS = [
    ['highres-fix-container', 'Hires Fix'],
    ['refiner-container', 'Refiner'],
    ['controlnet-container', 'ControlNet'],
    ['adetailer-container', 'ADetailer'],
    ['model-settings-container', 'Model Settings'],
    ['add-lora-container', 'LoRA'],
    ['regional-condition-container', 'Regional Condition'],
    ['jsonlist-container', 'JSON/CSV'],
    ['queue-container', 'Queue Manager'],
    ['system-settings-container', 'System Settings'],
    ['custom-toggles-container', 'Custom Toggles'],
    ['backgrounds-container', 'Backgrounds'],
    ['character-editor-container', 'Add Character'],
    ['lora-library-container', 'LoRA Library'],
    ['image-infobox-container', 'Image Info']
];

// Settings-wheel panel: appearance (custom background image) + show/hide bars.
export function setupBarsMenu() {
    const btn = document.getElementById('global-settings-bars-toggle');
    if (!btn) {
        console.error(CAT, 'gear button not found');
        return null;
    }

    function getHidden() {
        const S = globalThis.globalSettings;
        if (!Array.isArray(S.hidden_bars)) S.hidden_bars = [];
        return S.hidden_bars;
    }

    function applyHidden() {
        const hidden = new Set(getHidden());
        for (const [cls] of BARS) {
            const el = document.querySelector(`.${cls}`);
            if (el) el.style.display = hidden.has(cls) ? 'none' : '';
        }
    }

    // Custom UI background image (shown in the empty/black space).
    function applyBackground() {
        const url = globalThis.globalSettings.ui_background_image || '';
        const fb = document.getElementById('full-body');
        if (!fb) return;
        if (url) {
            fb.style.backgroundImage = `url(${url})`;
            fb.style.backgroundSize = 'cover';
            fb.style.backgroundPosition = 'center';
            fb.style.backgroundRepeat = 'no-repeat';
        } else {
            fb.style.backgroundImage = '';
        }
    }

    let panel = null;
    function close() {
        if (panel) {
            panel.remove();
            panel = null;
            document.removeEventListener('mousedown', onDoc, true);
        }
    }
    function onDoc(e) {
        if (panel && !panel.contains(e.target) && e.target !== btn) close();
    }

    function sectionTitle(text) {
        const t = document.createElement('div');
        t.className = 'settings-panel-section';
        t.textContent = text;
        return t;
    }

    function open() {
        close();
        const LANG = globalThis.cachedFiles.language[globalThis.globalSettings.language];
        panel = document.createElement('div');
        panel.className = 'bars-menu settings-panel';

        const title = document.createElement('div');
        title.className = 'bars-menu-title';
        title.textContent = LANG.settings_panel_title || 'Settings';
        panel.appendChild(title);

        // --- Appearance: custom background image ---
        panel.appendChild(sectionTitle(LANG.settings_background || 'Background image'));
        const bgRow = document.createElement('div');
        bgRow.className = 'settings-panel-bgrow';
        const upload = document.createElement('button');
        upload.className = 'bars-menu-restore';
        upload.textContent = LANG.settings_background_upload || 'Upload image';
        const clear = document.createElement('button');
        clear.className = 'bars-menu-restore';
        clear.textContent = LANG.settings_background_clear || 'Clear';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        upload.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                globalThis.globalSettings.ui_background_image = reader.result;
                applyBackground();
            };
            reader.readAsDataURL(file);
        });
        clear.addEventListener('click', () => {
            globalThis.globalSettings.ui_background_image = '';
            applyBackground();
        });
        bgRow.appendChild(upload);
        bgRow.appendChild(clear);
        bgRow.appendChild(fileInput);
        panel.appendChild(bgRow);

        // --- Features ---
        panel.appendChild(sectionTitle(LANG.settings_features || 'Features'));
        const miraRow = document.createElement('label');
        miraRow.className = 'bars-menu-row';
        const miraCb = document.createElement('input');
        miraCb.type = 'checkbox';
        miraCb.checked = !!globalThis.globalSettings.mira_itu_enable;
        miraCb.addEventListener('change', () => {
            globalThis.globalSettings.mira_itu_enable = miraCb.checked;
        });
        const miraSpan = document.createElement('span');
        miraSpan.textContent = LANG.settings_mira_itu || 'MiraITU image tile on drag-drop (ComfyUI)';
        miraRow.appendChild(miraCb);
        miraRow.appendChild(miraSpan);
        panel.appendChild(miraRow);

        // Floating duplicate Create Image / Batch buttons (off by default).
        const floatRow = document.createElement('label');
        floatRow.className = 'bars-menu-row';
        const floatCb = document.createElement('input');
        floatCb.type = 'checkbox';
        floatCb.checked = !!globalThis.globalSettings.floating_buttons_enable;
        floatCb.addEventListener('change', () => {
            globalThis.globalSettings.floating_buttons_enable = floatCb.checked;
            globalThis.floatingButtons?.refresh?.();
            globalThis.dockGenerate?.refresh?.();
        });
        const floatSpan = document.createElement('span');
        floatSpan.textContent = LANG.settings_floating_buttons || 'Float the Generate buttons (instead of docked)';
        floatRow.appendChild(floatCb);
        floatRow.appendChild(floatSpan);
        panel.appendChild(floatRow);

        // Auto-save each generation (with embedded settings) to the output folder.
        const saveRow = document.createElement('label');
        saveRow.className = 'bars-menu-row';
        const saveCb = document.createElement('input');
        saveCb.type = 'checkbox';
        saveCb.checked = !!globalThis.globalSettings.auto_save_generated;
        saveCb.addEventListener('change', () => {
            globalThis.globalSettings.auto_save_generated = saveCb.checked;
        });
        const saveSpan = document.createElement('span');
        saveSpan.textContent = LANG.settings_auto_save || 'Auto-save generated images (with settings)';
        saveRow.appendChild(saveCb);
        saveRow.appendChild(saveSpan);
        panel.appendChild(saveRow);

        // --- Show / hide bars ---
        panel.appendChild(sectionTitle(LANG.bars_menu_title || 'Show / hide bars'));
        const hidden = new Set(getHidden());
        for (const [cls, label] of BARS) {
            if (!document.querySelector(`.${cls}`)) continue;
            const row = document.createElement('label');
            row.className = 'bars-menu-row';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !hidden.has(cls);
            cb.addEventListener('change', () => {
                const arr = getHidden();
                if (cb.checked) {
                    const i = arr.indexOf(cls);
                    if (i >= 0) arr.splice(i, 1);
                } else if (!arr.includes(cls)) {
                    arr.push(cls);
                }
                applyHidden();
            });
            const span = document.createElement('span');
            span.textContent = label;
            row.appendChild(cb);
            row.appendChild(span);
            panel.appendChild(row);
        }

        const restore = document.createElement('button');
        restore.className = 'bars-menu-restore';
        restore.textContent = LANG.bars_menu_restore || 'Restore all bars';
        restore.addEventListener('click', () => {
            globalThis.globalSettings.hidden_bars = [];
            applyHidden();
            open();
        });
        panel.appendChild(restore);

        const r = btn.getBoundingClientRect();
        panel.style.top = `${r.bottom + 4}px`;
        panel.style.right = `${Math.max(8, globalThis.innerWidth - r.right)}px`;
        document.body.appendChild(panel);
        setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel) close(); else open();
    });

    applyHidden();
    applyBackground();
    return { applyHidden, applyBackground };
}
