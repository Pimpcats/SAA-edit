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

    // On load, if any segment has saved content, compose the main from them.
    if (((SETTINGS.prompt_character || '') + (SETTINGS.prompt_action || '') + (SETTINGS.prompt_background || '')).trim()) {
        recompose();
    }
}
