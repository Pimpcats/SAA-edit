import { callback_myViewList_Update, callback_myCharacterList_updateThumb } from './callbacks.js';

// Round-trips the app UI state that A1111 PNG metadata can't represent — the
// exact view-tag dropdown selections (including "random"/"none") and the
// character slots — by embedding it as a custom "saa-state" tEXt chunk in the
// saved PNG and restoring it when such an image is dropped back in.

const VIEW_SLOTS = 7;
const CHAR_SLOTS = 4;

export function captureSaaState() {
    const vl = globalThis.viewList;
    const cl = globalThis.characterList;
    const views = [];
    const viewWeights = [];
    for (let i = 0; i < VIEW_SLOTS; i++) {
        views.push(vl?.getValue?.()?.[i] ?? 'none');
        viewWeights.push(vl?.getTextValue?.(i) ?? '1.0');
    }
    const chars = [];
    const charWeights = [];
    for (let i = 0; i < CHAR_SLOTS; i++) {
        chars.push(cl?.getKey?.()?.[i] ?? 'None');
        charWeights.push(cl?.getTextValue?.(i) ?? '1.0');
    }
    return { v: 1, views, viewWeights, chars, charWeights };
}

export function restoreSaaState(state) {
    if (!state || typeof state !== 'object') return false;
    const vl = globalThis.viewList;
    const cl = globalThis.characterList;
    if (vl?.setSlotValue && Array.isArray(state.views)) {
        state.views.forEach((v, i) => { if (i < VIEW_SLOTS) vl.setSlotValue(i, v); });
        if (vl.setTextValue && Array.isArray(state.viewWeights)) {
            state.viewWeights.forEach((w, i) => { if (i < VIEW_SLOTS) vl.setTextValue(i, w); });
        }
        try { callback_myViewList_Update(); } catch { /* best effort */ }
    }
    if (cl?.setSlotValue && Array.isArray(state.chars)) {
        state.chars.forEach((c, i) => { if (i < CHAR_SLOTS) cl.setSlotValue(i, c); });
        if (cl.setTextValue && Array.isArray(state.charWeights)) {
            state.charWeights.forEach((w, i) => { if (i < CHAR_SLOTS) cl.setTextValue(i, w); });
        }
        try { callback_myCharacterList_updateThumb(); } catch { /* best effort */ }
    }
    return true;
}

// The PNG reader hands the chunk back as either a JSON string or (if it parsed)
// an object; normalize to an object.
export function parseSaaState(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
}

// --- PNG tEXt chunk embedding -------------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function dataUrlToBytes(dataUrl) {
    const b64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function bytesToPngDataUrl(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return 'data:image/png;base64,' + btoa(bin);
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
function isPng(bytes) {
    for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
    return true;
}

// Insert a tEXt chunk (keyword "saa-state") just before IEND. Returns a PNG
// data URL, or the input unchanged if it is not a PNG.
export function embedSaaState(dataUrl, stateObj) {
    try {
        if (!dataUrl || !stateObj) return dataUrl;
        const bytes = dataUrlToBytes(dataUrl);
        if (!isPng(bytes)) return dataUrl;

        const keyword = 'saa-state';
        const text = JSON.stringify(stateObj);
        const dataLen = keyword.length + 1 + text.length;

        // type + data (used for both the chunk body and the CRC)
        const typeAndData = new Uint8Array(4 + dataLen);
        const writeAscii = (s, off) => { for (let i = 0; i < s.length; i++) typeAndData[off + i] = s.charCodeAt(i) & 0xFF; return off + s.length; };
        let p = writeAscii('tEXt', 0);
        p = writeAscii(keyword, p);
        typeAndData[p++] = 0;
        writeAscii(text, p);

        const chunk = new Uint8Array(12 + dataLen);
        const dv = new DataView(chunk.buffer);
        dv.setUint32(0, dataLen);
        chunk.set(typeAndData, 4);
        dv.setUint32(8 + dataLen, crc32(typeAndData));

        // Find the IEND chunk (its 4-byte length field starts 4 bytes before 'IEND').
        let iendStart = -1;
        for (let i = bytes.length - 8; i >= 8; i--) {
            if (bytes[i] === 0x49 && bytes[i + 1] === 0x45 && bytes[i + 2] === 0x4E && bytes[i + 3] === 0x44) {
                iendStart = i - 4;
                break;
            }
        }
        if (iendStart < 0) return dataUrl;

        const out = new Uint8Array(bytes.length + chunk.length);
        out.set(bytes.subarray(0, iendStart), 0);
        out.set(chunk, iendStart);
        out.set(bytes.subarray(iendStart), iendStart + chunk.length);
        return bytesToPngDataUrl(out);
    } catch (err) {
        console.error('[saaState] embed failed:', err);
        return dataUrl;
    }
}
