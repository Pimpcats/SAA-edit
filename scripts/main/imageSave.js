import { ipcMain, app } from 'electron';
import * as fs from 'node:fs';
import path from 'node:path';

const CAT = '[imageSave]';

// The directory SAA-edit is installed in (where the exe lives when packaged,
// or the project root in dev) — the default home for auto-saved images.
function installDir() {
    return app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
}

// Write a generated image (data URL) to disk silently. Used for auto-saving
// each generation with the embedded saa-state chunk. Falls back to an "outputs"
// folder under the install directory if the requested directory can't be made.
function saveGeneratedImage(dataUrl, filename, dir) {
    try {
        const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUrl || '');
        if (!m) return { ok: false, error: 'invalid image data' };
        const buf = Buffer.from(m[2], 'base64');

        const fallback = path.join(installDir(), 'outputs');
        let outDir = (dir && String(dir).trim()) ? String(dir).trim() : fallback;
        try {
            fs.mkdirSync(outDir, { recursive: true });
        } catch (e) {
            console.warn(CAT, `Could not use "${outDir}" (${e.message}); falling back`);
            outDir = fallback;
            fs.mkdirSync(outDir, { recursive: true });
        }

        const safeName = String(filename || 'saa_image.png').replaceAll(/[\\/:*?"<>|]/g, '_');
        const file = path.join(outDir, safeName);
        fs.writeFileSync(file, buf);
        return { ok: true, path: file };
    } catch (err) {
        console.error(CAT, err.message);
        return { ok: false, error: err.message };
    }
}

export function setupImageSave() {
    ipcMain.handle('save-generated-image', async (event, dataUrl, filename, dir) =>
        saveGeneratedImage(dataUrl, filename, dir));
}
