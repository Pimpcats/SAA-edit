import { app, ipcMain, dialog } from 'electron';
import * as fs from 'node:fs';
import path from 'node:path';
import { loadCSVFile, loadJSONFile } from './fileHandlers.js';

const CAT = '[FileCache]';

let cachedCharacterThumb = {}; 
let cachedLanguages = {};
let cachedCharacter = {};
let cachedOCCharacter = {};
let cachedViewTags = {};
let cachedTagAssist = {}
let cachedLoadingWait = {};
let cachedLoadingFailed = {};
let cachedPrivacyBall = {};

const appPath = app.isPackaged ? path.join(path.dirname(app.getPath('exe')), 'resources', 'app') : app.getAppPath();

function setupCachedFiles(){
    function loadFileEx(saveDir, fileName, dataPointer)
    {
        const filePath = path.join(appPath, saveDir, fileName);
        if (fs.existsSync(filePath)) {       
            
            const ext = path.extname(filePath).toLowerCase();
                        
            if (ext === '.csv') {
                const data = loadCSVFile(filePath);      
                Object.assign(dataPointer, data);            
            } else if (ext === '.json') {
                const data = loadJSONFile(filePath);      
                Object.assign(dataPointer, data); 
            } else {
                console.error(`${CAT}: ${fileName} load failed`);
                return false;
            }
            console.log(`${CAT}: ${fileName} loaded into memory`);
        } else {
            console.error(`${CAT}: ${fileName} load failed`);
            dialog.showErrorBox(CAT, `${fileName} load failed`);
            return false;
        }
        return true;
    }

    function loadImageEx(filePath, fileName, dataPointer) {
        const fileFullPath = path.join(appPath, filePath, fileName);
        if (fs.existsSync(fileFullPath)) {
            try {
                const fileBuffer = fs.readFileSync(fileFullPath);               
                const base64Data = fileBuffer.toString('base64');
                dataPointer.data = base64Data;

                console.log(`${CAT}: ${fileName} loaded into memory, size: ${fileBuffer.length} bytes`);
                return true;
            } catch (error) {
                console.error(`${CAT}: Error loading ${fileName}: ${error.message}`);
                return false;
            }
        } else {
            console.error(`${CAT}: ${fileName} load failed - file does not exist at ${fileFullPath}`);
            return false;
        }
    }

    const thumb = loadFileEx('data', 'wai_character_thumbs.json', cachedCharacterThumb);
    const language = loadFileEx('data', 'language.json', cachedLanguages);
    const characters = loadFileEx('data', 'wai_characters.csv', cachedCharacter);
    const character_tag_assist = loadFileEx('data', 'wai_tag_assist.json', cachedTagAssist);
    const oc_characters = loadFileEx('data', 'original_character.json', cachedOCCharacter);
    const view_tags = loadFileEx('data', 'view_tags.json', cachedViewTags);

    let filePath = path.join('data', 'imgs');
    const loadingWait = loadImageEx(filePath, 'loading_wait.png', cachedLoadingWait);
    const loadingFailed = loadImageEx(filePath, 'loading_failed.png', cachedLoadingFailed);
    const privacyBall = loadImageEx(filePath, 'privacy_ball.png', cachedPrivacyBall);
    
    ipcMain.handle('get-cached-files', async () => {
        return {
            characterThumb: cachedCharacterThumb,
            languages: cachedLanguages,
            characters: cachedCharacter,
            ocCharacters: cachedOCCharacter,
            viewTags: cachedViewTags,
            tagAssist: cachedTagAssist,
            loadingWait: cachedLoadingWait,
            loadingFailed: cachedLoadingFailed,
            privacyBall: cachedPrivacyBall
        };
    });

    ipcMain.handle('save-view-tags', async (event, viewTags) => {
        return saveViewTags(viewTags);
    });

    ipcMain.handle('search-character-tags', async (event, query, limit) => {
        return searchCharacterTags(query, limit);
    });

    ipcMain.handle('append-character', async (event, displayName, tag) => {
        return appendCharacter(displayName, tag);
    });

    return thumb && language && characters && oc_characters && view_tags && character_tag_assist && loadingWait && loadingFailed && privacyBall;
}

// Lazily-loaded list of danbooru Character-category (4) tags, used by the
// Add Character editor to search for valid character tags offline.
let danbooruCharacters = null;

function loadDanbooruCharacters() {
    if (danbooruCharacters !== null) return danbooruCharacters;
    danbooruCharacters = [];
    const filePath = path.join(appPath, 'data', 'danbooru_e621_merged.csv');
    if (!fs.existsSync(filePath)) {
        console.warn(CAT, 'danbooru_e621_merged.csv not found; character search unavailable');
        return danbooruCharacters;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        for (const line of raw.split('\n')) {
            if (!line) continue;
            // format: tag,category,postcount,"aliases"
            const i1 = line.indexOf(',');
            if (i1 === -1) continue;
            const rest1 = line.slice(i1 + 1);
            const i2 = rest1.indexOf(',');
            if (i2 === -1) continue;
            const category = rest1.slice(0, i2);
            if (category !== '4') continue;
            const tag = line.slice(0, i1);
            const rest2 = rest1.slice(i2 + 1);
            const i3 = rest2.indexOf(',');
            const count = i3 === -1 ? rest2 : rest2.slice(0, i3);
            const aliases = i3 === -1 ? '' : rest2.slice(i3 + 1).replaceAll('"', '');
            danbooruCharacters.push({ tag, count: Number(count) || 0, aliases });
        }
        danbooruCharacters.sort((a, b) => b.count - a.count);
        console.log(CAT, `Loaded ${danbooruCharacters.length} danbooru character tags`);
    } catch (err) {
        console.error(CAT, `Failed to load danbooru characters: ${err.message}`);
    }
    return danbooruCharacters;
}

function searchCharacterTags(query, limit = 30) {
    const list = loadDanbooruCharacters();
    const q = (query || '').trim().toLowerCase().replaceAll(' ', '_');
    if (q === '') return [];
    const results = [];
    for (const entry of list) {
        if (entry.tag.includes(q) || (entry.aliases && entry.aliases.toLowerCase().includes(q))) {
            results.push({
                tag: entry.tag,
                displayTag: entry.tag.replaceAll('_', ' '),
                count: entry.count,
                aliases: entry.aliases
            });
            if (results.length >= limit) break;
        }
    }
    return results;
}

function appendCharacter(displayName, tag) {
    let name = (displayName || '').trim().replaceAll(/[\r\n,]/g, ' ').trim();
    const value = (tag || '').trim().replaceAll(/[\r\n,]/g, ' ').trim();
    if (name === '') name = value;
    if (value === '') {
        console.error(CAT, 'appendCharacter: empty tag');
        return false;
    }
    if (Object.hasOwn(cachedCharacter, name)) {
        console.warn(CAT, `Character "${name}" already exists; not appending`);
        return false;
    }
    const filePath = path.join(appPath, 'data', 'wai_characters.csv');
    try {
        const prefix = fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8').endsWith('\n') ? '' : '\n';
        fs.appendFileSync(filePath, `${prefix}${name},${value}\n`, 'utf8');
        cachedCharacter[name] = value;
        console.log(CAT, `Appended character: ${name} => ${value}`);
        return true;
    } catch (err) {
        console.error(CAT, `Failed to append character: ${err.message}`);
        return false;
    }
}

function saveViewTags(viewTags) {
    if (!viewTags || typeof viewTags !== 'object' || Array.isArray(viewTags)) {
        console.error(CAT, 'Invalid viewTags: must be an object');
        return false;
    }
    const filePath = path.join(appPath, 'data', 'view_tags.json');
    try {
        fs.writeFileSync(filePath, JSON.stringify(viewTags, null, 4), 'utf8');
        // Refresh the in-memory cache so other consumers see the change.
        for (const key of Object.keys(cachedViewTags)) delete cachedViewTags[key];
        Object.assign(cachedViewTags, viewTags);
        console.log(CAT, 'Saved view_tags.json');
        return true;
    } catch (err) {
        console.error(CAT, `Failed to save view_tags.json: ${err.message}`);
        return false;
    }
}

function getCachedFiles() {
    return {
        characterThumb: cachedCharacterThumb,
        languages: cachedLanguages,
        characters: cachedCharacter,
        ocCharacters: cachedOCCharacter,
        viewTags: cachedViewTags,
        tagAssist: cachedTagAssist,
        loadingWait: cachedLoadingWait,
        loadingFailed: cachedLoadingFailed,
        privacyBall: cachedPrivacyBall
    };
}   

function getCachedFilesWithoutThumb() {
    return {
        //characterThumb: cachedCharacterThumb,
        languages: cachedLanguages,
        characters: cachedCharacter,
        ocCharacters: cachedOCCharacter,
        viewTags: cachedViewTags,
        tagAssist: cachedTagAssist,
        loadingWait: cachedLoadingWait,
        loadingFailed: cachedLoadingFailed,
        privacyBall: cachedPrivacyBall
    };
}   

function getCharacterThumb(md5Chara) {
    if (cachedCharacterThumb[md5Chara] === undefined) {
        console.warn(CAT, `Character thumb for ${md5Chara} not found in cache.`);
        return null;
    }
    
    return cachedCharacterThumb[md5Chara];
}

export {
    setupCachedFiles,
    getCachedFiles,
    getCachedFilesWithoutThumb,
    getCharacterThumb,
    saveViewTags,
    searchCharacterTags,
    appendCharacter
};