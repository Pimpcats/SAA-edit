# ComfyUI Video work-area (branch: claude/comfy-video)

Goal: a stripped-down, accurate "image → video" tab that runs **your real ComfyUI
video workflow** with a small set of clean controls, so you can animate the
images you generate without touching a node graph.

## Approach (simple but accurate)
Rather than embed a node editor, the app loads a **fixed ComfyUI workflow
template** (exported from your ComfyUI in **API format**) and exposes only a few
parameters mapped to specific nodes:

1. **Input image** — the last gallery image (or a chosen one) is uploaded to
   ComfyUI and wired into the workflow's image-load node.
2. **A few controls** — frames, fps, motion/denoise, positive prompt, seed —
   each mapped to a known node id + input field in the template.
3. **Submit + poll** — reuse the existing ComfyUI backend plumbing
   (`scripts/main/generate_backend_comfyui.js`) to queue the prompt, poll
   progress, and fetch the result.
4. **Result** — play the resulting mp4/webp in a small inline player; auto-save
   alongside images.

## What already exists in the app (reusable)
- ComfyUI API submit/poll/result handling (`generate_backend_comfyui.js`).
- Settings for ComfyUI address (`api_addr`, `api_interface`).
- Image base64 handling, gallery, auto-save.

## What this feature needs to add
- `data/video_workflows/` — folder of API-format workflow JSON templates.
- A small **mapping file** per workflow describing which node id + input each UI
  control writes to (e.g. `{ "frames": {"node":"42","field":"length"}, ... }`).
- A **Video tab/panel** (`scripts/renderer/videoTab.js`) with: input-image
  preview, the mapped controls, a Run button, progress, and a video player.
- Main-process: upload image to ComfyUI (`/upload/image`), submit the templated
  workflow, poll `/history`, fetch the output video file.

## To proceed I need from you
1. The **video model/workflow** you want (WAN 2.x I2V / AnimateDiff / SVD / LTX…).
2. A working **API-format workflow JSON** exported from your ComfyUI for that
   workflow (ComfyUI → enable Dev mode → "Save (API Format)"), generating a video
   from a single input image.
3. Confirmation ComfyUI runs locally and its API address (same one the image app
   points to).

With the API JSON I can identify the exact node ids/fields to map the controls
to, drop it into `data/video_workflows/`, and wire the tab accurately.

## Status
- [x] Branch created
- [ ] Workflow template + mapping (needs your API JSON)
- [ ] Main-process: image upload + templated submit + poll + fetch result
- [ ] Video tab UI + player
- [ ] Auto-save video output
