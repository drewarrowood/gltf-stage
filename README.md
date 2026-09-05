# glTF Stage

Browser-only host for **glTF 2.0** models exported from Blender (`.glb`, or `.gltf` plus `.bin` / textures). Load a file, orbit the camera, select objects, move them, play animations.

Nothing leaves the browser. Local files are read in-page and are not uploaded.

Open [`index.html`](index.html). No server and no `npm` build are required to play the stage on GitHub Pages. A static host is the usual way to open it; some browsers block ES modules and `./models/sample.glb` from a `file://` path.

## Open the page

- **GitHub Pages:** enable Pages on this repo (Deploy from branch → `/` on `main` or this branch). The empty [`.nojekyll`](.nojekyll) file keeps GitHub from running Jekyll.
- **Local folder:** serve the repo root with any static file host, or open `index.html` if your browser allows it.
- Three.js is loaded from jsDelivr (`three@0.185.1`). You need network access for the CDN.

A small built-in sample (`models/sample.glb`) loads automatically: **Pedestal**, **Cube**, **Sphere**, and a 2-second **Spin** clip on the cube.

## Export from Blender

1. Select what you want to ship (or export the whole scene).
2. **File → Export → glTF 2.0 (.glb / .gltf)**.
3. Prefer **glTF Binary (`.glb`)** so meshes, buffers, and textures travel in one file.
4. Useful export options:
   - **+ Animation** if you want clips on the stage.
   - **+ Punctual Lights** / **+ Cameras** only if you need them (the stage already lights the scene).
   - Named objects stay named in the hierarchy.

Then drop the `.glb` onto the canvas, or use **Open files**.

`.gltf` (JSON + external `.bin` / images) works if you drop the **whole export folder**, use **Open folder**, or multi-select the `.gltf` and its companions. A lone `.gltf` that still points at missing files will fail; use `.glb` when you can.

## Controls

| Action | How |
| --- | --- |
| Orbit | Left-drag on empty canvas |
| Pan | Right-drag or two-finger drag |
| Zoom | Scroll |
| Select | Click a mesh, or a name in **Hierarchy** |
| Move / rotate / scale | Gizmo, or the number fields. **T** / **R** / **S**, or the toolbar buttons |
| Local vs world | **Local space** checkbox |
| Reset selection | **Reset transform** (back to the pose from the file) |
| Frame / reset camera | **Frame model**, **Reset camera**, or **F** |
| Animation | Choose a clip, Play / Pause / Stop, drag the timeline, **Loop**. Space toggles play |
| Wireframe / auto-rotate | Checkboxes in **View** |
| Deselect | Click empty space or **Esc** |
| Recenter for VR | **Recenter / Reset view** (before Enter VR) |
| Enter VR | **Enter VR** (shown only when WebXR / immersive-vr is available) |

## Quest 3 (WebXR)

Quest Browser needs a **secure context** (HTTPS). GitHub Pages is enough — no native app and no sideload.

1. Enable Pages on this repo and open the Pages URL in **Meta Quest Browser** (not the 2D desktop preview alone).
2. The built-in `models/sample.glb` loads automatically. Prefer **`.glb`** from Blender (**File → Export → glTF 2.0 (.glb)**).
3. Quest drag-and-drop / file pickers are limited. Host the file under [`models/`](models/) and either:
   - type `models/your.glb` in **Load path**, or
   - open `https://<you>.github.io/gltf-stage/?model=your.glb`  
     (`?model=models/your.glb` and `?url=https://…/file.glb` also work).
4. Click **Recenter / Reset view** so the model sits on the floor about 1.6 m in front of you (fitted to ~1.3 m). Then **Enter VR**.
5. Standing / floor reference space is requested when the headset supports it (`local-floor`, then `local`).
6. In VR: controller ray + trigger **select** picks a mesh (same as a desktop click). Hold trigger to **grab / move**. Play animations before or after entering — the mixer runs on the XR frame loop.
7. Exit with **Exit VR** or the headset’s leave-immersive control. You can also recenter with Quest’s system gesture (Meta button).

On a desktop browser without a headset, **Enter VR** stays hidden and orbit / gizmo keep working.

## Files

```
index.html          # page + import map (no bundler)
css/stage.css
js/stage.js         # Three.js scene, loader, gizmo, mixer, WebXR
models/sample.glb   # tiny built-in scene
scripts/make_sample_glb.py   # regenerate the sample if you want
.nojekyll
```

Regenerate the sample with `python3 scripts/make_sample_glb.py`.
