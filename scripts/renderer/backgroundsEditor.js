const CAT = '[backgroundsEditor]';

// Background toggles. Each entry has editable text and an on/off state. When a
// background is toggled ON, its text is added to the common (orange) prompt at
// generate time. Stored per settings-preset in globalSettings.background_toggles.
export function setupBackgroundsEditor(containerId) {
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
        if (!Array.isArray(S.background_toggles)) S.background_toggles = [];
        // One-time seed from the existing view_tags background list so the
        // user's previous backgrounds become toggles instead of being lost.
        if (!S.background_toggles_seeded) {
            const seed = (globalThis.cachedFiles?.viewTags?.background) || [];
            if (S.background_toggles.length === 0 && seed.length > 0) {
                S.background_toggles = seed.map(text => ({ text, on: false }));
            }
            S.background_toggles_seeded = true;
        }
        return S.background_toggles;
    }

    function render() {
        container.innerHTML = '';
        container.classList.add('backgrounds-list');

        const data = getData();
        for (let i = 0; i < data.length; i++) {
            container.appendChild(createRow(data[i], i));
        }

        const addButton = document.createElement('button');
        addButton.className = 'backgrounds-add';
        addButton.textContent = getLang().backgrounds_add || '+ Add Background';
        addButton.addEventListener('click', () => {
            getData().push({ text: '', on: false });
            render();
            const inputs = container.querySelectorAll('.backgrounds-input');
            if (inputs.length) inputs[inputs.length - 1].focus();
        });
        container.appendChild(addButton);
    }

    function createRow(bg, index) {
        const row = document.createElement('div');
        row.className = `backgrounds-row${bg.on ? ' active' : ''}`;

        const toggle = document.createElement('button');
        toggle.className = `backgrounds-toggle${bg.on ? ' active' : ''}`;
        toggle.title = getLang().backgrounds_toggle || 'Toggle into prompt';
        toggle.textContent = bg.on ? '●' : '○';
        toggle.addEventListener('click', () => {
            bg.on = !bg.on;
            toggle.textContent = bg.on ? '●' : '○';
            toggle.classList.toggle('active', bg.on);
            row.classList.toggle('active', bg.on);
        });

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'backgrounds-input';
        input.value = bg.text;
        input.placeholder = getLang().backgrounds_placeholder || 'Background tags';
        input.addEventListener('change', () => { bg.text = input.value.trim(); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

        const delBtn = document.createElement('button');
        delBtn.className = 'backgrounds-delete';
        delBtn.textContent = '✕';
        delBtn.title = getLang().backgrounds_delete || 'Remove';
        delBtn.addEventListener('click', () => {
            getData().splice(index, 1);
            render();
        });

        row.appendChild(toggle);
        row.appendChild(input);
        row.appendChild(delBtn);
        return row;
    }

    render();

    return {
        render,
        getValues: () => getData(),
        setValues: (values) => {
            globalThis.globalSettings.background_toggles = Array.isArray(values) ? values : [];
            render();
        },
        // Text of all toggled-on backgrounds, joined for the prompt.
        getActivePrompt: () => {
            return getData()
                .filter(b => b && b.on && typeof b.text === 'string' && b.text.trim() !== '')
                .map(b => b.text.trim())
                .join(', ');
        }
    };
}
