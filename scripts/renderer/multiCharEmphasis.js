const CAT = '[multiCharEmphasis]';

// Mini editable "checkmark bars" for the multi-character emphasis. Each entry
// has editable text and a checkmark; when the feature is enabled and 2+
// characters are selected, every checked entry's text is prepended to the
// character prompt.
export function setupMultiCharEmphasisList(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    function getData() {
        const S = globalThis.globalSettings;
        if (!Array.isArray(S.multi_char_emphasis_list)) S.multi_char_emphasis_list = [];
        // Seed once from the legacy single-tag field so nothing is lost.
        if (!S.multi_char_emphasis_seeded) {
            if (S.multi_char_emphasis_list.length === 0) {
                const legacy = (S.multi_char_emphasis_tag || '').split(',').map(t => t.trim()).filter(Boolean);
                S.multi_char_emphasis_list = legacy.map(tag => ({ tag, on: true }));
            }
            S.multi_char_emphasis_seeded = true;
        }
        return S.multi_char_emphasis_list;
    }

    function render() {
        container.innerHTML = '';
        container.classList.add('mce-list');

        const data = getData();
        for (let i = 0; i < data.length; i++) {
            container.appendChild(createRow(data[i], i));
        }

        const addBtn = document.createElement('button');
        addBtn.className = 'mce-add';
        addBtn.textContent = getLang().mce_add || '+ Add tag';
        addBtn.addEventListener('click', () => {
            getData().push({ tag: '', on: true });
            render();
            const inputs = container.querySelectorAll('.mce-input');
            if (inputs.length) inputs[inputs.length - 1].focus();
        });
        container.appendChild(addBtn);
    }

    function createRow(entry, index) {
        const row = document.createElement('div');
        row.className = `mce-row${entry.on ? ' active' : ''}`;

        const check = document.createElement('button');
        check.className = `mce-check${entry.on ? ' active' : ''}`;
        check.textContent = entry.on ? '☑' : '☐';
        check.title = getLang().mce_toggle || 'Enable this tag';
        check.addEventListener('click', () => {
            entry.on = !entry.on;
            check.textContent = entry.on ? '☑' : '☐';
            check.classList.toggle('active', entry.on);
            row.classList.toggle('active', entry.on);
        });

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'mce-input';
        input.value = entry.tag;
        input.placeholder = getLang().mce_placeholder || 'e.g. 2girls';
        input.addEventListener('change', () => { entry.tag = input.value.trim(); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

        const del = document.createElement('button');
        del.className = 'mce-delete';
        del.textContent = '✕';
        del.addEventListener('click', () => { getData().splice(index, 1); render(); });

        row.appendChild(check);
        row.appendChild(input);
        row.appendChild(del);
        return row;
    }

    render();

    return {
        render,
        refresh: render,
        getActiveTags: () => getData()
            .filter(e => e && e.on && typeof e.tag === 'string' && e.tag.trim() !== '')
            .map(e => e.tag.trim())
            .join(', ')
    };
}
