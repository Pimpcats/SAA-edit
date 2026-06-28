import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const CAT = '[wallpaper]';

// Set the OS desktop wallpaper from a data URL (base64 image).
function setWallpaper(dataUrl) {
    return new Promise((resolve) => {
        try {
            const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUrl || '');
            if (!m) return resolve({ ok: false, error: 'invalid image data' });
            const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
            const buf = Buffer.from(m[2], 'base64');
            const file = path.join(os.tmpdir(), `saa_wallpaper.${ext}`);
            fs.writeFileSync(file, buf);

            if (process.platform === 'win32') {
                const safe = file.replaceAll("'", "''");
                const ps = "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;"
                    + 'public class W{[DllImport("user32.dll",CharSet=CharSet.Auto)]'
                    + "public static extern int SystemParametersInfo(int u,int p,string v,int f);}';"
                    + ` [W]::SystemParametersInfo(20,0,'${safe}',3)`;
                execFile('powershell', ['-NoProfile', '-Command', ps], (err) => {
                    resolve(err ? { ok: false, error: err.message } : { ok: true });
                });
            } else if (process.platform === 'darwin') {
                execFile('osascript', ['-e', `tell application "System Events" to set picture of every desktop to "${file}"`],
                    (err) => resolve(err ? { ok: false, error: err.message } : { ok: true }));
            } else {
                execFile('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri', `file://${file}`],
                    (err) => resolve(err ? { ok: false, error: err.message } : { ok: true }));
            }
        } catch (err) {
            console.error(CAT, err.message);
            resolve({ ok: false, error: err.message });
        }
    });
}

export function setupWallpaper() {
    ipcMain.handle('set-wallpaper', async (event, dataUrl) => setWallpaper(dataUrl));
}
