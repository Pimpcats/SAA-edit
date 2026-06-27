import { sendWebSocketMessage } from '../../webserver/front/wsRequest.js';
import { showDialog } from './components/myDialog.js';

const CAT = '[characterEditor]';

// Add Character editor: search the local danbooru character tags, pick one,
// give it a display name, and append it to wai_characters.csv. Warns on any
// fuzzy-duplicate name/tag already in the list.
export function setupCharacterEditor(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }

    function getLang() {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language];
    }

    function tokenize(s) {
        return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    }
    function isSubset(a, b) { return a.length > 0 && a.every(t => b.includes(t)); }
    function collides(a, b) { return isSubset(a, b) || isSubset(b, a); }

    // Find existing characters whose name OR tag fuzzily matches the candidate.
    function findDuplicates(name, tag) {
        const nameTokens = tokenize(name);
        const tagTokens = tokenize(tag);
        const chars = globalThis.cachedFiles.characters || {};
        const matches = [];
        for (const [exName, exTag] of Object.entries(chars)) {
            if (collides(tagTokens, tokenize(exTag)) || collides(nameTokens, tokenize(exName))) {
                matches.push(`${exName}  =>  ${exTag}`);
                if (matches.length >= 8) break;
            }
        }
        return matches;
    }

    async function searchTags(query) {
        if (globalThis.inBrowser) {
            return await sendWebSocketMessage({ type: 'API', method: 'searchCharacterTags', params: [query, 30] });
        }
        return await globalThis.api.searchCharacterTags(query, 30);
    }

    function refreshCharacterDropdown() {
        const chars = globalThis.cachedFiles.characters;
        const keys = Object.keys(chars);
        const values = Object.values(chars);
        const oc_keys = Object.keys(globalThis.cachedFiles.ocCharacters || {});
        const LANG = getLang();
        const labelPrefixList = `${LANG.character1},${LANG.character2},${LANG.character3},${LANG.original_character}`;
        if (globalThis.characterList) {
            globalThis.characterList.setOptions([keys, values], oc_keys, labelPrefixList, 'None', 'None', 'None', 'None', true);
        }
        globalThis.cachedFiles.characterListArray = Object.entries(chars);
    }

    // Build UI
    container.innerHTML = '';
    container.classList.add('character-editor');

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'character-editor-search';
    searchInput.placeholder = getLang().character_editor_search || 'Search danbooru characters...';

    const results = document.createElement('div');
    results.className = 'character-editor-results';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'character-editor-name';
    nameInput.placeholder = getLang().character_editor_name || 'Display name';

    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.className = 'character-editor-tag';
    tagInput.placeholder = getLang().character_editor_tag || 'Character tag';

    const addButton = document.createElement('button');
    addButton.className = 'character-editor-add';
    addButton.textContent = getLang().character_editor_add || 'Add Character';

    const status = document.createElement('div');
    status.className = 'character-editor-status';

    let searchTimer = null;
    searchInput.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        const query = searchInput.value;
        searchTimer = setTimeout(async () => {
            results.innerHTML = '';
            if (query.trim() === '') return;
            let list = [];
            try {
                list = await searchTags(query);
            } catch (err) {
                console.error(CAT, 'search failed:', err);
            }
            for (const item of list) {
                const row = document.createElement('div');
                row.className = 'character-editor-result';
                row.textContent = `${item.displayTag}  (${item.count})`;
                row.title = item.aliases || '';
                row.addEventListener('click', () => {
                    tagInput.value = item.displayTag;
                    if (nameInput.value.trim() === '') nameInput.value = item.displayTag;
                });
                results.appendChild(row);
            }
        }, 250);
    });

    addButton.addEventListener('click', async () => {
        const tag = tagInput.value.trim();
        const name = nameInput.value.trim() || tag;
        if (tag === '') {
            status.textContent = getLang().character_editor_need_tag || 'Pick or enter a character tag first.';
            return;
        }

        const dups = findDuplicates(name, tag);
        if (dups.length > 0) {
            const msg = (getLang().character_editor_dup_confirm
                || 'Similar character(s) already exist:\n{0}\n\nAdd anyway?').replace('{0}', dups.join('\n'));
            const ok = await showDialog('confirm', { message: msg });
            if (!ok) { status.textContent = getLang().character_editor_cancelled || 'Cancelled.'; return; }
        }

        let result;
        if (globalThis.inBrowser) {
            result = await sendWebSocketMessage({ type: 'API', method: 'appendCharacter', params: [name, tag] });
        } else {
            result = await globalThis.api.appendCharacter(name, tag);
        }

        if (result === true) {
            globalThis.cachedFiles.characters[name] = tag;
            refreshCharacterDropdown();
            status.textContent = (getLang().character_editor_added || 'Added: {0}').replace('{0}', name);
            searchInput.value = '';
            nameInput.value = '';
            tagInput.value = '';
            results.innerHTML = '';
        } else {
            status.textContent = (getLang().character_editor_failed || 'Could not add "{0}" (already exists?).').replace('{0}', name);
        }
    });

    container.appendChild(searchInput);
    container.appendChild(results);
    const inputRow = document.createElement('div');
    inputRow.className = 'character-editor-input-row';
    inputRow.appendChild(nameInput);
    inputRow.appendChild(tagInput);
    inputRow.appendChild(addButton);
    container.appendChild(inputRow);
    container.appendChild(status);

    return { refresh: refreshCharacterDropdown };
}
