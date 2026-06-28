import { callback_generate_start } from './callbacks.js';
import { generateRandomSeed } from './generate.js';

// Batch seed variations: right-click the batch "Create Image" button to spin off
// a batch of close-but-not-identical variations of a seed you like. It keeps the
// base seed fixed and blends in a small, per-image "subseed" at a low strength
// (A1111 variation seed). Low strength = barely different; higher = more drift.
export function setupSeedVariations() {
    globalThis.generate = globalThis.generate || {};

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    let menuEl = null;
    let popupEl = null;

    function closeMenu() {
        if (menuEl) {
            menuEl.remove();
            menuEl = null;
            document.removeEventListener('mousedown', onDocMouseDown, true);
        }
    }

    function onDocMouseDown(e) {
        if (menuEl && !menuEl.contains(e.target)) closeMenu();
    }

    function closePopup() {
        if (popupEl) { popupEl.remove(); popupEl = null; }
    }

    function showMenu(x, y) {
        closeMenu();
        const LANG = getLang();

        menuEl = document.createElement('div');
        menuEl.className = 'auto-infinite-menu';
        menuEl.style.cssText = 'position:fixed;z-index:10005;background:rgba(17,17,17,0.96);'
            + 'border:2px solid #333;border-radius:8px;padding:6px;color:#eee;'
            + 'box-shadow:0 4px 8px rgba(0,0,0,0.3);min-width:200px;font-size:14px;';

        const item = document.createElement('div');
        item.className = 'auto-infinite-menu-item';
        item.style.cssText = 'padding:8px 12px;cursor:pointer;border-radius:6px;white-space:nowrap;';
        item.textContent = LANG.seed_variations_menu || 'Batch variations of this seed…';
        item.addEventListener('mouseover', () => { item.style.backgroundColor = 'rgba(255,255,255,0.12)'; });
        item.addEventListener('mouseout', () => { item.style.backgroundColor = 'transparent'; });
        item.addEventListener('click', () => { closeMenu(); openPopup(); });
        menuEl.appendChild(item);

        document.body.appendChild(menuEl);

        const rect = menuEl.getBoundingClientRect();
        const left = Math.min(x, globalThis.innerWidth - rect.width - 8);
        const top = Math.min(y, globalThis.innerHeight - rect.height - 8);
        menuEl.style.left = `${Math.max(8, left)}px`;
        menuEl.style.top = `${Math.max(8, top)}px`;

        setTimeout(() => document.addEventListener('mousedown', onDocMouseDown, true), 0);
    }

    function openPopup() {
        closePopup();
        const LANG = getLang();

        // Resolve the base seed: use the seed field if set, otherwise roll one
        // and write it back so the batch (and the UI) are pinned to it.
        let base = globalThis.generate.seed.getValue();
        if (base === -1 || base === '' || base === null || base === undefined || Number.isNaN(Number(base))) {
            base = generateRandomSeed();
            globalThis.generate.seed.setValue(base);
        }
        base = Number(base);

        popupEl = document.createElement('div');
        popupEl.className = 'seed-variations-popup';

        const header = document.createElement('div');
        header.className = 'seed-variations-header';
        const title = document.createElement('span');
        title.textContent = LANG.seed_variations_title || 'Batch seed variations';
        const close = document.createElement('button');
        close.className = 'seed-variations-close';
        close.textContent = '✕';
        close.addEventListener('click', closePopup);
        header.appendChild(title);
        header.appendChild(close);
        popupEl.appendChild(header);

        const seedRow = document.createElement('div');
        seedRow.className = 'seed-variations-row';
        seedRow.textContent = `${LANG.seed_variations_base || 'Base seed'}: ${base}`;
        popupEl.appendChild(seedRow);

        // Count
        const countRow = document.createElement('div');
        countRow.className = 'seed-variations-row';
        const countLabel = document.createElement('span');
        countLabel.textContent = LANG.seed_variations_count || 'How many';
        const countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.min = '1';
        countInput.max = '64';
        countInput.value = '8';
        countInput.className = 'seed-variations-count';
        countRow.appendChild(countLabel);
        countRow.appendChild(countInput);
        popupEl.appendChild(countRow);

        // Strength slider
        const strRow = document.createElement('div');
        strRow.className = 'seed-variations-row';
        const strLabel = document.createElement('span');
        const strVal = document.createElement('span');
        strVal.className = 'seed-variations-strval';
        const strInput = document.createElement('input');
        strInput.type = 'range';
        strInput.min = '5';
        strInput.max = '60';
        strInput.step = '1';
        strInput.value = '15';
        strInput.className = 'seed-variations-strength';
        const fmt = () => {
            const v = Number(strInput.value) / 100;
            let hint = LANG.seed_variations_subtle || 'subtle';
            if (v >= 0.4) hint = LANG.seed_variations_strong || 'strong';
            else if (v >= 0.22) hint = LANG.seed_variations_moderate || 'moderate';
            strLabel.textContent = `${LANG.seed_variations_strength || 'Variation strength'}`;
            strVal.textContent = `${v.toFixed(2)} (${hint})`;
        };
        strInput.addEventListener('input', fmt);
        fmt();
        strRow.appendChild(strLabel);
        strRow.appendChild(strVal);
        popupEl.appendChild(strRow);
        popupEl.appendChild(strInput);

        const hint = document.createElement('div');
        hint.className = 'seed-variations-hint';
        hint.textContent = LANG.seed_variations_hint
            || 'Same seed + prompt, with a small random subseed per image. Low = nearly identical, high = drifts further.';
        popupEl.appendChild(hint);

        const goBtn = document.createElement('button');
        goBtn.className = 'seed-variations-go';
        goBtn.textContent = LANG.seed_variations_go || 'Generate variations';
        goBtn.addEventListener('click', () => {
            const count = Math.max(1, Math.min(64, parseInt(countInput.value, 10) || 1));
            const strength = Math.max(0.01, Math.min(0.95, Number(strInput.value) / 100));
            closePopup();
            globalThis.generate.variation = { active: true, base, strength };
            // runSame:false rebuilds the prompt, but with the seed pinned it is
            // identical each loop — only the subseed changes between images.
            callback_generate_start('normal', { loops: count, runSame: false });
        });
        popupEl.appendChild(goBtn);

        document.body.appendChild(popupEl);
    }

    // Right-click the batch Create Image button (and its floating clone, which
    // shares the base class). Stops the global context menu from also opening.
    document.addEventListener('contextmenu', (e) => {
        const batch = e.target.closest && e.target.closest('.myButton-generate-button-batch');
        if (!batch) return;
        e.preventDefault();
        e.stopPropagation();
        showMenu(e.clientX, e.clientY);
    }, true);

    return { open: openPopup };
}
