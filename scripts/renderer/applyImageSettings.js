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

function escapeRegex(s) {
    return s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

// Detect known characters in the prompt and select the matching slots above.
// Sets matched characters into the first slots and clears the rest, so leftover
// "Random"/old selections don't linger.
function applyCharactersFromPrompt(positivePrompt) {
    const cl = globalThis.characterList;
    if (!positivePrompt || !cl?.setSlotValue) return;
    const chars = globalThis.cachedFiles?.characters || {};
    const lower = ` ${positivePrompt.toLowerCase()} `;

    const matches = [];
    const seen = new Set();
    for (const tag of Object.values(chars)) {
        if (!tag) continue;
        const t = String(tag).toLowerCase().trim();
        if (t.length < 3 || seen.has(t)) continue;
        // delimiter-bounded match so partial tags don't false-match
        const re = new RegExp(`(^|[,(\\s])${escapeRegex(t)}([,):\\s]|$)`);
        const m = re.exec(lower);
        if (m) {
            matches.push({ tag, pos: m.index });
            seen.add(t);
        }
    }
    if (matches.length === 0) return;
    matches.sort((a, b) => a.pos - b.pos);

    // The first 3 dropdowns are characters (slot 4 is original-character).
    for (let i = 0; i < 3; i++) {
        cl.setSlotValue(i, matches[i] ? matches[i].tag : 'none');
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

export function applySettings(parsedMetadata, opts = {}) {
    const map = buildParamMap(parsedMetadata.otherParams);

    // Seed: keep -1 (random) by default; only apply the image's seed when
    // explicitly requested.
    if (opts.randomSeed) {
        globalThis.generate.seed.setValue(-1);
    } else if (map['seed'] !== undefined) {
        globalThis.generate.seed.setValue(map['seed']);
    }
    if (map['cfg scale'] !== undefined) globalThis.generate.cfg.setValue(map['cfg scale']);
    if (map['steps'] !== undefined) globalThis.generate.step.setValue(map['steps']);

    let width = parsedMetadata.width;
    let height = parsedMetadata.height;
    if (map['size']) {
        const sizeMatch = map['size'].match(/(\d+)\s*x\s*(\d+)/i);
        if (sizeMatch) { width = sizeMatch[1]; height = sizeMatch[2]; }
    }
    if (width && height) {
        const w = Number(width);
        const h = Number(height);
        // The Landscape checkbox swaps the width/height sliders at generation
        // time, so set the box to match the image and lay the sliders out so
        // the final output keeps the image's exact dimensions.
        const landscape = w > h;
        if (globalThis.generate?.landscape) globalThis.generate.landscape.setValue(landscape);
        if (landscape) {
            globalThis.generate.width.setValue(h);
            globalThis.generate.height.setValue(w);
        } else {
            globalThis.generate.width.setValue(w);
            globalThis.generate.height.setValue(h);
        }
    } else {
        if (width) globalThis.generate.width.setValue(width);
        if (height) globalThis.generate.height.setValue(height);
    }

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

// mode: 'prompts' | 'settings' | 'all'; opts.randomSeed keeps seed at -1.
export function applyImageSettings(parsedMetadata, mode = 'all', opts = {}) {
    if (!parsedMetadata) return;
    if (mode === 'prompts' || mode === 'all') applyPrompts(parsedMetadata);
    if (mode === 'settings' || mode === 'all') applySettings(parsedMetadata, opts);
    // (landscape is set inside applySettings based on the image's orientation)
    if (globalThis.ai?.ai_select) globalThis.ai.ai_select.setValue(0);
}
