import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";

const SAMPLE_URL = new URL("../models/sample.glb", import.meta.url).href;
const XR_SESSION_OPTIONS = {
  optionalFeatures: ["local-floor", "bounded-floor", "layers"],
};

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $("c"),
  viewport: $("viewport"),
  veil: $("drop-veil"),
  status: $("status"),
  hierarchy: $("hierarchy"),
  selName: $("sel-name"),
  clip: $("clip-select"),
  timeline: $("timeline"),
  timeReadout: $("time-readout"),
  loop: $("loop"),
  wire: $("wireframe"),
  auto: $("autorotate"),
  spaceLocal: $("space-local"),
  file: $("file-input"),
  folder: $("folder-input"),
  modelPath: $("model-path"),
  vr: $("btn-vr"),
  pos: [$("pos-x"), $("pos-y"), $("pos-z")],
  rot: [$("rot-x"), $("rot-y"), $("rot-z")],
  scl: [$("scl-x"), $("scl-y"), $("scl-z")],
};

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const renderer = new THREE.WebGLRenderer({
  canvas: els.canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10151d);
scene.fog = new THREE.Fog(0x10151d, 28, 70);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
camera.position.set(3.4, 2.4, 4.2);

const hemi = new THREE.HemisphereLight(0xc9d7ea, 0x3a2a1c, 1.15);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff3dd, 1.55);
sun.position.set(5.5, 8.5, 4.2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 30;
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
scene.add(sun);
scene.add(sun.target);

const fill = new THREE.DirectionalLight(0x88a8ff, 0.28);
fill.position.set(-6, 3, -4);
scene.add(fill);

const grid = new THREE.GridHelper(24, 24, 0x3d4f66, 0x223041);
grid.position.y = 0;
scene.add(grid);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(12, 48),
  new THREE.MeshStandardMaterial({
    color: 0x151b24,
    roughness: 1,
    metalness: 0,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.name = "__ground";
scene.add(ground);

const stage = new THREE.Group();
stage.name = "__stage";
scene.add(stage);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.screenSpacePanning = true;
orbit.target.set(0, 0.7, 0);
orbit.maxPolarAngle = Math.PI * 0.495;

const transform = new TransformControls(camera, renderer.domElement);
transform.setSize(0.9);
scene.add(transform.getHelper());
transform.addEventListener("dragging-changed", (e) => {
  orbit.enabled = !e.value && !renderer.xr.isPresenting;
});
transform.addEventListener("objectChange", () => syncTransformInputs());

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const timer = new THREE.Timer();
timer.connect(document);

const _world = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _grabWorld = new THREE.Matrix4();
const _parentInv = new THREE.Matrix4();
const _local = new THREE.Matrix4();

const xrControllers = [];

const state = {
  root: null,
  clips: [],
  mixer: null,
  action: null,
  selected: null,
  highlight: [],
  blobUrls: [],
  playing: false,
  sourceLabel: "",
  xrHasFloor: true,
};

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

function resize() {
  if (renderer.xr.isPresenting) return;
  const { clientWidth: w, clientHeight: h } = els.viewport;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    const mats = child.material
      ? Array.isArray(child.material)
        ? child.material
        : [child.material]
      : [];
    for (const m of mats) {
      if (!m) continue;
      for (const key of Object.keys(m)) {
        const val = m[key];
        if (val && val.isTexture) val.dispose();
      }
      m.dispose();
    }
  });
}

function resetStagePlacement() {
  stage.position.set(0, 0, 0);
  stage.quaternion.identity();
  stage.scale.set(1, 1, 1);
  stage.updateMatrixWorld(true);
}

function clearModel() {
  clearHighlight();
  transform.detach();
  state.selected = null;
  if (state.mixer) {
    state.mixer.stopAllAction();
    state.mixer = null;
  }
  state.action = null;
  state.clips = [];
  state.playing = false;
  if (state.root) {
    stage.remove(state.root);
    disposeObject(state.root);
    state.root = null;
  }
  resetStagePlacement();
  for (const url of state.blobUrls) URL.revokeObjectURL(url);
  state.blobUrls = [];
  els.hierarchy.replaceChildren();
  els.clip.replaceChildren();
  els.selName.textContent = "Nothing selected";
  updateAnimUi();
}

function storeBindPose(root) {
  root.traverse((obj) => {
    obj.userData.bind = {
      position: obj.position.clone(),
      rotation: obj.rotation.clone(),
      scale: obj.scale.clone(),
    };
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

function frameObject(obj) {
  if (!obj) return;
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = size.length() * 0.5 || 1;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (radius / Math.tan(fov * 0.5)) * 1.15;
  const dir = new THREE.Vector3(1.05, 0.62, 1.15).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(dist / 200, 0.01);
  camera.far = Math.max(dist * 40, 80);
  camera.updateProjectionMatrix();
  orbit.target.copy(center);
  orbit.update();
  sun.target.position.copy(center);
  sun.target.updateMatrixWorld();
}

function ensureXrCameraRange() {
  camera.near = 0.05;
  camera.far = Math.max(camera.far, 80);
  camera.updateProjectionMatrix();
}

function placeForXr() {
  if (!state.root) return;
  resetStagePlacement();
  _box.setFromObject(state.root);
  if (_box.isEmpty()) return;
  _box.getSize(_size);
  const maxDim = Math.max(_size.x, _size.y, _size.z, 0.001);
  const scale = THREE.MathUtils.clamp(1.35 / maxDim, 0.001, 100);
  stage.scale.setScalar(scale);
  stage.updateMatrixWorld(true);
  _box.setFromObject(state.root);
  _box.getCenter(_center);
  stage.position.x += -_center.x;
  stage.position.z += -_center.z - 1.65;
  stage.position.y += -_box.min.y;
  if (!state.xrHasFloor) stage.position.y -= 1.55;
  stage.updateMatrixWorld(true);
  sun.target.position.set(0, 0.7, -1.65);
  sun.target.updateMatrixWorld();
  if (!renderer.xr.isPresenting) frameObject(state.root);
}

function applyWireframe() {
  if (!state.root) return;
  const on = els.wire.checked;
  state.root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) if (m) m.wireframe = on;
  });
}

function buildHierarchy(root) {
  els.hierarchy.replaceChildren();
  const walk = (obj, depth) => {
    if (obj.name && !obj.name.startsWith("__")) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = obj.name;
      btn.className = `depth-${Math.min(depth, 4)}`;
      btn.dataset.uuid = obj.uuid;
      btn.addEventListener("click", () => selectObject(obj));
      li.appendChild(btn);
      els.hierarchy.appendChild(li);
    }
    for (const child of obj.children) walk(child, depth + (obj.name ? 1 : 0));
  };
  walk(root, 0);
}

function markHierarchy() {
  const uuid = state.selected?.uuid;
  for (const btn of els.hierarchy.querySelectorAll("button")) {
    btn.classList.toggle("selected", btn.dataset.uuid === uuid);
  }
}

function clearHighlight() {
  for (const { mesh, emissive } of state.highlight) {
    if (mesh.material && mesh.material.emissive && emissive) {
      mesh.material.emissive.copy(emissive);
    }
    const outline = mesh.userData.outline;
    if (outline) {
      outline.parent?.remove(outline);
      outline.geometry.dispose();
      outline.material.dispose();
      mesh.userData.outline = null;
    }
  }
  state.highlight = [];
}

function highlightObject(obj) {
  clearHighlight();
  obj.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mat = Array.isArray(child.material) ? child.material[0] : child.material;
    if (mat && mat.emissive) {
      const prev = mat.emissive.clone();
      mat.emissive.setHex(0x3a2208);
      state.highlight.push({ mesh: child, emissive: prev });
    }
    const edges = new THREE.EdgesGeometry(child.geometry, 28);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xff9f43, transparent: true, opacity: 0.95 }),
    );
    line.raycast = () => {};
    child.add(line);
    child.userData.outline = line;
  });
}

function selectObject(obj) {
  state.selected = obj || null;
  if (!obj) {
    transform.detach();
    clearHighlight();
    els.selName.textContent = "Nothing selected";
    markHierarchy();
    return;
  }
  if (!renderer.xr.isPresenting) transform.attach(obj);
  highlightObject(obj);
  els.selName.textContent = obj.name || obj.type;
  markHierarchy();
  syncTransformInputs();
}

function syncTransformInputs() {
  const obj = state.selected;
  const disabled = !obj;
  for (const input of [...els.pos, ...els.rot, ...els.scl]) input.disabled = disabled;
  if (!obj) return;
  const p = obj.position;
  const e = obj.rotation;
  const s = obj.scale;
  els.pos[0].value = p.x.toFixed(3);
  els.pos[1].value = p.y.toFixed(3);
  els.pos[2].value = p.z.toFixed(3);
  els.rot[0].value = (e.x * DEG).toFixed(2);
  els.rot[1].value = (e.y * DEG).toFixed(2);
  els.rot[2].value = (e.z * DEG).toFixed(2);
  els.scl[0].value = s.x.toFixed(3);
  els.scl[1].value = s.y.toFixed(3);
  els.scl[2].value = s.z.toFixed(3);
}

function applyTransformInputs() {
  const obj = state.selected;
  if (!obj) return;
  obj.position.set(num(els.pos[0]), num(els.pos[1]), num(els.pos[2]));
  obj.rotation.set(num(els.rot[0]) * RAD, num(els.rot[1]) * RAD, num(els.rot[2]) * RAD);
  obj.scale.set(num(els.scl[0]), num(els.scl[1]), num(els.scl[2]));
}

function num(input) {
  const v = parseFloat(input.value);
  return Number.isFinite(v) ? v : 0;
}

function resetSelectedTransform() {
  const obj = state.selected;
  if (!obj?.userData.bind) return;
  const b = obj.userData.bind;
  obj.position.copy(b.position);
  obj.rotation.copy(b.rotation);
  obj.scale.copy(b.scale);
  syncTransformInputs();
}

function pickableMeshes() {
  const list = [];
  if (!state.root) return list;
  state.root.traverse((obj) => {
    if (obj.isMesh) list.push(obj);
  });
  return list;
}

function namedFromHit(hitObject) {
  let obj = hitObject;
  while (obj && obj !== state.root && !obj.name) obj = obj.parent;
  return obj || hitObject;
}

function onPointerUp(event) {
  if (renderer.xr.isPresenting) return;
  if (transform.dragging || transform.axis) return;
  if (event.button !== 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickableMeshes(), true);
  if (!hits.length) {
    selectObject(null);
    return;
  }
  selectObject(namedFromHit(hits[0].object));
}

function setMode(mode) {
  transform.setMode(mode);
  for (const btn of document.querySelectorAll("[data-mode]")) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
}

function createControllerRay() {
  const geom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const line = new THREE.Line(
    geom,
    new THREE.LineBasicMaterial({ color: 0x6cb6ff, transparent: true, opacity: 0.9 }),
  );
  line.name = "__xrRay";
  line.scale.z = 4;
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x6cb6ff }),
  );
  dot.position.z = -1;
  line.add(dot);
  return line;
}

function pickFromController(controller) {
  _world.setFromMatrixPosition(controller.matrixWorld);
  _dir.set(0, 0, -1).transformDirection(controller.matrixWorld);
  raycaster.set(_world, _dir);
  return raycaster.intersectObjects(pickableMeshes(), true);
}

function releaseGrab(controller) {
  controller.userData.grabbed = null;
  controller.userData.grabOffset = null;
}

function onXrSelectStart(controller) {
  const hits = pickFromController(controller);
  if (!hits.length) {
    selectObject(null);
    return;
  }
  const obj = namedFromHit(hits[0].object);
  selectObject(obj);
  if (!obj) return;
  controller.userData.grabbed = obj;
  const offset = new THREE.Matrix4();
  offset.copy(controller.matrixWorld).invert();
  offset.multiply(obj.matrixWorld);
  controller.userData.grabOffset = offset;
}

function onXrSelectEnd(controller) {
  releaseGrab(controller);
}

function updateGrabs() {
  for (const controller of xrControllers) {
    const obj = controller.userData.grabbed;
    const offset = controller.userData.grabOffset;
    if (!obj || !offset) continue;
    _grabWorld.multiplyMatrices(controller.matrixWorld, offset);
    if (obj.parent) {
      _parentInv.copy(obj.parent.matrixWorld).invert();
      _local.multiplyMatrices(_parentInv, _grabWorld);
      _local.decompose(obj.position, obj.quaternion, obj.scale);
    } else {
      _grabWorld.decompose(obj.position, obj.quaternion, obj.scale);
    }
    obj.updateMatrixWorld();
  }
  if (xrControllers.some((c) => c.userData.grabbed)) syncTransformInputs();
}

function updateControllerRays() {
  for (const controller of xrControllers) {
    const ray = controller.userData.ray;
    if (!ray || !controller.visible) continue;
    const hits = pickFromController(controller);
    const len = hits.length ? Math.max(hits[0].distance, 0.05) : 4;
    ray.scale.z = len;
  }
}

function setupControllers() {
  const factory = new XRControllerModelFactory();
  for (let i = 0; i < 2; i += 1) {
    const controller = renderer.xr.getController(i);
    const ray = createControllerRay();
    controller.add(ray);
    controller.userData.ray = ray;
    controller.visible = false;
    controller.addEventListener("connected", () => {
      controller.visible = true;
    });
    controller.addEventListener("disconnected", () => {
      controller.visible = false;
      releaseGrab(controller);
    });
    controller.addEventListener("selectstart", () => onXrSelectStart(controller));
    controller.addEventListener("selectend", () => onXrSelectEnd(controller));
    scene.add(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(factory.createControllerModel(grip));
    scene.add(grip);
    xrControllers.push(controller);
  }
}

function setVrButtonState(presenting) {
  if (!els.vr) return;
  els.vr.textContent = presenting ? "Exit VR" : "Enter VR";
  els.vr.classList.toggle("presenting", presenting);
}

async function probeXr() {
  if (!els.vr) return;
  els.vr.hidden = true;
  if (!window.isSecureContext || !navigator.xr?.isSessionSupported) return;
  try {
    const ok = await navigator.xr.isSessionSupported("immersive-vr");
    if (!ok) return;
    els.vr.hidden = false;
  } catch {
    els.vr.hidden = true;
  }
}

async function toggleXr() {
  if (renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();
    if (session) await session.end();
    return;
  }
  if (!navigator.xr) {
    setStatus("WebXR is not available in this browser.", true);
    return;
  }
  try {
    const session = await navigator.xr.requestSession("immersive-vr", XR_SESSION_OPTIONS);
    let spaceType = "local-floor";
    try {
      await session.requestReferenceSpace("local-floor");
      state.xrHasFloor = true;
    } catch {
      spaceType = "local";
      state.xrHasFloor = false;
    }
    renderer.xr.setReferenceSpaceType(spaceType);
    await renderer.xr.setSession(session);
  } catch (err) {
    setStatus(String(err.message || err), true);
  }
}

function onXrSessionStart() {
  setVrButtonState(true);
  placeForXr();
  ensureXrCameraRange();
  transform.enabled = false;
  transform.detach();
  transform.getHelper().visible = false;
  orbit.enabled = false;
}

function onXrSessionEnd() {
  setVrButtonState(false);
  transform.enabled = true;
  transform.getHelper().visible = true;
  orbit.enabled = true;
  for (const controller of xrControllers) releaseGrab(controller);
  if (state.selected) transform.attach(state.selected);
  resize();
  if (state.root) frameObject(state.root);
}

function createProceduralSample() {
  const root = new THREE.Group();
  root.name = "Sample";

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.46, 0.82, 20),
    new THREE.MeshStandardMaterial({ color: 0x858c99, roughness: 0.55, metalness: 0.15 }),
  );
  pedestal.name = "Pedestal";
  pedestal.position.y = 0.41;
  root.add(pedestal);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.72, 0.72),
    new THREE.MeshStandardMaterial({ color: 0xe66b2e, roughness: 0.45, metalness: 0.05 }),
  );
  cube.name = "Cube";
  cube.position.y = 1.18;
  root.add(cube);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0x2eadb8, roughness: 0.35, metalness: 0.25 }),
  );
  sphere.name = "Sphere";
  sphere.position.set(0.86, 0.34, 0.62);
  root.add(sphere);

  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 2);
  const clip = new THREE.AnimationClip("Spin", 2, [
    new THREE.QuaternionKeyframeTrack(
      "Cube.quaternion",
      [0, 1, 2],
      [...q0.toArray(), ...q1.toArray(), ...q2.toArray()],
    ),
  ]);
  return { scene: root, animations: [clip] };
}

function mountGltf(gltf, label) {
  clearModel();
  const root = gltf.scene || gltf.scenes[0];
  root.name = root.name || "Scene";
  storeBindPose(root);
  stage.add(root);
  state.root = root;
  state.sourceLabel = label;
  state.clips = gltf.animations || [];
  state.mixer = new THREE.AnimationMixer(root);
  buildHierarchy(root);
  applyWireframe();
  setupClips();
  if (renderer.xr.isPresenting) placeForXr();
  else frameObject(root);
  const nMesh = countMeshes(root);
  const nClip = state.clips.length;
  setStatus(
    `Loaded ${label} · ${nMesh} mesh${nMesh === 1 ? "" : "es"} · ${nClip} clip${nClip === 1 ? "" : "s"}`,
  );
}

function countMeshes(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh) n += 1;
  });
  return n;
}

function setupClips() {
  els.clip.replaceChildren();
  if (!state.clips.length) {
    const opt = document.createElement("option");
    opt.textContent = "No clips";
    els.clip.appendChild(opt);
    els.clip.disabled = true;
    state.action = null;
    updateAnimUi();
    return;
  }
  els.clip.disabled = false;
  for (const [i, clip] of state.clips.entries()) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = clip.name || `Clip ${i + 1}`;
    els.clip.appendChild(opt);
  }
  bindAction(0);
}

function bindAction(index) {
  if (state.action) state.action.stop();
  const clip = state.clips[index];
  if (!clip || !state.mixer) {
    state.action = null;
    updateAnimUi();
    return;
  }
  const action = state.mixer.clipAction(clip);
  action.reset();
  action.enabled = true;
  action.paused = true;
  action.time = 0;
  action.setLoop(els.loop.checked ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  action.clampWhenFinished = true;
  action.play();
  action.paused = true;
  state.action = action;
  state.playing = false;
  els.timeline.max = "1000";
  els.timeline.value = "0";
  updateAnimUi();
}

function playAnim() {
  if (!state.action) return;
  if (state.action.paused && state.action.time >= state.action.getClip().duration - 1e-4) {
    state.action.time = 0;
  }
  state.action.paused = false;
  state.playing = true;
}

function pauseAnim() {
  if (!state.action) return;
  state.action.paused = true;
  state.playing = false;
}

function stopAnim() {
  if (!state.action) return;
  state.action.paused = true;
  state.action.time = 0;
  state.mixer.update(0);
  state.playing = false;
  els.timeline.value = "0";
  updateAnimUi();
}

function updateAnimUi() {
  const action = state.action;
  const has = Boolean(action);
  $("btn-play").disabled = !has;
  $("btn-pause").disabled = !has;
  $("btn-stop").disabled = !has;
  els.timeline.disabled = !has;
  if (!has) {
    els.timeReadout.textContent = "0.00 / 0.00 s";
    return;
  }
  const dur = action.getClip().duration || 0;
  const t = action.time;
  els.timeReadout.textContent = `${t.toFixed(2)} / ${dur.toFixed(2)} s`;
  if (dur > 0) els.timeline.value = String(Math.round((t / dur) * 1000));
}

function resolveModelSpec(raw) {
  const text = (raw || "").trim();
  if (!text) return null;
  if (/^https:\/\//i.test(text)) {
    return { url: text, label: text.split("/").pop() || text, path: text };
  }
  if (/^http:\/\//i.test(text)) {
    throw new Error("Model URLs must be https.");
  }
  let path = text.replace(/^\/+/, "");
  if (path.startsWith("./")) path = path.slice(2);
  if (path.includes("..") || path.includes("\\")) {
    throw new Error("Invalid model path.");
  }
  if (!path.startsWith("models/")) {
    if (path.includes("/")) throw new Error("Hosted models must live under models/.");
    path = `models/${path}`;
  }
  if (!/\.(glb|gltf)$/i.test(path)) {
    throw new Error("Use a .glb or .gltf path under models/.");
  }
  return { url: new URL(path, document.baseURI).href, label: path.split("/").pop(), path };
}

function specFromLocation() {
  const q = new URLSearchParams(location.search);
  const model = q.get("model") || q.get("glb");
  if (model) return resolveModelSpec(model);
  const url = q.get("url");
  if (url) return resolveModelSpec(url);
  return null;
}

async function loadUrl(url, label) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  mountGltf(gltf, label);
}

async function loadFromPathInput() {
  const spec = resolveModelSpec(els.modelPath.value || "models/sample.glb");
  if (!spec) return;
  setStatus(`Loading ${spec.label}…`);
  await loadUrl(spec.url, spec.label);
}

async function loadSample() {
  setStatus("Loading sample…");
  if (els.modelPath && !els.modelPath.value) els.modelPath.value = "models/sample.glb";
  try {
    await loadUrl(SAMPLE_URL, "sample.glb");
  } catch (err) {
    console.warn("sample.glb unavailable, using procedural fallback", err);
    mountGltf(createProceduralSample(), "procedural sample");
  }
}

function fileKey(file) {
  const rel = file.webkitRelativePath || file.name;
  return rel.replaceAll("\\", "/");
}

async function loadFromFileList(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const glbs = files.filter((f) => /\.glb$/i.test(f.name));
  const gltfs = files.filter((f) => /\.gltf$/i.test(f.name));

  if (glbs.length === 1 && files.length === 1) {
    const url = URL.createObjectURL(glbs[0]);
    state.blobUrls.push(url);
    setStatus(`Loading ${glbs[0].name}…`);
    await loadUrl(url, glbs[0].name);
    return;
  }

  if (glbs.length) {
    const file = glbs[0];
    const url = URL.createObjectURL(file);
    state.blobUrls.push(url);
    setStatus(`Loading ${file.name}…`);
    await loadUrl(url, file.name);
    return;
  }

  if (!gltfs.length) {
    setStatus("Drop a .glb or .gltf (plus .bin / textures if needed).", true);
    return;
  }

  const map = new Map();
  for (const file of files) {
    const url = URL.createObjectURL(file);
    state.blobUrls.push(url);
    const rel = fileKey(file);
    map.set(file.name, url);
    map.set(rel, url);
    map.set(rel.split("/").pop(), url);
  }

  const rootFile = gltfs[0];
  const rootUrl = map.get(fileKey(rootFile)) || map.get(rootFile.name);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const clean = url.split("?")[0].split("#")[0];
    const base = clean.split("/").pop();
    return map.get(clean) || map.get(base) || url;
  });
  const loader = new GLTFLoader(manager);
  setStatus(`Loading ${rootFile.name} and companions…`);
  const gltf = await loader.loadAsync(rootUrl);
  mountGltf(gltf, rootFile.name);
}

async function collectDroppedFiles(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  const files = [];
  for (const entry of entries) await walkEntry(entry, files);
  return files;
}

function walkEntry(entry, out, prefix = "") {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file((file) => {
        try {
          Object.defineProperty(file, "webkitRelativePath", {
            value: prefix + file.name,
          });
        } catch {
          /* ignore */
        }
        out.push(file);
        resolve();
      }, reject);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const next = () => {
        reader.readEntries(async (batch) => {
          if (!batch.length) {
            resolve();
            return;
          }
          for (const child of batch) {
            await walkEntry(child, out, `${prefix}${entry.name}/`);
          }
          next();
        }, reject);
      };
      next();
    } else resolve();
  });
}

function isTypingTarget(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function onKeyDown(event) {
  if (isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "t") setMode("translate");
  else if (key === "r") setMode("rotate");
  else if (key === "s") setMode("scale");
  else if (key === "f") frameObject(state.root);
  else if (key === "escape") selectObject(null);
  else if (key === " ") {
    event.preventDefault();
    if (state.playing) pauseAnim();
    else playAnim();
  }
}

function tick(time) {
  timer.update(time);
  const dt = timer.getDelta();
  if (state.mixer && state.playing) {
    state.mixer.update(dt);
    if (state.action && !els.loop.checked) {
      const clip = state.action.getClip();
      if (state.action.time >= clip.duration - 1e-4) {
        state.action.paused = true;
        state.playing = false;
      }
    }
    updateAnimUi();
  }
  if (renderer.xr.isPresenting) {
    updateGrabs();
    updateControllerRays();
  } else {
    orbit.autoRotate = els.auto.checked && !transform.dragging;
    orbit.update();
  }
  renderer.render(scene, camera);
}

function bindUi() {
  $("btn-open").addEventListener("click", () => els.file.click());
  $("btn-folder").addEventListener("click", () => els.folder.click());
  $("btn-sample").addEventListener("click", () => {
    loadSample().catch((err) => setStatus(String(err.message || err), true));
  });
  $("btn-reset-xform").addEventListener("click", resetSelectedTransform);
  $("btn-frame").addEventListener("click", () => frameObject(state.root));
  $("btn-reset-cam").addEventListener("click", () => {
    camera.position.set(3.4, 2.4, 4.2);
    orbit.target.set(0, 0.7, 0);
    if (state.root) frameObject(state.root);
    else orbit.update();
  });
  $("btn-recenter").addEventListener("click", () => {
    placeForXr();
    setStatus("Recentered for VR: model on the floor, ~1.6 m in front. Quest can also recenter with the Meta button.");
  });
  $("btn-load-path").addEventListener("click", () => {
    loadFromPathInput().catch((err) => setStatus(String(err.message || err), true));
  });
  els.modelPath.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadFromPathInput().catch((err) => setStatus(String(err.message || err), true));
    }
  });
  els.vr.addEventListener("click", () => {
    toggleXr().catch((err) => setStatus(String(err.message || err), true));
  });
  $("btn-play").addEventListener("click", playAnim);
  $("btn-pause").addEventListener("click", pauseAnim);
  $("btn-stop").addEventListener("click", stopAnim);

  for (const btn of document.querySelectorAll("[data-mode]")) {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  }

  els.file.addEventListener("change", async () => {
    try {
      await loadFromFileList(els.file.files);
    } catch (err) {
      setStatus(String(err.message || err), true);
    }
    els.file.value = "";
  });
  els.folder.addEventListener("change", async () => {
    try {
      await loadFromFileList(els.folder.files);
    } catch (err) {
      setStatus(String(err.message || err), true);
    }
    els.folder.value = "";
  });

  for (const input of [...els.pos, ...els.rot, ...els.scl]) {
    input.addEventListener("input", applyTransformInputs);
  }
  els.spaceLocal.addEventListener("change", () => {
    transform.setSpace(els.spaceLocal.checked ? "local" : "world");
  });
  els.wire.addEventListener("change", applyWireframe);
  els.clip.addEventListener("change", () => bindAction(Number(els.clip.value) || 0));
  els.loop.addEventListener("change", () => {
    if (!state.action) return;
    state.action.setLoop(els.loop.checked ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  });
  els.timeline.addEventListener("input", () => {
    if (!state.action) return;
    const dur = state.action.getClip().duration || 0;
    state.action.time = (Number(els.timeline.value) / 1000) * dur;
    state.action.paused = true;
    state.playing = false;
    state.mixer.update(0);
    updateAnimUi();
  });

  const vp = els.viewport;
  const onDrag = (e) => {
    e.preventDefault();
    els.veil.classList.add("show");
  };
  vp.addEventListener("dragenter", onDrag);
  vp.addEventListener("dragover", onDrag);
  vp.addEventListener("dragleave", (e) => {
    if (!vp.contains(e.relatedTarget)) els.veil.classList.remove("show");
  });
  vp.addEventListener("drop", async (e) => {
    e.preventDefault();
    els.veil.classList.remove("show");
    try {
      const files = await collectDroppedFiles(e.dataTransfer);
      await loadFromFileList(files);
    } catch (err) {
      setStatus(String(err.message || err), true);
    }
  });

  renderer.domElement.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", resize);
  new ResizeObserver(resize).observe(els.viewport);
  renderer.xr.addEventListener("sessionstart", onXrSessionStart);
  renderer.xr.addEventListener("sessionend", onXrSessionEnd);
}

async function boot() {
  bindUi();
  setupControllers();
  resize();
  renderer.setAnimationLoop(tick);
  probeXr();
  try {
    const spec = specFromLocation();
    if (spec) {
      if (els.modelPath) els.modelPath.value = spec.path || spec.url;
      setStatus(`Loading ${spec.label}…`);
      await loadUrl(spec.url, spec.label);
    } else {
      await loadSample();
    }
  } catch (err) {
    setStatus(String(err.message || err), true);
    await loadSample().catch((fallbackErr) => setStatus(String(fallbackErr.message || fallbackErr), true));
  }
}

boot();
