const CAT = '[customToggles]';

// User-definable prompt toggles. Each toggle has a custom name and content;
// when turned on, its content is contributed to the positive prompt at
// generate time, wrapped as (((content:1))).
export function setupCustomToggles(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    function getData() {
        const SETTINGS = globalThis.globalSettings;
        if (!Array.isArray(SETTINGS.custom_toggles)) SETTINGS.custom_toggles = [];
        return SETTINGS.custom_toggles;
    }

    function render() {
        container.innerHTML = '';
        container.classList.add('custom-toggles-list');

        const data = getData();
        for (let i = 0; i < data.length; i++) {
            container.appendChild(createRow(data[i], i));
        }

        const addButton = document.createElement('button');
        addButton.className = 'custom-toggle-add';
        addButton.textContent = getLang().custom_toggle_add || '+ Add Toggle';
        addButton.addEventListener('click', () => {
            data.push({ name: getLang().custom_toggle_new || 'New', content: '', on: false });
            render();
        });
        container.appendChild(addButton);
    }

    function createRow(toggle, index) {
        const row = document.createElement('div');
        row.className = 'custom-toggle-row';

        const chip = document.createElement('button');
        chip.className = `custom-toggle-chip${toggle.on ? ' active' : ''}`;
        chip.textContent = toggle.name || '(unnamed)';
        chip.title = toggle.content || '';
        chip.addEventListener('click', () => {
            toggle.on = !toggle.on;
            chip.classList.toggle('active', toggle.on);
        });
        row.appendChild(chip);

        const editBtn = document.createElement('button');
        editBtn.className = 'custom-toggle-edit';
        editBtn.textContent = '✎';
        editBtn.title = getLang().custom_toggle_edit || 'Edit';
        editBtn.addEventListener('click', () => openEditor(row, toggle, chip));
        row.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'custom-toggle-delete';
        delBtn.textContent = '✕';
        delBtn.title = getLang().custom_toggle_delete || 'Delete';
        delBtn.addEventListener('click', () => {
            getData().splice(index, 1);
            render();
        });
        row.appendChild(delBtn);

        return row;
    }

    function openEditor(row, toggle, chip) {
        if (row.querySelector('.custom-toggle-editor')) return;

        const editor = document.createElement('div');
        editor.className = 'custom-toggle-editor';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'custom-toggle-name-input';
        nameInput.placeholder = getLang().custom_toggle_name_ph || 'Name';
        nameInput.value = toggle.name || '';

        const contentInput = document.createElement('input');
        contentInput.type = 'text';
        contentInput.className = 'custom-toggle-content-input';
        contentInput.placeholder = getLang().custom_toggle_content_ph || 'Tags to add when on';
        contentInput.value = toggle.content || '';

        const doneBtn = document.createElement('button');
        doneBtn.className = 'custom-toggle-done';
        doneBtn.textContent = '✓';

        const apply = () => {
            toggle.name = nameInput.value.trim() || '(unnamed)';
            toggle.content = contentInput.value.trim();
            chip.textContent = toggle.name;
            chip.title = toggle.content;
            editor.remove();
        };
        doneBtn.addEventListener('click', apply);
        nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') contentInput.focus(); });
        contentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });

        editor.appendChild(nameInput);
        editor.appendChild(contentInput);
        editor.appendChild(doneBtn);
        row.appendChild(editor);
        nameInput.focus();
    }

    render();

    return {
        render,
        getValues: () => getData(),
        setValues: (values) => {
            globalThis.globalSettings.custom_toggles = Array.isArray(values) ? values : [];
            render();
        },
        // Active toggles contribute (((content:1))) to the positive prompt.
        getActivePrompt: () => {
            return getData()
                .filter(t => t && t.on && typeof t.content === 'string' && t.content.trim() !== '')
                .map(t => `(((${t.content.trim()}:1)))`)
                .join(', ');
        }
    };
}
