export function from_main_updateGallery(base64, seed, tagsString){
    const keepGallery = globalThis.generate.keepGallery.getValue();
    if(!keepGallery)
        globalThis.mainGallery.clearGallery();
    globalThis.mainGallery.appendImageData(base64, seed, tagsString, keepGallery, globalThis.globalSettings.scroll_to_last);
}

export function from_main_updatePreview(base64){
    // The live preview now renders inline over the main image area instead of a
    // floating island.
    if (globalThis.mainGallery?.updatePreviewImage) {
        globalThis.mainGallery.updatePreviewImage(base64);
    }
}

export function from_main_customOverlayProgress(progress, totalProgress){
    try {
        const loadingMessage = globalThis.generate.loadingMessage.split('<')[0];
        globalThis.generate.loadingMessage = `${loadingMessage} <${progress}/${totalProgress}>`;
    } catch {
        // by pass
    }
}

export function from_renderer_generate_updatePreview(base64) {
    from_main_updatePreview(base64);
}
