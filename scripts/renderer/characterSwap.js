import { callback_myCharacterList_updateThumb } from './callbacks.js';

const CAT = '[characterSwap]';

// Compact control to swap the contents of any two character slots (1-4).
export function setupCharacterSwap(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    container.innerHTML = '';
    container.classList.add('character-swap');

    const label = document.createElement('span');
    label.className = 'character-swap-label';
    label.textContent = getLang().character_swap || 'Swap slots:';

    const selA = document.createElement('select');
    const selB = document.createElement('select');
    selA.className = 'character-swap-select';
    selB.className = 'character-swap-select';
    for (let i = 1; i <= 4; i++) {
        for (const sel of [selA, selB]) {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = String(i);
            sel.appendChild(o);
        }
    }
    selA.value = '1';
    selB.value = '2';

    const arrow = document.createElement('span');
    arrow.className = 'character-swap-arrow';
    arrow.textContent = '⇄';

    const btn = document.createElement('button');
    btn.className = 'character-swap-btn';
    btn.textContent = getLang().character_swap_btn || 'Swap';
    btn.addEventListener('click', async () => {
        const a = Number.parseInt(selA.value) - 1;
        const b = Number.parseInt(selB.value) - 1;
        if (globalThis.characterList?.swapSlots) {
            globalThis.characterList.swapSlots(a, b);
            try { await callback_myCharacterList_updateThumb(); } catch (err) { console.error(CAT, err); }
        }
    });

    container.appendChild(label);
    container.appendChild(selA);
    container.appendChild(arrow);
    container.appendChild(selB);
    container.appendChild(btn);

    return {};
}
