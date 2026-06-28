import { ipcMain, app } from 'electron';
import * as fs from 'node:fs';
import path from 'node:path';

const CAT = '[imageSave]';

// Write a generated image (data URL) to disk silently. Used for auto-saving
// each generation with the embedded saa-state chunk. Falls back to a folder in
// the user's Pictures dir if the requested directory can't be created.
function saveGeneratedImage(dataUrl, filename, dir) {
    try {
        const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUrl || '');
        if (!m) return { ok: false, error: 'invalid image data' };
        const buf = Buffer.from(m[2], 'base64');

        const fallback = path.join(app.getPath('pictures'), 'SAA-edit');
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
