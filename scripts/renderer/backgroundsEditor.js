import { sendWebSocketMessage } from '../../webserver/front/wsRequest.js';

const CAT = '[backgroundsEditor]';

// Editor for the "background" list inside view_tags.json. Add / remove / edit
// the entries that populate the background view-tag dropdown. Edits are saved
// back to the data file and the dropdown is refreshed in place.
export function setupBackgroundsEditor(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    function getList() {
        const viewTags = globalThis.cachedFiles.viewTags;
        if (!Array.isArray(viewTags.background)) viewTags.background = [];
        return viewTags.background;
    }

    async function persist() {
        const viewTags = globalThis.cachedFiles.viewTags;
        try {
            if (globalThis.inBrowser) {
                await sendWebSocketMessage({ type: 'API', method: 'saveViewTags', params: [viewTags] });
            } else {
                await globalThis.api.saveViewTags(viewTags);
            }
        } catch (err) {
            console.error(CAT, 'Failed to save view_tags.json:', err);
        }
        refreshDropdown();
    }

    // Rebuild the view dropdowns from the updated tags, preserving the user's
    // current selections where still valid.
    function refreshDropdown() {
        if (!globalThis.viewList) return;
        const LANG = getLang();
        const labelPrefixList = `${LANG.view_angle},${LANG.view_camera},${LANG.view_background},${LANG.view_style}`;
        let sel = globalThis.viewList.getValue();
        if (!Array.isArray(sel)) sel = [sel];
        globalThis.viewList.setOptions(
            globalThis.cachedFiles.viewTags, null, labelPrefixList,
            sel[0] || 'None', sel[1] || 'None', sel[2] || 'None', sel[3] || 'None', false
        );
    }

    function render() {
        container.innerHTML = '';
        container.classList.add('backgrounds-list');

        const list = getList();
        for (let i = 0; i < list.length; i++) {
            container.appendChild(createRow(i));
        }

        const addButton = document.createElement('button');
        addButton.className = 'backgrounds-add';
        addButton.textContent = getLang().backgrounds_add || '+ Add Background';
        addButton.addEventListener('click', async () => {
            getList().push('');
            render();
            // Focus the new empty input for immediate typing.
            const inputs = container.querySelectorAll('.backgrounds-input');
            if (inputs.length) inputs[inputs.length - 1].focus();
        });
        container.appendChild(addButton);
    }

    function createRow(index) {
        const list = getList();
        const row = document.createElement('div');
        row.className = 'backgrounds-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'backgrounds-input';
        input.value = list[index];
        input.placeholder = getLang().backgrounds_placeholder || 'Background tags';

        const commit = async () => {
            const newVal = input.value.trim();
            if (newVal === list[index]) return;
            list[index] = newVal;
            await persist();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

        const delBtn = document.createElement('button');
        delBtn.className = 'backgrounds-delete';
        delBtn.textContent = '✕';
        delBtn.title = getLang().backgrounds_delete || 'Remove';
        delBtn.addEventListener('click', async () => {
            getList().splice(index, 1);
            render();
            await persist();
        });

        row.appendChild(input);
        row.appendChild(delBtn);
        return row;
    }

    render();

    return { render, refresh: render };
}
