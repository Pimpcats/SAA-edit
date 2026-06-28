import { sendWebSocketMessage } from '../../webserver/front/wsRequest.js';

const CAT = '[backgroundsEditor]';

// Editor for the "background" entries shown in the background view-tag
// dropdown. Opens a popup window where you can add/remove/edit infinite
// background prompts; changes are saved to view_tags.json and the dropdown
// refreshes in place (preserving current selections).
export function setupBackgroundsEditor(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    let currentCategory = 'background';

    function getList() {
        const viewTags = globalThis.cachedFiles.viewTags;
        if (!Array.isArray(viewTags[currentCategory])) viewTags[currentCategory] = [];
        return viewTags[currentCategory];
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

    // Rebuild the view dropdowns from the updated tags, preserving selections.
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

    let popup = null;

    function closePopup() {
        if (popup) { popup.remove(); popup = null; }
    }

    function buildRows(listEl) {
        listEl.innerHTML = '';
        const list = getList();
        for (let i = 0; i < list.length; i++) {
            const row = document.createElement('div');
            row.className = 'backgrounds-row';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'backgrounds-input';
            input.value = list[i];
            input.placeholder = getLang().backgrounds_placeholder || 'Background prompt';
            input.addEventListener('change', async () => {
                if (input.value.trim() === list[i]) return;
                list[i] = input.value.trim();
                await persist();
            });
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
            const del = document.createElement('button');
            del.className = 'backgrounds-delete';
            del.textContent = '✕';
            del.title = getLang().backgrounds_delete || 'Remove';
            del.addEventListener('click', async () => {
                getList().splice(i, 1);
                buildRows(listEl);
                await persist();
            });
            row.appendChild(input);
            row.appendChild(del);
            listEl.appendChild(row);
        }
    }

    function openPopup() {
        closePopup();
        const LANG = getLang();

        popup = document.createElement('div');
        popup.className = 'backgrounds-popup';

        const header = document.createElement('div');
        header.className = 'backgrounds-popup-header';
        const title = document.createElement('span');
        title.textContent = LANG.view_tags_title || 'Edit View Tags';
        const close = document.createElement('button');
        close.className = 'backgrounds-popup-close';
        close.textContent = '✕';
        close.addEventListener('click', closePopup);
        header.appendChild(title);
        header.appendChild(close);
        popup.appendChild(header);

        const listEl = document.createElement('div');
        listEl.className = 'backgrounds-popup-list';

        // Category selector: Angle / Camera / Background / Style
        const catRow = document.createElement('div');
        catRow.className = 'backgrounds-popup-catrow';
        const catLabel = document.createElement('span');
        catLabel.textContent = LANG.view_tags_category || 'List:';
        const catSelect = document.createElement('select');
        catSelect.className = 'backgrounds-cat-select';
        const cats = [
            ['angle', LANG.view_angle || 'Angle'],
            ['camera', LANG.view_camera || 'Camera'],
            ['background', LANG.view_background || 'Background'],
            ['style', LANG.view_style || 'Style']
        ];
        for (const [val, label] of cats) {
            const o = document.createElement('option');
            o.value = val;
            o.textContent = label;
            catSelect.appendChild(o);
        }
        catSelect.value = currentCategory;
        catSelect.addEventListener('change', () => {
            currentCategory = catSelect.value;
            buildRows(listEl);
        });
        catRow.appendChild(catLabel);
        catRow.appendChild(catSelect);
        popup.appendChild(catRow);

        buildRows(listEl);
        popup.appendChild(listEl);

        const addBtn = document.createElement('button');
        addBtn.className = 'backgrounds-add';
        addBtn.textContent = LANG.view_tags_add || '+ Add entry';
        addBtn.addEventListener('click', () => {
            getList().push('');
            buildRows(listEl);
            const inputs = listEl.querySelectorAll('.backgrounds-input');
            if (inputs.length) inputs[inputs.length - 1].focus();
        });
        popup.appendChild(addBtn);

        document.body.appendChild(popup);
    }

    // Panel content: a single button that opens the editor popup.
    container.innerHTML = '';
    const editBtn = document.createElement('button');
    editBtn.className = 'backgrounds-add';
    editBtn.textContent = getLang().view_tags_edit || '✎ Edit View Tags';
    editBtn.addEventListener('click', openPopup);
    container.appendChild(editBtn);

    return { open: openPopup, refresh: refreshDropdown };
}
