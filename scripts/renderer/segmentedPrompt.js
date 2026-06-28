import { setupTextbox } from './components/myTextbox.js';

// Splits the positive prompt into three labeled inputs — Character / Action /
// Background — that feed one combined "Main prompt" box. Editing any segment
// recomposes the main live; the main stays directly editable too (a manual edit
// there is used as-is for generation until a segment is next changed, which
// recomposes and overwrites it).
//
// The main box is the existing `globalThis.prompt.common` (custom_prompt), which
// already drives generation, so the segments need no separate wiring into the
// generate pipeline.
export function setupSegmentedPrompt(SETTINGS, LANG) {
    const P = globalThis.prompt;
    if (!P || !P.common) return;

    const recompose = () => {
        const seg = (k) => (P[k]?.getValue?.() || '').trim();
        const parts = [seg('character'), seg('action'), seg('background')].filter(Boolean);
        const combined = parts.join(', ');
        P.common.setValue(combined);
        globalThis.globalSettings.custom_prompt = combined;
    };
    globalThis.recomposeCombinedPrompt = recompose;

    const makeSegment = (id, settingKey, label) => setupTextbox(
        id,
        label,
        { value: SETTINGS[settingKey] || '', defaultTextColor: 'darkorange', maxLines: 6 },
        true,                                   // show the header label
        (value) => { globalThis.globalSettings[settingKey] = value; recompose(); }
    );

    P.character = makeSegment('prompt-character', 'prompt_character', LANG.prompt_character || 'Character');
    P.action = makeSegment('prompt-action', 'prompt_action', LANG.prompt_action || 'Action');
    P.background = makeSegment('prompt-background', 'prompt_background', LANG.prompt_background || 'Background');

    // Renamable labels: a saved custom name (in settings) overrides the default.
    const lab = (key, def) => (globalThis.globalSettings[key] || '').trim() || def;
    const LABELS = [
        { box: P.character, id: 'prompt-character', key: 'prompt_label_character', def: LANG.prompt_character || 'Character' },
        { box: P.action, id: 'prompt-action', key: 'prompt_label_action', def: LANG.prompt_action || 'Action' },
        { box: P.background, id: 'prompt-background', key: 'prompt_label_background', def: LANG.prompt_background || 'Background' },
        { box: P.common, id: 'prompt-common', key: 'prompt_label_main', def: LANG.prompt_main || 'All Prompts' }
    ];

    function applyLabels() {
        for (const { box, key, def } of LABELS) box?.setTitle?.(lab(key, def));
    }
    globalThis.applyPromptLabels = applyLabels;
    applyLabels();

    // Double-click a label to rename it; persists to settings.
    function makeEditable({ id, key, def }) {
        const header = document.querySelector(`.myTextbox-${id}-header`);
        if (!header) return;
        header.title = 'Double-click to rename';
        header.style.cursor = 'text';
        header.addEventListener('dblclick', () => {
            if (header.querySelector('input')) return;
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'prompt-label-edit';
            input.value = lab(key, def);
            const prev = header.textContent;
            header.textContent = '';
            header.appendChild(input);
            input.focus();
            input.select();
            let done = false;
            const finish = (save) => {
                if (done) return;
                done = true;
                const val = input.value.trim();
                if (save) globalThis.globalSettings[key] = val;       // blank clears -> default
                header.textContent = save ? lab(key, def) : prev;
            };
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
            });
            input.addEventListener('blur', () => finish(true));
        });
    }
    for (const l of LABELS) makeEditable(l);

    // On load, if any segment has saved content, compose the main from them.
    if (((SETTINGS.prompt_character || '') + (SETTINGS.prompt_action || '') + (SETTINGS.prompt_background || '')).trim()) {
        recompose();
    }
}
