import { SAMPLER_WEBUI, SCHEDULER_WEBUI } from './language.js';

// Shared "apply A1111 settings" logic, used by both the Image Info drop panel
// and the gallery "Send" button. Takes a parsedMetadata object (from
// parseGenerationParameters) and applies it to the generate area.

function buildParamMap(otherParams) {
    const map = {};
    if (!otherParams) return map;
    for (const line of otherParams.split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (key) map[key] = value;
    }
    return map;
}

function resolveSamplerScheduler(samplerRaw, scheduleRaw) {
    let sampler = (samplerRaw || '').trim();
    let scheduler = (scheduleRaw || '').trim();
    if (sampler && !SAMPLER_WEBUI.includes(sampler)) {
        for (const s of SCHEDULER_WEBUI) {
            if (s === 'Automatic') continue;
            if (sampler.toLowerCase().endsWith(` ${s.toLowerCase()}`)) {
                if (!scheduler) scheduler = s;
                sampler = sampler.slice(0, sampler.length - s.length - 1).trim();
                break;
            }
        }
    }
    return {
        sampler: SAMPLER_WEBUI.find(s => s.toLowerCase() === sampler.toLowerCase()) || null,
        scheduler: scheduler ? (SCHEDULER_WEBUI.find(s => s.toLowerCase() === scheduler.toLowerCase()) || null) : null
    };
}

function matchFromList(name, list) {
    if (!name || !Array.isArray(list) || list.length === 0) return null;
    const target = name.toLowerCase();
    const baseOf = (o) => String(o).split(/[/\\]/).pop().replace(/\.(safetensors|ckpt|pt|pth)$/i, '').toLowerCase();
    return list.find(o => baseOf(o) === target)
        || list.find(o => String(o).toLowerCase() === target)
        || list.find(o => String(o).toLowerCase().includes(target))
        || null;
}

// Detect known characters in the prompt and select the matching slots above.
function applyCharactersFromPrompt(positivePrompt) {
    if (!positivePrompt || !globalThis.characterList?.setSlotValue) return;
    const chars = globalThis.cachedFiles?.characters || {};
    const lower = positivePrompt.toLowerCase();
    const matches = [];
    const seen = new Set();
    for (const tag of Object.values(chars)) {
        if (!tag) continue;
        const t = String(tag).toLowerCase();
        if (t.length < 4 || seen.has(t)) continue;
        const idx = lower.indexOf(t);
        if (idx === -1) continue;
        const before = idx === 0 ? '' : lower[idx - 1];
        const after = lower[idx + t.length] || '';
        const okBefore = before === '' || before === ',' || before === ' ' || before === '(';
        const okAfter = after === '' || after === ',' || after === ':' || after === ')' || after === ' ';
        if (okBefore && okAfter) {
            matches.push({ tag, pos: idx });
            seen.add(t);
            if (matches.length >= 12) break;
        }
    }
    if (matches.length === 0) return;
    matches.sort((a, b) => a.pos - b.pos);
    const found = matches.slice(0, 3).map(m => m.tag);
    for (let i = 0; i < 3; i++) {
        globalThis.characterList.setSlotValue(i, found[i] || 'none');
    }
}

export function applyPrompts(parsedMetadata) {
    const defaultPositivePrompt = 'masterpiece, best quality, amazing quality';
    const defaultNegativePrompt = 'bad quality, worst quality, worst detail, sketch';

    const positivePrompt = parsedMetadata.positivePrompt || defaultPositivePrompt;
    const negativePrompt = parsedMetadata.negativePrompt || defaultNegativePrompt;

    const loraRegex = /<lora:[^>]+>/g;
    const loraMatches = positivePrompt.match(loraRegex) || [];
    const allLora = loraMatches.join('\n');
    const allPrompt = positivePrompt.replaceAll(loraRegex, '').replaceAll(/,\s*,/g, ',').replaceAll(/(^,\s*)|(\s*,$)/g, '').trim();

    globalThis.prompt.common.setValue(allPrompt || defaultPositivePrompt);
    globalThis.prompt.positive.setValue(allLora);
    globalThis.prompt.negative.setValue(negativePrompt);

    applyCharactersFromPrompt(positivePrompt);
}

export function applySettings(parsedMetadata) {
    const map = buildParamMap(parsedMetadata.otherParams);

    if (map['seed'] !== undefined) globalThis.generate.seed.setValue(map['seed']);
    if (map['cfg scale'] !== undefined) globalThis.generate.cfg.setValue(map['cfg scale']);
    if (map['steps'] !== undefined) globalThis.generate.step.setValue(map['steps']);

    let width = parsedMetadata.width;
    let height = parsedMetadata.height;
    if (map['size']) {
        const sizeMatch = map['size'].match(/(\d+)\s*x\s*(\d+)/i);
        if (sizeMatch) { width = sizeMatch[1]; height = sizeMatch[2]; }
    }
    if (width) globalThis.generate.width.setValue(width);
    if (height) globalThis.generate.height.setValue(height);

    const { sampler, scheduler } = resolveSamplerScheduler(map['sampler'], map['schedule type']);
    if (sampler) globalThis.generate.sampler.updateDefaults(sampler);
    if (scheduler) globalThis.generate.scheduler.updateDefaults(scheduler);

    const matchedModel = matchFromList(map['model'], globalThis.cachedFiles?.modelList);
    if (matchedModel) globalThis.dropdownList.model.updateDefaults(matchedModel);

    const hasHires = map['hires upscale'] !== undefined
        || map['hires upscaler'] !== undefined
        || map['hires steps'] !== undefined
        || map['denoising strength'] !== undefined;
    if (hasHires) {
        globalThis.generate.hifix.setValue(true);
        if (map['hires upscale'] !== undefined) globalThis.hifix.scale.setValue(map['hires upscale']);
        if (map['denoising strength'] !== undefined) globalThis.hifix.denoise.setValue(map['denoising strength']);
        if (map['hires steps'] !== undefined) globalThis.hifix.steps.setValue(map['hires steps']);
        const matchedUpscaler = matchFromList(map['hires upscaler'], globalThis.cachedFiles?.upscalerList);
        if (matchedUpscaler) globalThis.hifix.model.updateDefaults(matchedUpscaler);
    }
}

// mode: 'prompts' | 'settings' | 'all'
export function applyImageSettings(parsedMetadata, mode = 'all') {
    if (!parsedMetadata) return;
    if (mode === 'prompts' || mode === 'all') applyPrompts(parsedMetadata);
    if (mode === 'settings' || mode === 'all') applySettings(parsedMetadata);
    if (globalThis.generate?.landscape) globalThis.generate.landscape.setValue(false);
    if (globalThis.ai?.ai_select) globalThis.ai.ai_select.setValue(0);
}
