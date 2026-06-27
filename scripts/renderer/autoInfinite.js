import { callback_generate_start } from './callbacks.js';

// Infinite auto-generate: right-click the "Create Image" button to keep
// generating new images in a loop until turned off (right-click -> Turn off).
export function setupAutoInfinite() {
    const state = { active: false, running: false };
    globalThis.generate = globalThis.generate || {};
    globalThis.generate.autoInfinite = state;

    function updateIndicator() {
        // The cloned floating button shares the same base class, so this also
        // highlights the overlay copy when present.
        for (const btn of document.querySelectorAll('.myButton-generate-button-single')) {
            btn.classList.toggle('auto-infinite-active', state.active);
        }
    }

    async function runLoop() {
        if (state.running) return;
        state.running = true;
        try {
            while (state.active) {
                await callback_generate_start('normal', { loops: 1, runSame: false });
                // A cancel during the run stops the loop.
                if (globalThis.generate.cancelClicked) {
                    state.active = false;
                    break;
                }
            }
        } catch (err) {
            console.error('[autoInfinite] loop error:', err);
        } finally {
            state.running = false;
            updateIndicator();
        }
    }

    function start() {
        if (state.active) return;
        state.active = true;
        updateIndicator();
        runLoop();
    }

    function stop() {
        state.active = false;
        updateIndicator();
    }

    function toggle() {
        if (state.active) stop(); else start();
    }

    let menuEl = null;

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

    function showMenu(x, y) {
        closeMenu();
        const LANG = globalThis.cachedFiles.language[globalThis.globalSettings.language];

        menuEl = document.createElement('div');
        menuEl.className = 'auto-infinite-menu';
        menuEl.style.cssText = 'position:fixed;z-index:10005;background:rgba(17,17,17,0.96);'
            + 'border:2px solid #333;border-radius:8px;padding:6px;color:#eee;'
            + 'box-shadow:0 4px 8px rgba(0,0,0,0.3);min-width:180px;font-size:14px;';

        const item = document.createElement('div');
        item.className = 'auto-infinite-menu-item';
        item.style.cssText = 'padding:8px 12px;cursor:pointer;border-radius:6px;white-space:nowrap;';
        item.textContent = state.active
            ? (LANG.auto_infinite_off || 'Turn off auto-generate')
            : (LANG.auto_infinite_on || 'Auto-generate (infinite)');
        item.addEventListener('mouseover', () => { item.style.backgroundColor = 'rgba(255,255,255,0.12)'; });
        item.addEventListener('mouseout', () => { item.style.backgroundColor = 'transparent'; });
        item.addEventListener('click', () => { toggle(); closeMenu(); });
        menuEl.appendChild(item);

        document.body.appendChild(menuEl);

        // Keep the menu within the viewport.
        const rect = menuEl.getBoundingClientRect();
        const left = Math.min(x, globalThis.innerWidth - rect.width - 8);
        const top = Math.min(y, globalThis.innerHeight - rect.height - 8);
        menuEl.style.left = `${Math.max(8, left)}px`;
        menuEl.style.top = `${Math.max(8, top)}px`;

        setTimeout(() => document.addEventListener('mousedown', onDocMouseDown, true), 0);
    }

    // Delegated capture-phase listener: matches the main Create Image button
    // and its floating clone (both keep .myButton-generate-button-single),
    // and stops the global right-click menu from also opening.
    document.addEventListener('contextmenu', (e) => {
        const single = e.target.closest && e.target.closest('.myButton-generate-button-single');
        if (!single) return;
        e.preventDefault();
        e.stopPropagation();
        showMenu(e.clientX, e.clientY);
    }, true);

    return { start, stop, toggle };
}
