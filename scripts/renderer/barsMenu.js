const CAT = '[barsMenu]';

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

// Settings-wheel menu to hide/show bars, with a "restore all" option.
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

    let menu = null;
    function close() {
        if (menu) {
            menu.remove();
            menu = null;
            document.removeEventListener('mousedown', onDoc, true);
        }
    }
    function onDoc(e) {
        if (menu && !menu.contains(e.target) && e.target !== btn) close();
    }

    function open() {
        close();
        const LANG = globalThis.cachedFiles.language[globalThis.globalSettings.language];
        menu = document.createElement('div');
        menu.className = 'bars-menu';

        const title = document.createElement('div');
        title.className = 'bars-menu-title';
        title.textContent = LANG.bars_menu_title || 'Show / hide bars';
        menu.appendChild(title);

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
            menu.appendChild(row);
        }

        const restore = document.createElement('button');
        restore.className = 'bars-menu-restore';
        restore.textContent = LANG.bars_menu_restore || 'Restore all bars';
        restore.addEventListener('click', () => {
            globalThis.globalSettings.hidden_bars = [];
            applyHidden();
            open();
        });
        menu.appendChild(restore);

        const r = btn.getBoundingClientRect();
        menu.style.top = `${r.bottom + 4}px`;
        menu.style.right = `${Math.max(8, globalThis.innerWidth - r.right)}px`;
        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu) close(); else open();
    });

    applyHidden();
    return { applyHidden };
}
