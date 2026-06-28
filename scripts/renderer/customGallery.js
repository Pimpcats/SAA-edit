import { customCommonOverlay, addDragFunctionality } from './customOverlay.js';
import { parseGenerationParameters } from './components/imageInfoMetadata.js';
import { applyImageSettings } from './applyImageSettings.js';
import { captureSaaState, embedSaaState, restoreSaaState } from './saaState.js';
import { sendWebSocketMessage } from '../../webserver/front/wsRequest.js';

function setupScrollableContainer(container) {
    let isDragging = false, startX, scrollLeft;
    container.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        container.style.cursor = 'grabbing';
        startX = e.pageX - container.offsetLeft;
        scrollLeft = container.scrollLeft;
        document.body.style.userSelect = 'none';
    });
    container.addEventListener('mouseleave', () => {
        isDragging = false;
        container.style.cursor = 'grab';
        document.body.style.userSelect = '';
    });
    container.addEventListener('mouseup', () => {
        isDragging = false;
        container.style.cursor = 'grab';
        document.body.style.userSelect = '';
    });
    container.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 1;
        container.scrollLeft = scrollLeft - walk;
    });
}

function createModeSwitchOverlay(container) {
    let overlay = document.getElementById('cg-mode-switch-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cg-mode-switch-overlay';
        overlay.className = 'cg-mode-switch-overlay';
        overlay.innerHTML = `
            <div class="cg-mode-switch-spinner"></div>
            <div class="cg-mode-switch-text">Switching Gallery Mode...</div>
        `;
        container.appendChild(overlay);
    }
    return overlay;
}

function ensureSwitchModeButton(container, toggleFunction, id, images_length) {
    let button = document.getElementById(id);
    if (button) {
        button.textContent = images_length > 0 ? `<${images_length}>` : '<>';        
    } else {
        button = document.createElement('button');
        button.id = id;
        button.className = 'cg-button';
        button.textContent = images_length > 0 ? `<${images_length}>` : '<>';
        button.addEventListener('click', () => handleSwitchModeClick(container, toggleFunction));
        container.appendChild(button);
    }
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleSwitchModeClick(container, toggleFunction) {
    const overlay = createModeSwitchOverlay(container);
    overlay.classList.add('visible');

    await delay(100); 
    toggleFunction();

    hideAndRemoveOverlay(overlay);
}

function hideAndRemoveOverlay(overlay) {
    requestAnimationFrame(() => {
        setTimeout(() => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
        }, 10000); // 10 seconds
    });
}

function adjustPreviewContainer(previewContainer) {
    const previewImages = previewContainer.querySelectorAll('.cg-preview-image');
    if (previewImages.length > 0) {
        previewImages[0].onload = () => {
            const containerWidth = previewContainer.offsetWidth;
            const firstImageWidth = previewImages[0].offsetWidth || 50;
            const totalImagesWidth = firstImageWidth * previewImages.length;
            if (totalImagesWidth < (containerWidth - firstImageWidth)) {
                previewContainer.style.justifyContent = 'center';
            } else {
                previewContainer.style.justifyContent = 'flex-start';
                if (previewImages.length > 10) {
                    const minWidth = Math.max(50, containerWidth / previewImages.length);
                    for (const img of previewImages) {
                        img.style.maxWidth = `${minWidth}px`;
                    }
                }
            }
            previewContainer.scrollLeft = 0;
        };
    }
}

function process_oberserver(entries, observer) {
    for (const entry of entries) {
        if (entry.isIntersecting) {
            const imgContainer = entry.target;
            const img = imgContainer.querySelector('img');
            img.src = img.dataset.src; 
            imgContainer.classList.add('visible');
            observer.unobserve(imgContainer);
        }
    }
}

export function setupGallery(containerId) {
    if (globalThis.mainGallery.isGallerySetup) return;
    globalThis.mainGallery.isGallerySetup = true;
    globalThis.mainGallery.isLoading = false;

    let isGridMode = false;
    let currentIndex = 0;
    let privacyBalls = [];
    let images = [];
    let seeds = [];
    let tags = [];
    let states = [];   // captured UI state (view/character dropdowns) per image
    let renderedImageCount = 0;

    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error('Gallery container not found', containerId);
        return;
    }

    globalThis.mainGallery.clearGallery = function () {
        images = [];
        seeds = [];
        tags = [];
        states = [];
        renderedImageCount = 0;
        currentIndex = 0;
        container.innerHTML = '';
    };

    // Auto-save a generated image (with embedded UI state) to the configured
    // folder via the main process — silent, no download prompt. Desktop + PNG only.
    function autoSaveImage(base64, seed, state) {
        try {
            if (!globalThis.globalSettings?.auto_save_generated) return;
            if (globalThis.inBrowser || !globalThis.api?.saveGeneratedImage) return;
            let src = base64;
            if (typeof src !== 'string' || !src) return;
            if (!src.startsWith('data:')) src = 'data:image/png;base64,' + src;   // WebUI raw base64 = PNG
            else if (!src.startsWith('data:image/png')) return;                   // only PNG carries our chunk
            const embedded = state ? embedSaaState(src, state) : src;
            const fname = `saa_${seed || 'image'}_${Date.now()}.png`;
            Promise.resolve(globalThis.api.saveGeneratedImage(embedded, fname, globalThis.globalSettings.auto_save_dir || ''))
                .then((r) => { if (!r?.ok) console.warn('[autosave]', r?.error); })
                .catch((e) => console.warn('[autosave]', e));
        } catch (err) {
            console.warn('[autosave]', err);
        }
    }

    globalThis.mainGallery.appendImageData = function (base64, seed, tagsString, keep_gallery, switchToLatest = false) {
        if ('False' === keep_gallery) {
            globalThis.mainGallery.clearGallery();
        }

        images.push(base64);
        seeds.push(seed);
        tags.push(tagsString || '');
        // Snapshot the current view-tag / character dropdown state so it can be
        // embedded if this image is later saved with settings.
        const capturedState = captureSaaState();
        states.push(capturedState);

        // Auto-save each generation (silently, with embedded state) to the
        // configured folder. Desktop only; PNG only.
        autoSaveImage(base64, seed, capturedState);

        if (seeds.length !== tags.length || images.length !== seeds.length) {
            console.warn('[appendImageData] Mismatch: images:', images.length, 'seeds:', seeds.length, 'tags:', tags.length);
        }

        let incremental = true;
        if (switchToLatest && !isGridMode) {
            currentIndex = images.length - 1;
            incremental = false;
        }

        if (isGridMode) {
            gallery_renderGridMode(true);
        } else {
            gallery_renderSplitMode(incremental);
        }
    };

    // --- Inline generation preview (replaces the floating preview island) ---
    // The live preview is shown as an overlay covering the main image area, so
    // you watch it render in place and the finished image is revealed when the
    // overlay hides.
    let previewTimer = null;
    let lastPreview = null;

    function getInlinePreview() {
        let el = container.querySelector('.cg-inline-preview');
        if (!el) {
            el = document.createElement('div');
            el.className = 'cg-inline-preview';
            el.innerHTML = `
                <img class="cg-inline-preview-image" alt="Generating preview">
                <div class="cg-inline-preview-bar">
                    <span class="cg-inline-preview-title"></span>
                    <span class="cg-inline-preview-timer"></span>
                </div>
            `;
            container.appendChild(el);
            const img = el.querySelector('.cg-inline-preview-image');
            if (img && lastPreview) img.src = lastPreview;
        }
        return el;
    }

    // Called with each progress frame from the backend.
    globalThis.mainGallery.updatePreviewImage = function (base64) {
        if (!globalThis.mainGallery.isLoading || !base64) return;
        lastPreview = base64;
        const el = getInlinePreview();
        el.style.display = 'flex';
        const img = el.querySelector('.cg-inline-preview-image');
        if (img) {
            img.src = base64;
            img.onerror = () => { img.src = globalThis.cachedFiles.loadingWait; img.onerror = null; };
        }
    };

    globalThis.mainGallery.showLoading = function (loadingMessage, elapsedTimePrefix, elapsedTimeSuffix) {
        lastPreview = globalThis.cachedFiles?.loadingWait || null;
        const el = getInlinePreview();
        el.style.display = 'flex';
        const img = el.querySelector('.cg-inline-preview-image');
        if (img) img.src = lastPreview;

        const startTime = Date.now();
        if (previewTimer) clearInterval(previewTimer);
        previewTimer = setInterval(() => {
            // Re-acquire (and recreate if a gallery re-render wiped it) so the
            // overlay survives images being appended mid-batch.
            const cur = getInlinePreview();
            if (cur.style.display === 'none') cur.style.display = 'flex';
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const timerEl = cur.querySelector('.cg-inline-preview-timer');
            const titleEl = cur.querySelector('.cg-inline-preview-title');
            if (timerEl) timerEl.textContent = `${elapsedTimePrefix || 'Elapsed time:'} ${elapsed} ${elapsedTimeSuffix || 'seconds'}`;
            if (titleEl) titleEl.textContent = `${globalThis.generate.loadingMessage || loadingMessage || ''}`;
        }, 100);

        globalThis.mainGallery.isLoading = true;
    };

    globalThis.mainGallery.hideLoading = function (errorMessage, copyMessage) {
        if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
        lastPreview = null;
        const el = container.querySelector('.cg-inline-preview');
        if (el) el.remove();
        if ('success' !== errorMessage) {
            console.error('Got Error from backend:', copyMessage);
            customCommonOverlay().createErrorOverlay(errorMessage, copyMessage);
        }
        globalThis.mainGallery.isLoading = false;
    };

    function ensurePrivacyButton() {
        let privacyButton = document.getElementById('cg-privacy-button');
        if (!privacyButton) {
            privacyButton = document.createElement('button');
            privacyButton.id = 'cg-privacy-button';
            privacyButton.className = 'cg-button';
            privacyButton.textContent = '(X)';
            privacyButton.style.top = '50px';
            privacyButton.style.left = '10px';
            privacyButton.style.background = 'linear-gradient(45deg, red, orange, yellow, green, blue, indigo, violet)';
            privacyButton.addEventListener('click', () => {
                if (privacyBalls.length >= 5) {
                    console.log('Maximum 5 privacy balls reached');
                    return;
                }
                createPrivacyBall();
            });
            container.appendChild(privacyButton);
        }
    }

    function createPrivacyBall() {
        const ball = document.createElement('div');
        ball.className = 'cg-privacy-ball';
        const galleryRect = container.getBoundingClientRect();
        const left = galleryRect.left + galleryRect.width / 2 - 50;
        const top = galleryRect.top + galleryRect.height / 2 - 50;
        ball.style.left = `${left}px`;
        ball.style.top = `${top}px`;
        ball.style.width = '100px';
        ball.style.height = '100px';

        // Apply base64 PNG as background image if available
        if (globalThis.cachedFiles?.privacyBall) {
            ball.style.backgroundImage = `url(${globalThis.cachedFiles.privacyBall})`;
            ball.style.backgroundSize = 'cover';
            ball.style.backgroundPosition = 'center';
            ball.style.backgroundRepeat = 'no-repeat';
        } else {
            // Fallback to original styling with SAA text
            console.warn('Privacy ball image not found in globalThis.cachedFiles.privacyBall');
            ball.innerHTML = 'SAA';
            ball.style.background = 'linear-gradient(45deg, red, orange, yellow, green, blue, indigo, violet)';
        }

        let isDragging = false, startX, startY;
        ball.addEventListener('mousedown', (e) => {
            if (e.button === 0) { 
                e.preventDefault();
                isDragging = true;
                startX = e.clientX - Number.parseFloat(ball.style.left || 0);
                startY = e.clientY - Number.parseFloat(ball.style.top || 0);
                ball.style.cursor = 'grabbing'; 
                document.body.style.userSelect = 'none';
            } else if (e.button === 2) { 
                e.preventDefault();
                const startY = e.clientY;
                const startSize = Number.parseFloat(ball.style.width || 100);

                const onMouseMove = (moveEvent) => {
                    const deltaY = moveEvent.clientY - startY;
                    let newSize = startSize + deltaY;
                    newSize = Math.min(Math.max(newSize, 20), 300); 
                    ball.style.width = `${newSize}px`;
                    ball.style.height = `${newSize}px`;
                    if (!globalThis.cachedFiles?.privacyBall) {
                        ball.style.fontSize = `${newSize * 0.2}px`; 
                    }
                };

                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            ball.style.left = `${e.clientX - startX}px`;
            ball.style.top = `${e.clientY - startY}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                ball.style.cursor = 'grab'; 
                document.body.style.userSelect = '';
            }
        });

        ball.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        ball.addEventListener('dblclick', () => {
            ball.remove();
            privacyBalls = privacyBalls.filter(b => b !== ball);
        });

        document.body.appendChild(ball);
        privacyBalls.push(ball);
    }

    function enterFullscreen(index) {
        const imgUrl = images[index];
        if (!imgUrl) {
            console.error('Invalid image index:', index);
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'cg-fullscreen-overlay';

        const fullScreenImg = document.createElement('img');
        fullScreenImg.src = imgUrl;
        fullScreenImg.className = 'cg-fullscreen-image';

        let isDragging = false, startX = 0, startY = 0, translateX = 0, translateY = 0;

        fullScreenImg.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            fullScreenImg.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        function onMouseMove(e) {
            if (!isDragging) return;
            e.preventDefault();
            e.stopPropagation();

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            translateX += deltaX;
            translateY += deltaY;
            fullScreenImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            startX = e.clientX;
            startY = e.clientY;
        }

        function onMouseUp() {
            isDragging = false;
            fullScreenImg.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        let scale = 1;
        fullScreenImg.addEventListener('wheel', (e) => {
            e.preventDefault();
            scale += e.deltaY * -0.001;
            scale = Math.min(Math.max(0.5, scale), 4);
            fullScreenImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) exitFullscreen();
        });

        document.addEventListener('keydown', handleFullscreenKeyDown);
        overlay.appendChild(fullScreenImg);
        document.body.appendChild(overlay);

        function handleFullscreenKeyDown(e) {
            if (e.key === 'Escape') {
                exitFullscreen();
            } else if (e.key === 'ArrowRight' || e.key === ' ') {
                currentIndex = (currentIndex - 1 + images.length) % images.length;
                fullScreenImg.src = images[currentIndex];
            } else if (e.key === 'ArrowLeft') {
                currentIndex = (currentIndex + 1) % images.length;
                fullScreenImg.src = images[currentIndex];
            }
        }

        function exitFullscreen() {
            overlay.remove();
            document.removeEventListener('keydown', handleFullscreenKeyDown);
            
            if (!isGridMode) {
                let mainImage = document.createElement('img');
                mainImage.src = images[currentIndex];
                updatePreviewBorders();

                let mainImageContainer = container.querySelector('.cg-main-image-container');
                mainImage = mainImageContainer.querySelector('img')
                if (mainImage.src !== images[currentIndex]) {
                    mainImage.src = images[currentIndex];
                }
            }
        }
    }

    function gallery_renderGridMode(incremental = false) {        
        if (!images || images.length === 0) {
            container.innerHTML = '';
            renderedImageCount = 0;
            currentIndex = 0;
            return;
        }
            
        let gallery = container.querySelector('.cg-gallery-grid-container');
        let lastAspectRatio = Number.parseFloat(localStorage.getItem('gridAspectRatio') || '0');
    
        const containerWidth = container.offsetWidth;
        const firstImage = new Image();
        firstImage.src = images.at(-1);
        firstImage.onload = () => {
            const aspectRatio = firstImage.width / firstImage.height;
            const needsRedraw = !incremental || Math.abs(aspectRatio - lastAspectRatio) > 0.001;
    
            if (!gallery || needsRedraw) {
                container.innerHTML = '';
                gallery = document.createElement('div');
                gallery.className = 'cg-gallery-grid-container scroll-container';
                container.appendChild(gallery);
                renderedImageCount = 0;
                gallery.addEventListener('click', (e) => {
                    const imgContainer = e.target.closest('.cg-gallery-item');
                    if (imgContainer) {
                        const index = Number.parseInt(imgContainer.dataset.index);
                        currentIndex = index; 
                        enterFullscreen(index);
                    }
                });
            }
    
            const targetHeight = 200;
            const targetWidth = targetHeight * aspectRatio;
            const itemsPerRow = Math.floor(containerWidth / (targetWidth + 10));
            gallery.style.gridTemplateColumns = `repeat(${itemsPerRow}, ${targetWidth}px)`;
    
            const fragment = document.createDocumentFragment();
            const observer = new IntersectionObserver((entries, observer) => {
                process_oberserver(entries, observer);
            }, { root: gallery, threshold: 0.1 });
    
            for (let i = images.length - 1; i >= renderedImageCount; i--) {
                const imgContainer = document.createElement('div');
                imgContainer.className = 'cg-gallery-item';
                imgContainer.style.width = `${targetWidth}px`;
                imgContainer.style.height = `${targetHeight}px`;
                imgContainer.dataset.index = i;
                const img = document.createElement('img');
                img.className = 'cg-gallery-image';
                img.dataset.src = images[i]; 
                img.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='; 
                img.loading = 'lazy';
                imgContainer.appendChild(img);
                fragment.appendChild(imgContainer);
                observer.observe(imgContainer); 
            }
            gallery.prepend(fragment);
            renderedImageCount = images.length;
    
            localStorage.setItem('gridAspectRatio', aspectRatio.toString());
    
            ensureSwitchModeButton(container, () => {
                isGridMode = !isGridMode;
                currentIndex = images.length - 1;
                isGridMode ? gallery_renderGridMode() : gallery_renderSplitMode();
            }, 'cg-switch-mode-button', images.length);
        };
        firstImage.onerror = () => {
            console.error('Failed to load latest image for grid mode');
            container.innerHTML = '';
            renderedImageCount = 0;
            currentIndex = 0;
        };
    }
    
    function gallery_renderSplitMode(incremental = false) {
        if (!images || images.length === 0) {
            container.innerHTML = '';
            renderedImageCount = 0;
            currentIndex = 0;
            return;
        }

        let mainImageContainer = container.querySelector('.cg-main-image-container');
        let previewContainer = container.querySelector('.cg-preview-container');

        if (!mainImageContainer || !previewContainer || !incremental) {
            container.innerHTML = '';
            mainImageContainer = document.createElement('div');
            mainImageContainer.className = 'cg-main-image-container';
            const mainImage = document.createElement('img');
            mainImage.src = images[currentIndex];
            mainImage.className = 'cg-main-image';
            mainImage.addEventListener('click', () => enterFullscreen(currentIndex));
            mainImageContainer.appendChild(mainImage);
            container.appendChild(mainImageContainer);

            mainImageContainer.addEventListener('click', (e) => {
                e.preventDefault();
                const rect = mainImageContainer.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const isLeft = clickX < rect.width / 2;
                if (e.target !== mainImage && images.length > 1) {
                    if (isLeft) {
                        currentIndex = (currentIndex + 1) % images.length;
                    } else {
                        currentIndex = (currentIndex - 1 + images.length) % images.length;
                    }
                    mainImage.src = images[currentIndex];
                    updatePreviewBorders();
                }
            });

            previewContainer = document.createElement('div');
            previewContainer.className = 'cg-preview-container scroll-container';
            setupScrollableContainer(previewContainer);
            container.appendChild(previewContainer);
            renderedImageCount = 0;

            previewContainer.addEventListener('click', (e) => {
                const previewImage = e.target.closest('.cg-preview-image');
                if (previewImage) {
                    e.preventDefault();
                    const domIndex = Number.parseInt(previewImage.dataset.domIndex);
                    currentIndex = images.length - 1 - domIndex;
                    mainImage.src = images[currentIndex];
                    updatePreviewBorders();
                    centerThumbHorizontally(previewImage);
                }
            });
        }

        const fragment = document.createDocumentFragment();
        const observer = new IntersectionObserver((entries, observer) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.classList.add('visible');
                    observer.unobserve(img);
                }
            }
        }, { root: previewContainer, threshold: 0.1 });

        if (incremental && renderedImageCount < images.length) {
            for (let i = renderedImageCount; i < images.length; i++) {
                const previewImage = document.createElement('img');
                previewImage.className = 'cg-preview-image';
                previewImage.dataset.src = images[i];
                previewImage.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                previewImage.loading = 'lazy';
                previewImage.dataset.domIndex = images.length - 1 - i;
                fragment.appendChild(previewImage);
                observer.observe(previewImage);
            }
        } else {
            for (let i = images.length - 1; i >= 0; i--) {
                const previewImage = document.createElement('img');
                previewImage.className = 'cg-preview-image';
                previewImage.dataset.src = images[i];
                previewImage.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
                previewImage.loading = 'lazy';
                previewImage.dataset.domIndex = images.length - 1 - i;
                fragment.appendChild(previewImage);
                observer.observe(previewImage);
            }
        }

        previewContainer.prepend(fragment);
        renderedImageCount = images.length;

        updatePreviewBorders();
        const currentPreview = previewContainer.querySelector(`.cg-preview-image[data-domIndex="${images.length - 1 - currentIndex}"]`);
        if (currentPreview) {
            centerThumbHorizontally(currentPreview);
        }

        ensureSwitchModeButton(container, () => {
            isGridMode = !isGridMode;
            currentIndex = images.length - 1;
            isGridMode ? gallery_renderGridMode() : gallery_renderSplitMode();
        }, 'cg-switch-mode-button', images.length);
        ensureSeedButton();
        ensureTagButton();
        ensureSendButton();
        ensureWallpaperMenu();
        adjustPreviewContainer(previewContainer);
    }
    
    // Center a thumbnail inside the horizontal preview strip WITHOUT scrolling
    // the page. scrollIntoView() walks every scrollable ancestor (including the
    // whole app), so when the user is scrolled up it yanks them down to the
    // gallery whenever a new image lands; scrolling only the strip avoids that.
    function centerThumbHorizontally(thumb) {
        const scroller = container.querySelector('.cg-preview-container');
        if (!thumb || !scroller) return;
        const tRect = thumb.getBoundingClientRect();
        const sRect = scroller.getBoundingClientRect();
        const delta = (tRect.left + tRect.width / 2) - (sRect.left + sRect.width / 2);
        if (Math.abs(delta) > 1) scroller.scrollBy({ left: delta, behavior: 'smooth' });
    }

    function updatePreviewBorders() {
        const previewImages = container.querySelectorAll('.cg-preview-image');
        for (const [domIndex, child] of [...previewImages].entries()) {
            const index = images.length - 1 - domIndex;
            child.dataset.domIndex = domIndex;
            child.style.border = index === currentIndex ? '2px solid #3498db' : 'none';
        }
        const domIndex = images.length - 1 - currentIndex;
        if (domIndex >= 0 && domIndex < previewImages.length) {
            centerThumbHorizontally(previewImages[domIndex]);
        }
    }

    // A horizontal toolbar across the top of the gallery for the Seed / Tags /
    // Send buttons (instead of absolutely-stacked overlapping buttons).
    function getGalleryToolbar() {
        let bar = container.querySelector('.cg-toolbar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'cg-toolbar';
            container.appendChild(bar);
        }
        return bar;
    }

    function ensureSeedButton() {
        let seedButton = document.getElementById('cg-seed-button');
        if (!seedButton) {
            seedButton = document.createElement('button');
            seedButton.id = 'cg-seed-button';
            seedButton.className = 'cg-button';
            seedButton.textContent = 'Seed';
            seedButton.addEventListener('click', async () => {
                if (!seeds?.[currentIndex]) return;
    
                const seedToCopy = seeds[currentIndex].trim();
                try {
                    await navigator.clipboard.writeText(seedToCopy);
                    seedButton.textContent = 'Copied!';
                } catch (err) {
                    seedButton.textContent = 'Copy failed!';
                    console.warn('Failed to copy seed:', err);
                    const SETTINGS = globalThis.globalSettings;
                    const FILES = globalThis.cachedFiles;
                    const LANG = FILES.language[SETTINGS.language];
                    globalThis.overlay.custom.createCustomOverlay(
                        'none', LANG.saac_macos_clipboard.replace('{0}', seedToCopy), 
                        384, 'center', 'left', null, 'Clipboard');
                } finally {                                        
                    setTimeout(() => {
                        seedButton.textContent = 'Seed';
                    }, 2000);
                    updateSeedInputs(seedToCopy);
                }
            });
            getGalleryToolbar().appendChild(seedButton);
        }
    }
    
    function updateSeedInputs(seedToCopy) {
        const lastSeed = globalThis.generate.seed.getValue();
        const newSeed = Number.parseInt(seedToCopy);
        if(lastSeed === newSeed) {
            globalThis.generate.seed.setValue(-1);
        } else {
            globalThis.generate.seed.setValue(newSeed);
        }
    }

    function ensureTagButton() {
        let tagButton = document.getElementById('cg-tag-button');
        if (!tagButton) {
            tagButton = document.createElement('button');
            tagButton.id = 'cg-tag-button';
            tagButton.className = 'cg-button';
            tagButton.textContent = 'Tags';
            tagButton.addEventListener('click', async () => {
                if (!tags?.[currentIndex]) return;
    
                const tagToCopy = tags[currentIndex].trim();
                try {
                    await navigator.clipboard.writeText(tagToCopy);
                    tagButton.textContent = 'Copied!';                    
                } catch (err) {
                    tagButton.textContent = 'Copy failed!';
                    console.warn('Failed to copy tag:', err);
                    const SETTINGS = globalThis.globalSettings;
                    const FILES = globalThis.cachedFiles;
                    const LANG = FILES.language[SETTINGS.language];
                    globalThis.overlay.custom.createCustomOverlay(
                        'none', LANG.saac_macos_clipboard.replace('{0}', tagToCopy),
                        384, 'center', 'left', null, 'Clipboard');
                } finally {
                    setTimeout(() => {
                        tagButton.textContent = 'Tags';
                    }, 2000);
                }
            });
            getGalleryToolbar().appendChild(tagButton);
        }
    }

    // Right-click a gallery image -> set it as the OS desktop wallpaper.
    function ensureWallpaperMenu() {
        if (container._wallpaperMenuSet) return;
        container._wallpaperMenuSet = true;
        let menuEl = null;
        const close = () => {
            if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('mousedown', onDoc, true); }
        };
        const onDoc = (e) => { if (menuEl && !menuEl.contains(e.target)) close(); };
        container.addEventListener('contextmenu', (e) => {
            const img = e.target.closest && e.target.closest('img');
            if (!img) return;
            e.preventDefault();
            e.stopPropagation();
            close();
            const LANG = globalThis.cachedFiles.language[globalThis.globalSettings.language];
            menuEl = document.createElement('div');
            menuEl.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:10080;`
                + 'background:rgba(17,17,17,0.96);border:2px solid #333;border-radius:8px;padding:6px;'
                + 'color:#eee;font-size:14px;min-width:200px;box-shadow:0 4px 8px rgba(0,0,0,0.4);';
            const item = document.createElement('div');
            item.style.cssText = 'padding:8px 12px;cursor:pointer;border-radius:6px;white-space:nowrap;';
            item.textContent = LANG.gallery_set_wallpaper || 'Set as desktop background';
            item.addEventListener('mouseover', () => { item.style.background = 'rgba(255,255,255,0.12)'; });
            item.addEventListener('mouseout', () => { item.style.background = 'transparent'; });
            item.addEventListener('click', async () => {
                close();
                const src = (img.src && img.src.startsWith('data:')) ? img.src
                    : (img.dataset && img.dataset.src) ? img.dataset.src
                        : images[currentIndex];
                try {
                    if (globalThis.inBrowser) {
                        console.warn('[wallpaper] desktop-only feature');
                    } else {
                        const res = await globalThis.api.setWallpaper(src);
                        if (!res || !res.ok) console.warn('[wallpaper]', res);
                    }
                } catch (err) {
                    console.error('[wallpaper]', err);
                }
            });
            menuEl.appendChild(item);

            // Save the image to a file with the app's UI state embedded, so
            // dropping it back in restores the exact view/character selections.
            const saveItem = document.createElement('div');
            saveItem.style.cssText = 'padding:8px 12px;cursor:pointer;border-radius:6px;white-space:nowrap;';
            saveItem.textContent = LANG.gallery_save_image || 'Save image (with settings)';
            saveItem.addEventListener('mouseover', () => { saveItem.style.background = 'rgba(255,255,255,0.12)'; });
            saveItem.addEventListener('mouseout', () => { saveItem.style.background = 'transparent'; });
            saveItem.addEventListener('click', () => {
                close();
                let idx = currentIndex;
                if (img.classList.contains('cg-preview-image') && img.dataset.domIndex !== undefined) {
                    idx = images.length - 1 - Number.parseInt(img.dataset.domIndex);
                }
                let src = images[idx];
                if (!src) return;
                if (!src.startsWith('data:')) src = 'data:image/png;base64,' + src;
                const out = states[idx] ? embedSaaState(src, states[idx]) : src;
                const a = document.createElement('a');
                a.href = out;
                a.download = `saa_${seeds[idx] || 'image'}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            });
            menuEl.appendChild(saveItem);

            document.body.appendChild(menuEl);
            setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
        }, true);
    }

    function ensureSendButton() {
        let sendButton = document.getElementById('cg-send-button');
        if (sendButton) return;
        const LANG = globalThis.cachedFiles.language[globalThis.globalSettings.language];
        const label = LANG.gallery_send_settings || 'Send all settings';
        sendButton = document.createElement('button');
        sendButton.id = 'cg-send-button';
        sendButton.className = 'cg-button';
        sendButton.textContent = label;
        sendButton.title = LANG.gallery_send_settings_title || 'Apply all settings from this image';
        sendButton.addEventListener('click', async () => {
            const base64 = images[currentIndex];
            if (!base64) return;
            try {
                let result;
                if (globalThis.inBrowser) {
                    result = await sendWebSocketMessage({ type: 'API', method: 'readBase64Image', params: [base64] });
                } else {
                    result = await globalThis.api.readBase64Image(base64);
                }
                const md = { fileName: 'gallery', fileType: 'image/png', generationParameters: result?.metadata };
                const parsed = parseGenerationParameters(md);
                parsed.saaState = result?.metadata?.['saa-state'] || null;
                const hasEmbedded = parsed.positivePrompt || parsed.otherParams;
                if (hasEmbedded) {
                    applyImageSettings(parsed, 'all');
                } else {
                    // Fall back to the prompt + seed the gallery already stored.
                    if (tags?.[currentIndex]) globalThis.prompt.common.setValue(tags[currentIndex].trim());
                    if (seeds?.[currentIndex] !== undefined) {
                        const s = Number.parseInt(seeds[currentIndex]);
                        if (!Number.isNaN(s)) globalThis.generate.seed.setValue(s);
                    }
                }
                // Gallery images aren't embedded until saved, so prefer the
                // exact in-memory state for the active image when available.
                if (!parsed.saaState && states?.[currentIndex]) restoreSaaState(states[currentIndex]);
                sendButton.textContent = LANG.gallery_send_settings_done || 'Sent!';
            } catch (err) {
                console.error('[gallery] send settings failed:', err);
                sendButton.textContent = 'Failed!';
            } finally {
                setTimeout(() => { sendButton.textContent = label; }, 2000);
            }
        });
        getGalleryToolbar().appendChild(sendButton);
    }
}
