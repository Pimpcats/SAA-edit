import { createControlNetButtons } from './components/imageInfoControlNet.js';
import { createImageTagger } from './components/imageInfoTagger.js';
import { handlePastedJsonOrCsvFile, handlePastedPlainTextItem } from './components/imageInfoDataFiles.js';
import { extractImageMetadata, parseGenerationParameters } from './components/imageInfoMetadata.js';
import { createMiraITUWindow } from './components/imageInfoMiraITU.js';
import { fileToBase64 } from './generate.js';
import { SAMPLER_WEBUI, SCHEDULER_WEBUI } from './language.js';
import { applyImageSettings } from './applyImageSettings.js';

let cachedImage = '';

export function setupImageUploadOverlay() {
    const fullBody = document.querySelector('#full-body');
    
    const SETTINGS = globalThis.globalSettings;
    const FILES = globalThis.cachedFiles;
    const LANG = FILES.language[SETTINGS.language];
    
    // Size/position the drop overlay to cover ONLY the left output panel (where
    // images are produced), so it never spills onto the right side and the Video
    // tab can receive its own drops. Returns true if it anchored successfully.
    function anchorOverlayToLeftPanel(){
        const leftPanel = document.querySelector('#left');
        if (!leftPanel) return false;
        const r = leftPanel.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        uploadOverlay.style.minWidth = '0';
        uploadOverlay.style.minHeight = '0';
        uploadOverlay.style.maxWidth = 'none';
        uploadOverlay.style.maxHeight = 'none';
        uploadOverlay.style.width = `${Math.round(r.width)}px`;
        uploadOverlay.style.height = `${Math.round(r.height)}px`;
        uploadOverlay.style.top = `${Math.round(r.top)}px`;
        uploadOverlay.style.left = `${Math.round(r.left)}px`;
        return true;
    }

    function defaultUploadOverlaySize(){
        if (anchorOverlayToLeftPanel()) { closeButton.style.display = 'none'; return; }

        // Fallback (left panel not found): original centered box.
        const width = globalThis.innerWidth;
        const height = globalThis.innerHeight;
        uploadOverlay.style.width = `${width*0.6}px`;
        uploadOverlay.style.height = `${height*0.6}px`;
        uploadOverlay.style.minWidth = `768px`;
        uploadOverlay.style.minHeight = `768px`;
        uploadOverlay.style.maxWidth = `${width*0.6}px`;
        uploadOverlay.style.maxHeight = `${height*0.6}px`;
        uploadOverlay.style.top = `${(width - width*0.6) / 2}px`;
        uploadOverlay.style.left = `${(height - height*0.6) / 2}px`;

        closeButton.style.display = 'none';
    }

    function showImageUploadOverlaySize(imageWidth, imageHeight){
        // Keep the dropped image inside the left panel; #preview-image is
        // object-fit:contain so the photo scales to fit the panel.
        if (anchorOverlayToLeftPanel()) { closeButton.style.display = 'flex'; return; }

        // Fallback: size to the image and center in the window.
        uploadOverlay.style.width = `${imageWidth}px`;
        uploadOverlay.style.height = `${imageHeight}px`;

        const width = uploadOverlay.getBoundingClientRect().width;
        const height = uploadOverlay.getBoundingClientRect().height;

        uploadOverlay.style.top = `${Math.floor((globalThis.innerHeight - height) / 2)}px`;
        uploadOverlay.style.left = `${Math.floor((globalThis.innerWidth - width) / 2)}px`;

        closeButton.style.display = 'flex';
    }

    const uploadOverlay = document.createElement('div');
    uploadOverlay.className = 'im-image-upload-overlay';
    uploadOverlay.style.display = 'none'; 
    fullBody.appendChild(uploadOverlay);

    const hintContainer = document.createElement('div');
    hintContainer.className = 'drag-hint-container';
    const topHint = document.createElement('div');
    topHint.className = 'drag-hint-top';
    const bottomHint = document.createElement('div');
    bottomHint.className = 'drag-hint-bottom';
    hintContainer.appendChild(topHint);
    hintContainer.appendChild(bottomHint);
    uploadOverlay.appendChild(hintContainer);
    updateHintText(LANG.image_info_drag_hint_top, LANG.image_info_drag_hint_bottom);

    const closeButton = document.createElement('button');
    closeButton.className = 'cg-close-button';
    closeButton.style.display = 'none'; 
    closeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        hideOverlay();
    });
    uploadOverlay.appendChild(closeButton);

    // Resize handle so the drop/preview window can be resized.
    const overlayResizeHandle = document.createElement('div');
    overlayResizeHandle.className = 'cg-resize-handle';
    uploadOverlay.appendChild(overlayResizeHandle);
    overlayResizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = uploadOverlay.getBoundingClientRect();
        const sw = rect.width;
        const sh = rect.height;
        const onMove = (ev) => {
            uploadOverlay.style.minWidth = '0';
            uploadOverlay.style.minHeight = '0';
            uploadOverlay.style.maxWidth = 'none';
            uploadOverlay.style.maxHeight = 'none';
            uploadOverlay.style.width = `${Math.max(360, sw + (ev.clientX - startX))}px`;
            uploadOverlay.style.height = `${Math.max(280, sh + (ev.clientY - startY))}px`;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    defaultUploadOverlaySize();

    const svgIcon = document.createElement('div');
    svgIcon.id = 'upload-svg-icon';
    svgIcon.innerHTML = `
        <img class="filter-controlnet-icon" id="global-image-upload-icon" src="scripts/svg/image-upload.svg" alt="Upload" fill="currentColor">
        <img class="filter-controlnet-icon" id="global-file-upload-icon" src="scripts/svg/file-upload.svg" alt="Upload" fill="currentColor">
        <img class="filter-controlnet-icon" id="global-clipboard-paste-icon" src="scripts/svg/paste.svg" alt="Upload" fill="currentColor">
    `;
    uploadOverlay.appendChild(svgIcon);

    const imagePreview = document.createElement('div');
    imagePreview.id = 'image-preview-container';
    imagePreview.style.display = 'none';
    const previewImg = document.createElement('img');
    previewImg.id = 'preview-image';
    previewImg.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        hideOverlay();
    });

    let isDragging = false;
    let isShowing = false;
    let dragStartX, dragStartY, initialLeft, initialTop;
    previewImg.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialLeft = Number.parseFloat(getComputedStyle(uploadOverlay).left) || 0;
        initialTop = Number.parseFloat(getComputedStyle(uploadOverlay).top) || 0;
        previewImg.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaX = e.clientX - dragStartX;
            const deltaY = e.clientY - dragStartY;
            uploadOverlay.style.left = `${initialLeft + deltaX}px`;
            uploadOverlay.style.top = `${initialTop + deltaY}px`;
        }
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            previewImg.style.cursor = 'grab';
        } else if (isShowing && !globalThis.currentImageMetadata) {
            hideOverlay();
        } 
    });
    imagePreview.appendChild(previewImg);
    uploadOverlay.appendChild(imagePreview);

    const metadataContainer = document.createElement('div');
    metadataContainer.id = 'metadata-container';
    metadataContainer.style.maxHeight = '150px';
    metadataContainer.style.display = 'none'; 
    uploadOverlay.appendChild(metadataContainer);

    const updateDynamicHeights = () => {
        const isImageDisplayed = imagePreview.style.display !== 'none';
        if (isImageDisplayed) {
            const imageWidth = previewImg.getBoundingClientRect().width;
            const imageHeight = previewImg.getBoundingClientRect().height;                       
            metadataContainer.style.display = 'center';
            showImageUploadOverlaySize(imageWidth, imageHeight);
        } else {
            metadataContainer.style.display = 'none';
            defaultUploadOverlaySize();
        }
    };
    requestAnimationFrame(updateDynamicHeights);

    globalThis.currentImageMetadata = null;

    // helper for pasted image items
    async function handlePastedImageItem(item) {
        const file = item.getAsFile();
        if (!file) return false;
        cachedImage = file;
        const fallbackMetadata = {
            fileName: file.name || 'pasted_image.png',
            fileSize: file.size,
            fileType: file.type,
            lastModified: file.lastModified || Date.now(),
            error: 'Metadata extraction failed'
        };
        try {
            const metadata = await extractImageMetadata(file);
            showImagePreview(file);
            displayFormattedMetadata(metadata, fallbackMetadata);
        } catch (err) {
            console.error('Failed to process pasted image metadata:', err);            
            showImagePreview(file);
            displayFormattedMetadata(fallbackMetadata);
        }
        return true;
    }

    const handlePaste = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const items = e.clipboardData.items;

        for (const item of items) {
            try {
                if (item.type.startsWith('image/')) {
                    if (await handlePastedImageItem(item)) break;
                } else if (item.type === 'application/json' || item.type === 'text/csv') {
                    if (await handlePastedJsonOrCsvFile(item, hideOverlay)) break;
                } else if (item.type === 'text/plain') {
                    await handlePastedPlainTextItem(item, hideOverlay);
                    break;
                } else {
                    console.log("Unknown type:", item.type);
                }
            } catch (err) {
                console.error('Error handling pasted item:', err);
            }
        }
    };

    function updateHintText(top, bottom) {
        const topHint = document.querySelector('.drag-hint-top');
        topHint.textContent = top; 

        const bottomHint = document.querySelector('.drag-hint-bottom');
        bottomHint.textContent = bottom; 
    }

    function showOverlay() {
        uploadOverlay.style.display = 'flex';
        requestAnimationFrame(updateDynamicHeights);
        isShowing = true;
        document.addEventListener('paste', handlePaste);
    }

    function hideOverlay() {
        uploadOverlay.style.display = 'none';
        clearImageAndMetadata();
        isShowing = false;
        document.removeEventListener('paste', handlePaste);
    }

    function clearImageAndMetadata() {
        imagePreview.style.display = 'none';
        metadataContainer.style.display = 'none';
        svgIcon.style.display = 'flex';
        globalThis.currentImageMetadata = null;
        metadataContainer.innerHTML = '';
        previewImg.src = '';
        defaultUploadOverlaySize();
        requestAnimationFrame(updateDynamicHeights);
    }

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (globalThis.currentImageMetadata) {
            clearImageAndMetadata();
        }
        if (e.dataTransfer.types.includes('Files')) {
            showOverlay();
        }
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.clientX <= 0 || e.clientY <= 0 || 
            e.clientX >= globalThis.innerWidth || e.clientY >= globalThis.innerHeight) {
            if (!globalThis.currentImageMetadata) {
                hideOverlay();
            }
        } 
    });

    uploadOverlay.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();

        hintContainer.style.display = 'flex';
        svgIcon.style.opacity = '0.1';

        // MiraITU bottom-half only appears when enabled in Settings.
        const miraOn = !!globalThis.globalSettings.mira_itu_enable;
        bottomHint.style.display = miraOn ? '' : 'none';
        if (!miraOn) {
            topHint.classList.add('active');
            bottomHint.classList.remove('active');
            return;
        }

        const rect = uploadOverlay.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const threshold = rect.height / 2;

        if (offsetY < threshold) {
            topHint.classList.add('active');
            bottomHint.classList.remove('active');
        } else {
            topHint.classList.remove('active');
            bottomHint.classList.add('active');
        }
    });

    uploadOverlay.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();

        hintContainer.style.display = 'none';
        svgIcon.style.opacity = '1';
        topHint.classList.remove('active');
        bottomHint.classList.remove('active');
    });

    // eslint-disable-next-line sonarjs/cognitive-complexity
    uploadOverlay.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        hintContainer.style.display = 'none';
        svgIcon.style.opacity = '1';
        topHint.classList.remove('active');
        bottomHint.classList.remove('active');

        const files = e.dataTransfer.files;
        if (files.length === 0) return;

        const file = files[0];

        // MiraITU (image tile) is off by default; when enabled in Settings,
        // dropping an image on the bottom half opens MiraITU (ComfyUI only).
        // Otherwise every dropped image just reads its metadata for Paste All.
        if (file.type.startsWith('image/')) {
            cachedImage = file;

            if (globalThis.globalSettings.mira_itu_enable) {
                const rect = uploadOverlay.getBoundingClientRect();
                const isBottomHalf = (e.clientY - rect.top) >= rect.height / 2;
                if (isBottomHalf) {
                    const apiInterface = globalThis.generate.api_interface.getValue();
                    if (apiInterface === 'ComfyUI') {
                        const imageBase64 = await fileToBase64(cachedImage);
                        await createMiraITUWindow(imageBase64, cachedImage);
                    } else {
                        globalThis.overlay.custom.createErrorOverlay(LANG.message_mira_itu_only_comfyui, 'https://github.com/mirabarukaso/ComfyUI_MiraSubPack');
                    }
                    hideOverlay();
                    return;
                }
            }

            const fallbackMetadata = {
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                lastModified: file.lastModified,
                error: 'Metadata extraction failed'
            };
            try {
                const metadata = await extractImageMetadata(file);
                showImagePreview(file);
                displayFormattedMetadata(metadata, fallbackMetadata);
            } catch (err) {
                console.error('Failed to process image metadata:', err);
                showImagePreview(file);
                displayFormattedMetadata(fallbackMetadata);
            }
        } else if (file.type === `application/json` || file.type === `text/csv`) {
            console.log('Dropped JSON file:', file.name);
            await globalThis.jsonlist.addJsonSlotFromFile(file, file.type);
            globalThis.collapsedTabs.jsonlist.setCollapsed(false);
            hideOverlay();
        } else {
            console.warn('Dropped file ', file.name, ' is not support. File type: ', file.type);
            hideOverlay();
        }
    });

    function showImagePreview(file) {
        svgIcon.style.display = 'none';
        imagePreview.style.display = 'flex';
        metadataContainer.style.display = 'block';

        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewImg.onload = () => {
                requestAnimationFrame(updateDynamicHeights);
            };
        };
        reader.readAsDataURL(file);
    }

    function createButtonMireITU() {
        const SETTINGS = globalThis.globalSettings;
        const FILES = globalThis.cachedFiles;
        const LANG = FILES.language[SETTINGS.language];

        let miraITUButton;
        const apiInterface = globalThis.generate.api_interface.getValue();
        if(apiInterface === 'ComfyUI') {
            miraITUButton= document.createElement('button');
            miraITUButton.className = 'mira-itu';
            miraITUButton.textContent = LANG.image_info_mira_itu_button;
            
            miraITUButton.addEventListener('click', async () => {
                const apiInterface = globalThis.generate.api_interface.getValue();
                if(apiInterface !== 'ComfyUI') {
                    globalThis.overlay.custom.createErrorOverlay(LANG.message_mira_itu_only_comfyui, 'https://github.com/mirabarukaso/ComfyUI_MiraSubPack');
                    return;
                }
                const imageBase64 = await fileToBase64(cachedImage);
                await createMiraITUWindow(imageBase64, cachedImage);
                hideOverlay();
            });
        } else {
            miraITUButton = document.createElement('div');
        }

        return miraITUButton;
    }

    function createButtonMetaData() {
        const SETTINGS = globalThis.globalSettings;
        const FILES = globalThis.cachedFiles;
        const LANG = FILES.language[SETTINGS.language];

        let workflowButton;
        if(globalThis.currentImageMetadata.nodes) {
            workflowButton = document.createElement('button');
            workflowButton.className = 'copy-all-metadata';
            workflowButton.textContent = LANG.image_info_show_metadata_buttons;

            workflowButton.addEventListener('click', async () => {
                const parsedMetadata = JSON.stringify(globalThis.currentImageMetadata.nodes, null, 2);
                const imageBase64 = await fileToBase64(cachedImage);
                globalThis.overlay.custom.createCustomOverlay(
                        imageBase64 || 'none', 
                        `${parsedMetadata || ''}`,
                        384, 'center', 'left', null, 'Info');
            });
        } else {
            workflowButton = document.createElement('div');
        }

        return workflowButton;
    }

    function createTagTransferButtons() {
        const SETTINGS = globalThis.globalSettings;
        const FILES = globalThis.cachedFiles;
        const LANG = FILES.language[SETTINGS.language];

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'metadata-buttons';

        const makeBtn = (label, opts) => {
            const btn = document.createElement('button');
            btn.className = 'send-metadata';
            btn.textContent = label;
            btn.addEventListener('click', () => {
                sendPrompt(globalThis.currentImageMetadata, 'all', opts);
                // Close the drop popup once a paste choice is made.
                hideOverlay();
            });
            return btn;
        };

        // Default: paste everything but keep a random seed (-1).
        buttonContainer.appendChild(makeBtn(LANG.image_info_paste_random_seed || 'Paste settings and random seed', { randomSeed: true }));
        // Also offer: paste everything including the image's seed.
        buttonContainer.appendChild(makeBtn(LANG.image_info_paste_with_seed || 'Paste all settings and seed', { randomSeed: false }));

        return buttonContainer;
    }

    // Single "Paste All" button for every dropped image.
    function createWorkflowButtons() {
        return createTagTransferButtons();
    }

    // Build a lowercase key -> value map from the A1111 "otherParams" block
    // (each entry is a "Key: value" line produced by parseGenerationParameters).
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

    // Resolve sampler + scheduler against the WebUI lists. Handles both the
    // modern A1111 format (separate "Sampler" + "Schedule type") and the older
    // combined format ("DPM++ 2M Karras").
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

        const matchedSampler = SAMPLER_WEBUI.find(s => s.toLowerCase() === sampler.toLowerCase()) || null;
        const matchedScheduler = scheduler
            ? (SCHEDULER_WEBUI.find(s => s.toLowerCase() === scheduler.toLowerCase()) || null)
            : null;
        return { sampler: matchedSampler, scheduler: matchedScheduler };
    }

    // Best-effort match of an A1111 "Model:" name against the loaded checkpoint
    // list. Returns the matching option string or null (so we never set an
    // invalid value).
    function matchFromList(name, list) {
        if (!name || !Array.isArray(list) || list.length === 0) return null;
        const target = name.toLowerCase();
        const baseOf = (o) => String(o).split(/[/\\]/).pop().replace(/\.(safetensors|ckpt|pt|pth)$/i, '').toLowerCase();
        return list.find(o => baseOf(o) === target)
            || list.find(o => String(o).toLowerCase() === target)
            || list.find(o => String(o).toLowerCase().includes(target))
            || null;
    }

    function applyPrompts(parsedMetadata) {
        const defaultPositivePrompt = "masterpiece, best quality, amazing quality";
        const defaultNegativePrompt = "bad quality, worst quality, worst detail, sketch";

        const positivePrompt = parsedMetadata.positivePrompt || defaultPositivePrompt;
        const negativePrompt = parsedMetadata.negativePrompt || defaultNegativePrompt;

        // Extract <lora:...> strings from positivePrompt
        const loraRegex = /<lora:[^>]+>/g;
        const loraMatches = positivePrompt.match(loraRegex) || [];
        const allLora = loraMatches.join('\n');
        const allPrompt = positivePrompt.replaceAll(loraRegex, '').replaceAll(/,\s*,/g, ',').replaceAll(/(^,\s*)|(\s*,$)/g, '').trim();

        globalThis.prompt.common.setValue(allPrompt || defaultPositivePrompt);
        globalThis.prompt.positive.setValue(allLora);
        globalThis.prompt.negative.setValue(negativePrompt);
    }

    function applySettings(parsedMetadata) {
        const map = buildParamMap(parsedMetadata.otherParams);

        // Seed / CFG / Steps
        if (map['seed'] !== undefined) globalThis.generate.seed.setValue(map['seed']);
        if (map['cfg scale'] !== undefined) globalThis.generate.cfg.setValue(map['cfg scale']);
        if (map['steps'] !== undefined) globalThis.generate.step.setValue(map['steps']);

        // Size (prefer the "Size: WxH" param, fall back to parsed dimensions)
        let width = parsedMetadata.width;
        let height = parsedMetadata.height;
        if (map['size']) {
            const sizeMatch = map['size'].match(/(\d+)\s*x\s*(\d+)/i);
            if (sizeMatch) { width = sizeMatch[1]; height = sizeMatch[2]; }
        }
        if (width) globalThis.generate.width.setValue(width);
        if (height) globalThis.generate.height.setValue(height);

        // Sampler / Scheduler
        const { sampler, scheduler } = resolveSamplerScheduler(map['sampler'], map['schedule type']);
        if (sampler) globalThis.generate.sampler.updateDefaults(sampler);
        if (scheduler) globalThis.generate.scheduler.updateDefaults(scheduler);

        // Checkpoint model (only if it matches a loaded model, to avoid an invalid value)
        const matchedModel = matchFromList(map['model'], globalThis.cachedFiles?.modelList);
        if (matchedModel) globalThis.dropdownList.model.updateDefaults(matchedModel);

        // Hires fix — presence of any hires/denoise param implies it was enabled
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

    function sendPrompt(parsedMetadata, mode = 'all', opts = {}) {
        applyImageSettings(parsedMetadata, mode, opts);
    }

    // eslint-disable-next-line sonarjs/cognitive-complexity
    function displayFormattedMetadata(metadata, fallbackMetadata=null) {
        const apiInterface = globalThis.generate.api_interface.getValue();
        const modelType = globalThis.dropdownList.model_type.getValue();
        const parsedMetadata = parseGenerationParameters(metadata);
        parsedMetadata.nodes = metadata.generationParameters || null;
        parsedMetadata.saaState = metadata.generationParameters?.['saa-state'] || null;
        globalThis.currentImageMetadata = parsedMetadata;
        metadataContainer.innerHTML = '';
        
        const hasMetadata = parsedMetadata.positivePrompt || 
                           parsedMetadata.negativePrompt || 
                           parsedMetadata.otherParams;        
        
        // Tagger and ControlNet rows removed from the drop overlay.

        const metadataDisplay = document.createElement('div');
        metadataDisplay.className = `metadata-custom-textbox-data`;
        metadataDisplay.style.whiteSpace = 'pre-wrap';
        metadataDisplay.style.overflow = 'auto';
        
        let metadataText = '';
        metadataText += `File name: ${parsedMetadata.fileName}\n`;
        if (parsedMetadata.width && parsedMetadata.height) {
            metadataText += `Size: ${parsedMetadata.width}x${parsedMetadata.height}\n`;
        } else if (fallbackMetadata) {
            metadataText += `Size: ${Math.round(fallbackMetadata.fileSize/1024, 2)} kb\n`;
            metadataText += `Type: ${fallbackMetadata.fileType}\n`;
        }
        
        if (hasMetadata) {
            const buttonContainer = createTagTransferButtons();
            metadataContainer.appendChild(buttonContainer);

            if (parsedMetadata.positivePrompt) {
                metadataText += `\nPositive prompt: ${parsedMetadata.positivePrompt}\n`;
            } else if (!parsedMetadata.error) {
                metadataText += '\nNo prompt metadata found\n';         
            }
            
            if (parsedMetadata.negativePrompt) {
                metadataText += `Negative prompt: ${parsedMetadata.negativePrompt}\n`;
            }
            
            if (parsedMetadata.otherParams) {
                metadataText += `\n${parsedMetadata.otherParams}`;
            }
            
            if (parsedMetadata.error) {
                metadataText += `\nError: ${parsedMetadata.error}\n`;
            }
        } else if(metadata.generationParameters) {
            const buttonContainer = createWorkflowButtons();
            metadataContainer.appendChild(buttonContainer);                        
        }
        
        metadataDisplay.textContent = metadataText;
        metadataContainer.appendChild(metadataDisplay);
    }

    globalThis.addEventListener('resize', () => {
        if (uploadOverlay.style.display !== 'none') {            
            requestAnimationFrame(updateDynamicHeights);
        }
    });

    uploadOverlay.showOverlay = showOverlay;
    uploadOverlay.hideOverlay = hideOverlay;
    uploadOverlay.updateHintText = updateHintText;

    uploadOverlay._cleanup = () => {
        document.removeEventListener('dragenter', showOverlay);
        uploadOverlay.remove();
    };

    globalThis.imageUploadOverlay = uploadOverlay;
    return uploadOverlay;
}
