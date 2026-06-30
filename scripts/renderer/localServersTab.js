// Local Servers section: let the app launch the ComfyUI / A1111 backends
// itself, headless (server only — never opens a browser page). Point each
// backend at its launch script, optionally auto-start with the app, and the
// servers are shut down when the app closes. Lives in its own collapsible
// section so all the fields are visible and scrollable.

const CAT = '[localServers]';

function getLang() {
    try {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language] || {};
    } catch {
        return {};
    }
}

export function setupLocalServers(containerId) {
    const container = document.querySelector(`.${containerId}`);
    if (!container) {
        console.error(CAT, 'Container not found', `.${containerId}`);
        return null;
    }
    container.innerHTML = '';

    const parseArgsStr = (s) => (String(s || '').match(/"[^"]*"|'[^']*'|\S+/g) || [])
        .map(a => a.replace(/^["']|["']$/g, ''));
    const persistServerSettings = () => {
        if (globalThis.api?.saveSettingFile)
            globalThis.api.saveSettingFile('settings.json', globalThis.globalSettings).catch(() => {});
    };

    const hint = document.createElement('div');
    hint.className = 'video-status';
    hint.style.opacity = '0.85';
    hint.style.margin = '4px 0';
    hint.textContent = getLang().video_servers_hint || '';
    container.appendChild(hint);

    // Build one launch row for a backend.
    const makeServerRow = (id, labelKey, pathKey, argsKey, autoKey, addrGetter) => {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.gap = '3px';
        wrap.style.borderTop = '1px solid rgba(255,255,255,0.08)';
        wrap.style.padding = '8px 0';

        const lbl = document.createElement('span');
        lbl.className = 'video-label';
        lbl.style.fontWeight = 'bold';
        lbl.textContent = getLang()[labelKey] || labelKey;

        const pathInput = document.createElement('input');
        pathInput.type = 'text';
        pathInput.className = 'video-text';
        pathInput.placeholder = getLang().video_srv_path_ph || 'full path to your .bat / executable';
        pathInput.value = globalThis.globalSettings[pathKey] || '';
        pathInput.addEventListener('change', () => {
            globalThis.globalSettings[pathKey] = pathInput.value.trim(); persistServerSettings();
        });

        const argsInput = document.createElement('input');
        argsInput.type = 'text';
        argsInput.className = 'video-text';
        argsInput.placeholder = getLang().video_srv_args_ph || 'extra args (optional)';
        argsInput.value = globalThis.globalSettings[argsKey] || '';
        argsInput.addEventListener('change', () => {
            globalThis.globalSettings[argsKey] = argsInput.value.trim(); persistServerSettings();
        });

        const ctrlRow = document.createElement('div');
        ctrlRow.className = 'video-row';

        const autoLabel = document.createElement('label');
        autoLabel.style.display = 'flex';
        autoLabel.style.alignItems = 'center';
        autoLabel.style.gap = '4px';
        const autoChk = document.createElement('input');
        autoChk.type = 'checkbox';
        autoChk.checked = !!globalThis.globalSettings[autoKey];
        autoChk.addEventListener('change', () => {
            globalThis.globalSettings[autoKey] = autoChk.checked; persistServerSettings();
        });
        autoLabel.appendChild(autoChk);
        const autoTxt = document.createElement('span');
        autoTxt.className = 'video-status';
        autoTxt.textContent = getLang().video_srv_autostart || 'Auto-start with app';
        autoLabel.appendChild(autoTxt);

        const startBtn = document.createElement('button');
        startBtn.className = 'video-btn';
        startBtn.textContent = getLang().video_srv_start || 'Start';
        const stopBtn = document.createElement('button');
        stopBtn.className = 'video-btn';
        stopBtn.textContent = getLang().video_srv_stop || 'Stop';
        const srvStatus = document.createElement('span');
        srvStatus.className = 'video-test-status';

        const refreshStatus = async () => {
            if (!globalThis.api?.serverStatus) return;
            const st = await globalThis.api.serverStatus(id).catch(() => null);
            if (st && st.running) {
                srvStatus.className = 'video-test-status ok';
                srvStatus.textContent = getLang().video_srv_running || 'Running ✓';
            }
        };

        startBtn.addEventListener('click', async () => {
            if (!globalThis.api?.serverLaunch) {
                srvStatus.className = 'video-test-status err';
                srvStatus.textContent = getLang().video_srv_na || 'Server launch is desktop-only.';
                return;
            }
            const command = pathInput.value.trim();
            if (!command) {
                srvStatus.className = 'video-test-status err';
                srvStatus.textContent = getLang().video_srv_no_path || 'Set the launch script path first.';
                return;
            }
            globalThis.globalSettings[pathKey] = command;
            globalThis.globalSettings[argsKey] = argsInput.value.trim();
            persistServerSettings();
            startBtn.disabled = true;
            srvStatus.className = 'video-test-status';
            srvStatus.textContent = getLang().video_srv_starting || 'Starting…';
            const res = await globalThis.api.serverLaunch(id, {
                command,
                args: parseArgsStr(argsInput.value),
                addr: addrGetter(),
            }).catch(err => ({ ok: false, error: err.message }));
            startBtn.disabled = false;
            if (!res || !res.ok) {
                srvStatus.className = 'video-test-status err';
                srvStatus.textContent = (getLang().video_srv_failed || 'Failed to start ✗')
                    + (res?.error ? ` (${res.error})` : '');
            } else if (res.ready) {
                srvStatus.className = 'video-test-status ok';
                srvStatus.textContent = getLang().video_srv_ready || 'Running, API ready ✓';
            } else if (!addrGetter()) {
                srvStatus.className = 'video-test-status ok';
                srvStatus.textContent = getLang().video_srv_started_no_probe || 'Started ✓';
            } else {
                srvStatus.className = 'video-test-status warn';
                srvStatus.textContent = getLang().video_srv_not_ready || 'Started but API not responding yet ✗';
            }
        });

        stopBtn.addEventListener('click', async () => {
            if (!globalThis.api?.serverStop) return;
            await globalThis.api.serverStop(id).catch(() => {});
            srvStatus.className = 'video-test-status';
            srvStatus.textContent = getLang().video_srv_stopped || 'Stopped';
        });

        ctrlRow.appendChild(autoLabel);
        ctrlRow.appendChild(startBtn);
        ctrlRow.appendChild(stopBtn);
        ctrlRow.appendChild(srvStatus);

        wrap.appendChild(lbl);
        wrap.appendChild(pathInput);
        wrap.appendChild(argsInput);
        wrap.appendChild(ctrlRow);
        container.appendChild(wrap);
        refreshStatus();
    };

    makeServerRow('comfyui', 'video_srv_comfy', 'comfy_exe_path', 'comfy_exe_args',
        'comfy_exe_autostart', () => globalThis.globalSettings.video_comfy_addr || '127.0.0.1:8000');
    makeServerRow('webui', 'video_srv_webui', 'webui_exe_path', 'webui_exe_args',
        'webui_exe_autostart', () => globalThis.globalSettings.api_addr || '127.0.0.1:7860');

    return { container };
}
