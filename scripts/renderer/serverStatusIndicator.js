// serverStatusIndicator.js
// Always-visible badges showing whether the local backends are up:
// "Comfy Ready" / "A1111 Ready" turn green once each server's API answers.
// Sits as a fixed overlay so it's visible on every tab. Readiness reflects
// actual API reachability, so a server you started by hand still shows ready.

const CAT = '[ServerIndicator]';
const POLL_MS = 4000;

function getLang() {
    try {
        return globalThis.cachedFiles.language[globalThis.globalSettings.language] || {};
    } catch {
        return {};
    }
}

export function setupServerStatusIndicator() {
    // Desktop-only (needs the IPC bridge). In browser mode just skip silently.
    if (!globalThis.api?.serverProbe) {
        console.log(CAT, 'serverProbe unavailable — indicator disabled');
        return null;
    }

    const wrap = document.createElement('div');
    wrap.id = 'server-status-indicator';
    Object.assign(wrap.style, {
        position: 'fixed', top: '6px', right: '8px', zIndex: '99999',
        display: 'flex', gap: '6px', pointerEvents: 'none',
        font: '11px/1.4 system-ui, sans-serif',
    });

    const makePill = (baseLabel) => {
        const pill = document.createElement('span');
        Object.assign(pill.style, {
            padding: '2px 8px', borderRadius: '10px', whiteSpace: 'nowrap',
            background: 'rgba(63,63,70,0.85)', color: '#d4d4d8',
            border: '1px solid rgba(255,255,255,0.12)', transition: 'all 0.2s',
        });
        pill._base = baseLabel;
        const setState = (ready) => {
            const L = getLang();
            const readyTxt = L.video_ind_ready || 'Ready';
            const offTxt = L.video_ind_off || 'offline';
            if (ready) {
                pill.textContent = `${baseLabel} ${readyTxt} ✓`;
                pill.style.background = 'rgba(22,101,52,0.9)';   // green
                pill.style.color = '#dcfce7';
                pill.style.borderColor = 'rgba(74,222,128,0.5)';
            } else {
                pill.textContent = `${baseLabel} ${offTxt}`;
                pill.style.background = 'rgba(63,63,70,0.85)';   // grey
                pill.style.color = '#a1a1aa';
                pill.style.borderColor = 'rgba(255,255,255,0.12)';
            }
        };
        setState(false);
        return { pill, setState };
    };

    const comfy = makePill('Comfy');
    const a1111 = makePill('A1111');
    wrap.appendChild(comfy.pill);
    wrap.appendChild(a1111.pill);
    document.body.appendChild(wrap);

    const poll = async () => {
        const S = globalThis.globalSettings || {};
        try {
            const [c, w] = await Promise.all([
                globalThis.api.serverProbe('comfyui', S.video_comfy_addr || '127.0.0.1:8000').catch(() => null),
                globalThis.api.serverProbe('webui', S.api_addr || '127.0.0.1:7860').catch(() => null),
            ]);
            comfy.setState(!!(c && c.ready));
            a1111.setState(!!(w && w.ready));
        } catch (err) {
            console.warn(CAT, 'poll failed', err?.message);
        }
    };

    poll();
    const timer = setInterval(poll, POLL_MS);

    return {
        el: wrap,
        refresh: poll,
        destroy: () => { clearInterval(timer); wrap.remove(); },
    };
}
