# SAA-edit — feature snapshot

A catalog of everything added/changed in this fork. Two branches:
- **`claude/character-select-app-cpa4ly`** — the image app (everything except the video tab).
- **`claude/comfy-video`** — branched off the above; adds the ComfyUI video tab.

> Note: this is a written inventory (the Electron GUI can't be screenshotted from
> the build environment). Each item lists where it lives in the code.

---

## Prompt area
- **Segmented prompt** — Character / Action / Background inputs combine live into one
  **All Prompts** box (the box that drives generation). Two-way editable.
  `scripts/renderer/segmentedPrompt.js`
- **Renamable labels** — double-click any prompt label to rename it (persists).
- **Autocomplete** works in all prompt boxes incl. the new segments.
  `scripts/renderer/tagAutoComplete.js`

## View-tag dropdowns (7 categories)
- Angle / Camera / Background / Style (expanded lists) + **Position**, **Expression**,
  **Clothing**. Editable via the **✎ Edit View Tags** popup.
  `data/view_tags.json`, `scripts/renderer/backgroundsEditor.js`,
  `scripts/renderer/components/myDropdown.js`, `scripts/renderer/generate.js`
- Row wraps with a min bar width so it never clips.

## Image drop / paste / gallery
- **Drag-drop paste** → two buttons: *Paste settings and random seed* / *Paste all
  settings and seed*; popup closes after. Restores prompt, settings, character bar
  (4 slots), view-tag dropdowns, landscape, and embedded state.
  `scripts/renderer/imageInfo.js`, `scripts/renderer/applyImageSettings.js`
- **Gallery top toolbar** — Seed / Send prompts / Send all settings (horizontal).
- **Gallery right-click** — Set as desktop background, Save image (with settings),
  **Send to Video**. `scripts/renderer/customGallery.js`, `scripts/main/wallpaper.js`

## Auto-save with embedded state
- Every generation auto-saves silently (one copy; A1111's own save disabled) to a
  configurable folder (default `<install>/outputs`).
  `scripts/main/imageSave.js`, `scripts/renderer/customGallery.js`
- Saved PNGs carry a custom `saa-state` chunk: exact view-tag selections (incl.
  random/none), character slots, and the Character/Action/Background split — UTF-8
  safe for Japanese/Chinese names. Drop the image back → exact restore.
  `scripts/renderer/saaState.js`

## Generation UX
- **Inline preview** over the main image (floating island removed). `customOverlay.js`
- **Docked, collapsible Generate island** (settings toggle to float). `customOverlay.js`
- **Infinite auto-generate** (right-click Create Image). `scripts/renderer/autoInfinite.js`
- **Batch seed variations** (right-click Batch). `scripts/renderer/seedVariations.js`
- **Ctrl+Enter** triggers Create Image.
- Finishing an image no longer scrolls the page when scrolled up.

## Characters
- **Add Character tab** (danbooru search + fuzzy dedupe). `scripts/renderer/characterEditor.js`
- **Character slot swap**. `scripts/renderer/characterSwap.js`
- **Emphasize multiple characters** — editable mini checkmark bars (default 1girl +
  1guy), always-inject + live status. `scripts/renderer/multiCharEmphasis.js`
- **Custom prompt toggles** — named chips that inject `((( tag :1 )))`.
  `scripts/renderer/customToggles.js`
- Swap + Emphasize controls share one row to save space.

## LoRA library
- Local same-named thumbnail grid (lazy-loaded), grouped by folder; missing thumbs
  download from civitai.red and cache next to the `.safetensors`. Left-click loads
  into a slot; right-click also applies civitai sample settings.
  `scripts/renderer/loraLibrary.js`, `scripts/main/civitai.js`

## Settings & setup
- **Settings panel (⚙)** — hide/show bars + Restore all, custom UI background image,
  feature toggles (MiraITU, floating buttons, auto-save + folder picker).
  `scripts/renderer/barsMenu.js`
- **Delete settings presets** (double-confirm).
- **Default setup** skips the wizard (WebUI, `C:\SD\SDXL\models\Stable-diffusion`,
  `127.0.0.1:7860`, model filters on, AI None, scroll-to-latest, certain bars
  unchecked). `scripts/main/globalSettings.js`
- Resizable window + one-click launchers (`Start-SAA.bat`, `start-saa.sh`,
  `start-saa.command`, `SAA-edit.desktop`).

---

## Video (ComfyUI) tab — branch `claude/comfy-video`
- **Engine**: upload image → auto-map a WAN workflow (traces `WanImageToVideo` for
  image/prompt/length/fps/seed; patches model/clip/vae/LoRA loaders) → submit →
  poll → fetch video → save to `outputs/video`. `scripts/main/comfyVideo.js`
- **Video tab UI**: input image (Use last / drop / **Send to Video** from gallery),
  editable **Scene/Motion** + **Position** dropdowns (NSFW included), extra prompt,
  controls (W/H/frames/fps/steps/cfg/seed), model-filename fields, Import API JSON,
  Run with a live **progress bar**, inline video player.
  `scripts/renderer/videoTab.js`, `data/video_scenes.json`
- **Default WAN 2.1 I2V (fast, lightx2v 4-step)** template bundled — point the model
  fields at your files. `data/video_workflows/wan21_i2v_fast.json`
- **Scene/position list editor** popup (saved to `data/video_scenes.json`).
- See `COMFY_VIDEO.md` for the design + how to export your own API JSON.
