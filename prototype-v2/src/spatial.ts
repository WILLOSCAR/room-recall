import type { Material, Object3D } from "three";
import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LinearFilter,
  LineSegments,
  Matrix4,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  ShadowMaterial,
  Sphere,
  Spherical,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  EdgesGeometry
} from "three";
import CameraControls from "camera-controls";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  addFurnitureObject,
  type FurnitureMaterials,
  type SpatialArchetype
} from "./spatial-furniture.ts";

CameraControls.install({ THREE: {
  Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster, MathUtils
} as unknown as typeof import("three") });

export type SpatialObjectKind = "furniture" | "box";
export type SpatialProposalState = "accepted" | "pending" | "rejected";
export type SpatialColor = number | string;
export type SpatialViewPreset = "home" | "study" | "top";

export interface SpatialSelection {
  id: string;
  name: string;
  roomId?: string;
  kind: SpatialObjectKind;
  archetype: SpatialArchetype;
}

export interface SpatialRoom {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  name?: string;
  label?: string;
}

export interface SpatialObject {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind?: SpatialObjectKind;
  y?: number;
  roomId?: string;
  name?: string;
  label?: string;
  color?: SpatialColor;
  proposalState?: SpatialProposalState;
  archetype?: SpatialArchetype;
  rotationY?: number;
}

export interface SpatialPin {
  x: number;
  z: number;
  y?: number;
  radius?: number;
  roomId?: string;
  color?: SpatialColor;
  objectId?: string;
}

export interface SpatialSceneData {
  readonly rooms: readonly SpatialRoom[];
  readonly objects?: readonly SpatialObject[];
  readonly proposals?: readonly SpatialObject[];
  readonly pin?: SpatialPin | null;
}

const OFF_WHITE = 0xf5f1e9;
const FLOOR_COLORS = [0xc99b6d, 0xd9d7cf, 0xd7c9b5];
const WALL_COLOR = 0xf3eee5;
const PIN_COLOR = 0xe26139;
const OUTLINE_COLOR = 0x4d5d55;
const SELECTION_OUTLINE_COLOR = 0xe16642;
const HOVER_OUTLINE_COLOR = 0x9c7a5a;
const PROPOSAL_COLORS: Record<SpatialProposalState, number> = {
  accepted: 0x4b9a76,
  pending: 0xd19536,
  rejected: 0xb95046
};

const FLOOR_THICKNESS = 0.04;
const WALL_HEIGHT = 2.56;
const WALL_THICKNESS = 0.085;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_RENDER_PIXELS = 2_000_000;
const MIN_RENDER_PIXEL_RATIO = 0.5;
const CAMERA_KEY_ROTATION = MathUtils.degToRad(8);
const LABEL_TEXTURE_WIDTH = 256;
const LABEL_TEXTURE_HEIGHT = 64;

function createSolidMaterial(color: SpatialColor, opacity = 1): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0.01,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1
  });
}

function createProposalMaterial(color: SpatialColor): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.02,
    transparent: true,
    opacity: 0.32,
    depthWrite: false
  });
}

function createFurnitureMaterials(): FurnitureMaterials {
  const standard = (color: SpatialColor, roughness = 0.72, metalness = 0.02): MeshStandardMaterial => new MeshStandardMaterial({ color, roughness, metalness });
  return {
    wood: standard(0xb77b4b, 0.68),
    woodDark: standard(0x805336, 0.75),
    linen: standard(0xe8e0d2, 0.96),
    sage: standard(0x7f927f, 0.9),
    metal: standard(0x33443d, 0.42, 0.34),
    paper: standard(0xf5f1e9, 0.94),
    cardboard: standard(0xb87348, 0.9),
    tape: standard(0xd4b47d, 0.72),
    glass: new MeshStandardMaterial({ color: 0x263d3a, roughness: 0.12, metalness: 0.14, emissive: 0x102420, emissiveIntensity: 0.24 }),
    accent: standard(0xd96843, 0.7)
  };
}

function positionCuboid(mesh: Mesh, x: number, y: number, z: number, w: number, h: number, d: number): void {
  mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
}

function addCuboid(
  parent: Group,
  id: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: MeshStandardMaterial
): Mesh {
  const radius = Math.min(0.055, Math.max(0.004, Math.min(w, h, d) * 0.14));
  const mesh = new Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material);
  mesh.name = id;
  positionCuboid(mesh, x, y, z, w, h, d);
  parent.add(mesh);
  return mesh;
}

function addRectilinearCuboid(
  parent: Group,
  id: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: MeshStandardMaterial
): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material);
  mesh.name = id;
  positionCuboid(mesh, x, y, z, w, h, d);
  parent.add(mesh);
  return mesh;
}

function roomColor(roomId: string): number {
  const hash = [...roomId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return FLOOR_COLORS[hash % FLOOR_COLORS.length] ?? 0xe8e4da;
}

interface SpatialLabelStyle {
  scaleX?: number;
  scaleY?: number;
  background?: string;
  fontSize?: number;
  priority?: number;
}

function addLabel(
  parent: Group,
  label: string,
  x: number,
  y: number,
  z: number,
  style: SpatialLabelStyle = {}
): void {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_TEXTURE_WIDTH;
  canvas.height = LABEL_TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = style.background ?? "rgba(20, 34, 29, 0.82)";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(4, 4, 248, 56, 14);
  else ctx.rect(4, 4, 248, 56);
  ctx.fill();
  ctx.font = `600 ${(style.fontSize ?? 42) / 2}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillStyle = "rgba(247, 250, 248, 0.94)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 128, 33, 219);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false }));
  sprite.name = `label:${label}`;
  sprite.userData["labelPriority"] = style.priority ?? 1;
  sprite.userData["labelLength"] = label.length;
  sprite.position.set(x, y, z);
  sprite.scale.set(style.scaleX ?? 1.16, style.scaleY ?? 0.29, 1);
  sprite.renderOrder = 20;
  parent.add(sprite);
}

function declutterLabels(root: Object3D, camera: PerspectiveCamera, surface: HTMLCanvasElement): { visible: number; total: number } {
  const labels: Array<{ sprite: Sprite; priority: number; distance: number }> = [];
  root.traverse((object) => {
    if (!(object instanceof Sprite) || !object.name.startsWith("label:")) return;
    labels.push({
      sprite: object,
      priority: Number(object.userData["labelPriority"] ?? 1),
      distance: object.getWorldPosition(new Vector3()).distanceTo(camera.position)
    });
  });
  labels.sort((a, b) => b.priority - a.priority || a.distance - b.distance);
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  const width = Math.max(1, surface.clientWidth);
  const height = Math.max(1, surface.clientHeight);
  const accepted: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  let visible = 0;

  for (const { sprite } of labels) {
    const world = sprite.getWorldPosition(new Vector3());
    const center = world.clone().project(camera);
    if (center.z < -1 || center.z > 1 || Math.abs(center.x) > 1.08 || Math.abs(center.y) > 1.08) {
      sprite.visible = false;
      continue;
    }
    const cameraRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(sprite.scale.x / 2).add(world).project(camera);
    const cameraUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(sprite.scale.y / 2).add(world).project(camera);
    const centerX = (center.x + 1) * width / 2;
    const centerY = (1 - center.y) * height / 2;
    const projectedWidth = Math.abs(cameraRight.x - center.x) * width;
    const projectedHeight = Math.abs(cameraUp.y - center.y) * height;
    const labelLength = Number(sprite.userData["labelLength"] ?? 8);
    const rectWidth = Math.max(Math.min(142, labelLength * 6.2 + 18), projectedWidth, 46);
    const rectHeight = Math.max(projectedHeight, 18);
    const rect = {
      left: centerX - rectWidth / 2 - 4,
      right: centerX + rectWidth / 2 + 4,
      top: centerY - rectHeight / 2 - 3,
      bottom: centerY + rectHeight / 2 + 3
    };
    const overlaps = accepted.some((other) => !(rect.right < other.left || rect.left > other.right || rect.bottom < other.top || rect.top > other.bottom));
    sprite.visible = !overlaps;
    if (!overlaps) {
      accepted.push(rect);
      visible += 1;
    }
  }
  return { visible, total: labels.length };
}

function addOutline(parent: Group, mesh: Mesh, opacity = 0.22): void {
  const outline = new LineSegments(
    new EdgesGeometry(mesh.geometry, 26),
    new LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity })
  );
  outline.position.copy(mesh.position);
  outline.renderOrder = 2;
  parent.add(outline);
}

function addRoom(parent: Group, room: SpatialRoom): void {
  const floor = addRectilinearCuboid(
    parent,
    `${room.id}:floor`,
    room.x,
    -FLOOR_THICKNESS,
    room.z,
    room.w,
    FLOOR_THICKNESS,
    room.d,
    createSolidMaterial(roomColor(room.id))
  );
  floor.receiveShadow = true;
  addOutline(parent, floor, 0.1);

  // A two-wall dollhouse keeps the interior readable from the default
  // south-east camera while still giving the plan a real architectural frame.
  const north = addRectilinearCuboid(
    parent,
    `${room.id}:wall:north`,
    room.x,
    0,
    room.z,
    room.w,
    WALL_HEIGHT,
    WALL_THICKNESS,
    createSolidMaterial(WALL_COLOR)
  );
  const west = addRectilinearCuboid(
    parent,
    `${room.id}:wall:west`,
    room.x,
    0,
    room.z,
    WALL_THICKNESS,
    WALL_HEIGHT,
    room.d,
    createSolidMaterial(WALL_COLOR)
  );
  for (const wall of [north, west]) {
    wall.receiveShadow = true;
    addOutline(parent, wall, 0.08);
  }

  const baseboard = createSolidMaterial(0xd8cbbb);
  addRectilinearCuboid(parent, `${room.id}:baseboard:north`, room.x, 0, room.z + WALL_THICKNESS, room.w, 0.09, 0.025, baseboard);
  addRectilinearCuboid(parent, `${room.id}:baseboard:west`, room.x + WALL_THICKNESS, 0, room.z, 0.025, 0.09, room.d, baseboard);

  const floorLines: number[] = [];
  const spacing = room.id === "bedroom" ? 0.28 : 0.52;
  for (let offset = spacing; offset < room.w; offset += spacing) {
    floorLines.push(room.x + offset, 0.003, room.z + 0.03, room.x + offset, 0.003, room.z + room.d - 0.03);
  }
  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute("position", new Float32BufferAttribute(floorLines, 3));
  const grain = new LineSegments(lineGeometry, new LineBasicMaterial({ color: room.id === "bedroom" ? 0x9a6a42 : 0xb9b4aa, transparent: true, opacity: 0.24 }));
  grain.name = `${room.id}:floor-detail`;
  parent.add(grain);

  if (room.id === "bedroom" || /study|bed/i.test(room.name ?? room.label ?? "")) {
    const frameMaterial = createSolidMaterial(0x5f7168);
    const glassMaterial = new MeshStandardMaterial({ color: 0xa7c4c2, roughness: 0.16, metalness: 0.03, transparent: true, opacity: 0.48, depthWrite: false });
    const windowW = Math.min(1.25, room.w * 0.34);
    const windowH = 0.92;
    const windowX = room.x + room.w * 0.64;
    const windowY = 1.18;
    addRectilinearCuboid(parent, `${room.id}:window:glass`, windowX - windowW / 2, windowY, room.z + WALL_THICKNESS + 0.004, windowW, windowH, 0.018, glassMaterial);
    addRectilinearCuboid(parent, `${room.id}:window:top`, windowX - windowW / 2 - 0.035, windowY + windowH, room.z + WALL_THICKNESS + 0.024, windowW + 0.07, 0.055, 0.035, frameMaterial);
    addRectilinearCuboid(parent, `${room.id}:window:bottom`, windowX - windowW / 2 - 0.035, windowY - 0.055, room.z + WALL_THICKNESS + 0.024, windowW + 0.07, 0.055, 0.035, frameMaterial);
    addRectilinearCuboid(parent, `${room.id}:window:left`, windowX - windowW / 2 - 0.035, windowY, room.z + WALL_THICKNESS + 0.024, 0.055, windowH, 0.035, frameMaterial);
    addRectilinearCuboid(parent, `${room.id}:window:right`, windowX + windowW / 2 - 0.02, windowY, room.z + WALL_THICKNESS + 0.024, 0.055, windowH, 0.035, frameMaterial);
    addRectilinearCuboid(parent, `${room.id}:window:middle`, windowX - 0.018, windowY, room.z + WALL_THICKNESS + 0.028, 0.036, windowH, 0.028, frameMaterial);
  }
}

function addSpatialObject(parent: Group, object: SpatialObject, materials: FurnitureMaterials): ReturnType<typeof addFurnitureObject> {
  return addFurnitureObject(parent, {
    id: object.id,
    name: object.name ?? object.label ?? object.id,
    archetype: object.archetype ?? (object.kind === "box" ? "box" : "block"),
    x: object.x,
    y: object.y ?? 0,
    z: object.z,
    w: object.w,
    h: object.h,
    d: object.d,
    rotationY: object.rotationY
  }, materials);
}

function addProposalObject(parent: Group, object: SpatialObject): void {
  const state = object.proposalState ?? "pending";
  const color = object.color ?? PROPOSAL_COLORS[state];
  const material = createProposalMaterial(color);
  const mesh = addCuboid(
    parent,
    `${object.id}:proposal`,
    object.x,
    (object.y ?? 0) + 0.01,
    object.z,
    object.w,
    object.h,
    object.d,
    material
  );
  mesh.renderOrder = 4;
  mesh.castShadow = state === "accepted";

  const edges = new LineSegments(
    new EdgesGeometry(mesh.geometry),
    new LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
  );
  edges.position.copy(mesh.position);
  edges.renderOrder = 5;
  parent.add(edges);

  const label = object.name ?? object.label;
  if (label) {
    addLabel(
      parent,
      `${label} · ${state}`,
      object.x + object.w / 2,
      (object.y ?? 0) + object.h + 0.1,
      object.z + object.d / 2,
      { scaleX: 0.98, scaleY: 0.245, background: "rgba(68, 48, 25, 0.88)", fontSize: 36, priority: 5 }
    );
  }
}

function addPin(parent: Group, pin: SpatialPin): Mesh {
  const radius = pin.radius ?? 0.18;
  const color = pin.color ?? PIN_COLOR;
  const halo = new Mesh(
    new RingGeometry(radius, radius * 1.7, 48),
    new MeshBasicMaterial({
      color,
      side: DoubleSide,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    })
  );
  halo.name = "pin-halo";
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(pin.x, (pin.y ?? 0) + 0.03, pin.z);
  halo.renderOrder = 6;
  parent.add(halo);

  const stem = new Mesh(
    new CylinderGeometry(radius * 0.055, radius * 0.055, radius * 1.1, 12),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.74 })
  );
  stem.name = "pin-stem";
  stem.position.set(pin.x, (pin.y ?? 0) + radius * 0.55, pin.z);
  stem.renderOrder = 6;
  parent.add(stem);

  const orb = new Mesh(
    new SphereGeometry(radius * 0.34, 18, 12),
    new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.16,
      roughness: 0.35,
      metalness: 0.05
    })
  );
  orb.name = "pin-core";
  orb.position.set(pin.x, (pin.y ?? 0) + radius * 0.34 + 0.03, pin.z);
  orb.renderOrder = 7;
  orb.castShadow = true;
  // The orb re-focuses the located object on click, so it joins the pickables.
  if (pin.objectId) orb.userData["spatialObjectId"] = pin.objectId;
  parent.add(orb);
  return orb;
}

function sceneObjects(data: SpatialSceneData): { solid: SpatialObject[]; proposals: SpatialObject[] } {
  return {
    solid: (data.objects ?? []).filter((object) => !object.proposalState),
    proposals: [...(data.proposals ?? []), ...(data.objects ?? []).filter((object) => !!object.proposalState)]
  };
}

function measureBounds(data: SpatialSceneData): Box3 {
  const bounds = new Box3();
  bounds.makeEmpty();

  const expand = (x: number, y: number, z: number, w: number, h: number, d: number): void => {
    bounds.expandByPoint(new Vector3(x, y, z));
    bounds.expandByPoint(new Vector3(x + w, y + h, z + d));
  };

  for (const room of data.rooms) {
    expand(room.x, -FLOOR_THICKNESS, room.z, room.w, WALL_HEIGHT + FLOOR_THICKNESS, room.d);
  }

  const { solid: solidObjects, proposals: proposalObjects } = sceneObjects(data);

  for (const object of solidObjects) {
    expand(object.x, object.y ?? 0, object.z, object.w, object.h, object.d);
  }
  for (const proposal of proposalObjects) {
    expand(proposal.x, (proposal.y ?? 0) + 0.01, proposal.z, proposal.w, proposal.h, proposal.d);
  }

  if (data.pin) {
    const radius = data.pin.radius ?? 0.18;
    expand(
      data.pin.x - radius * 1.7,
      (data.pin.y ?? 0),
      data.pin.z - radius * 1.7,
      radius * 3.4,
      radius * 0.75 + 0.06,
      radius * 3.4
    );
  }

  if (bounds.isEmpty()) {
    expand(-1, -FLOOR_THICKNESS, -1, 2, WALL_HEIGHT + FLOOR_THICKNESS, 2);
  }

  return bounds;
}

function targetPixelRatio(width: number, height: number): number {
  const deviceRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
  const areaRatio = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height));
  return Math.max(MIN_RENDER_PIXEL_RATIO, Math.min(deviceRatio, areaRatio));
}

function applySize(container: HTMLElement, renderer: WebGLRenderer, camera: PerspectiveCamera): void {
  const width = Math.max(1, Math.round(container.clientWidth || container.getBoundingClientRect().width || 1));
  const height = Math.max(1, Math.round(container.clientHeight || container.getBoundingClientRect().height || 1));
  const pixelRatio = targetPixelRatio(width, height);
  if (Math.abs(renderer.getPixelRatio() - pixelRatio) > 0.01) renderer.setPixelRatio(pixelRatio);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function frameCamera(camera: PerspectiveCamera, controls: CameraControls, bounds: Box3): void {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const halfFovY = MathUtils.degToRad(camera.fov * 0.5);
  const halfFovX = Math.atan(Math.tan(halfFovY) * camera.aspect);
  const distance = Math.max(radius / Math.sin(halfFovY), radius / Math.sin(halfFovX)) * 1.18;
  const direction = new Vector3(1, 0.78, 1).normalize();

  controls.minDistance = Math.max(1.4, radius * 0.32);
  controls.maxDistance = Math.max(8, radius * 8);

  const position = center.clone().addScaledVector(direction, distance);
  camera.near = Math.max(0.05, distance / 120);
  camera.far = Math.max(50, distance * 24);
  camera.updateProjectionMatrix();
  void controls.setLookAt(position.x, position.y, position.z, center.x, Math.max(0.42, center.y * 0.68), center.z, false);
  controls.update(0);
}

function disposeScene(scene: Scene): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();

  scene.traverse((node: Object3D) => {
    const geometry = (node as { geometry?: BufferGeometry }).geometry;
    if (geometry) geometries.add(geometry);

    const material = (node as { material?: Material | Material[] }).material;
    if (Array.isArray(material)) {
      for (const entry of material) materials.add(entry);
    } else if (material) {
      materials.add(material);
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    const map = (material as Material & { map?: { dispose(): void } | null }).map;
    map?.dispose();
    material.dispose();
  }
}

function namedList(names: Array<string | undefined>, fallback: string): string {
  const visible = names.filter((name): name is string => !!name?.trim()).slice(0, 6);
  if (!visible.length) return fallback;
  const suffix = names.filter((name) => !!name?.trim()).length > visible.length ? ", and more" : "";
  return `${visible.join(", ")}${suffix}`;
}

function describeScene(data: SpatialSceneData): string {
  const { solid, proposals } = sceneObjects(data);
  const furniture = solid.filter((object) => object.kind !== "box");
  const boxes = solid.filter((object) => object.kind === "box");
  const roomNames = namedList(data.rooms.map((room) => room.name ?? room.label), "unnamed rooms");
  const furnitureNames = namedList(furniture.map((object) => object.name ?? object.label), "unnamed anchors");
  const boxNames = boxes.length
    ? ` ${boxes.length} moving boxes: ${namedList(boxes.map((object) => object.name ?? object.label), "unnamed boxes")}.`
    : "";
  const stateCounts = proposals.reduce<Record<SpatialProposalState, number>>(
    (counts, proposal) => {
      counts[proposal.proposalState ?? "pending"] += 1;
      return counts;
    },
    { accepted: 0, pending: 0, rejected: 0 }
  );
  const proposalDescription = proposals.length
    ? ` ${proposals.length} review proposals: ${stateCounts.pending} pending, ${stateCounts.accepted} accepted, ${stateCounts.rejected} rejected.`
    : "";
  const pinDescription = data.pin ? " A confidence location pin is visible." : "";
  return `Read-only 3D spatial layout. ${data.rooms.length} rooms: ${roomNames}. ${furniture.length} confirmed furniture anchors: ${furnitureNames}.${boxNames}${proposalDescription}${pinDescription}`;
}

interface InstalledSurface {
  restore(): void;
}

function installSurface(container: HTMLElement, surface: HTMLElement): InstalledSurface {
  const originalContainerStyle = {
    position: container.style.position,
    overflow: container.style.overflow,
    minHeight: container.style.minHeight
  };

  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.style.overflow = "hidden";
  if (!container.style.minHeight && container.clientHeight === 0) container.style.minHeight = "240px";

  container.insertBefore(surface, container.firstChild);
  const overlaySnapshots = Array.from(container.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== surface)
    .map((child) => {
      const snapshot = { child, position: child.style.position, zIndex: child.style.zIndex };
      if (getComputedStyle(child).position === "static") child.style.position = "relative";
      if (getComputedStyle(child).zIndex === "auto") child.style.zIndex = "1";
      return snapshot;
    });

  return {
    restore: () => {
      for (const snapshot of overlaySnapshots) {
        snapshot.child.style.position = snapshot.position;
        snapshot.child.style.zIndex = snapshot.zIndex;
      }
      container.style.position = originalContainerStyle.position;
      container.style.overflow = originalContainerStyle.overflow;
      container.style.minHeight = originalContainerStyle.minHeight;
    }
  };
}

function mountSpatialFallback(container: HTMLElement, data: SpatialSceneData): () => void {
  const fallback = document.createElement("div");
  fallback.dataset.spatialSceneFallback = "true";
  fallback.setAttribute("role", "img");
  fallback.setAttribute("aria-label", describeScene(data));
  fallback.textContent = "3D preview unavailable. Spatial memory remains available in the 2D plan.";
  Object.assign(fallback.style, {
    position: "absolute",
    inset: "0",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    color: "#34483f",
    background: "linear-gradient(145deg, #f1eee7, #dde5df)",
    textAlign: "center",
    font: "600 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif",
    zIndex: "0"
  });
  const installed = installSurface(container, fallback);
  let mounted = true;
  return () => {
    if (!mounted) return;
    mounted = false;
    fallback.remove();
    installed.restore();
  };
}

export function mountSpatialScene(container: HTMLElement, data: SpatialSceneData): () => void {
  const cleanupStack: Array<() => void> = [];
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    for (let index = cleanupStack.length - 1; index >= 0; index -= 1) {
      try { cleanupStack[index]?.(); } catch { /* cleanup is best-effort */ }
    }
  };
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return mountSpatialFallback(container, data);
  }
  cleanupStack.push(() => {
    renderer.dispose();
    renderer.forceContextLoss();
  });
  try {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(OFF_WHITE, 0.9);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute(
    "aria-label",
    `${describeScene(data)} Use arrow keys to orbit, plus or minus to zoom, square brackets to select furniture, Enter to focus the selection, and Home to reset the view.`
  );
  renderer.domElement.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown + - [ ] Enter Home");
  renderer.domElement.tabIndex = 0;
  renderer.domElement.dataset.spatialSceneCanvas = "true";
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.zIndex = "0";
  const installed = installSurface(container, renderer.domElement);
  cleanupStack.push(() => {
    renderer.domElement.remove();
    installed.restore();
  });

  const scene = new Scene();
  scene.background = new Color(OFF_WHITE);
  const roomEnvironment = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(roomEnvironment, 0.035);
  scene.environment = environmentTarget.texture;
  cleanupStack.push(() => {
    environmentTarget.dispose();
    roomEnvironment.dispose();
    pmrem.dispose();
  });
  cleanupStack.push(() => {
    disposeScene(scene);
    scene.clear();
  });
  const camera = new PerspectiveCamera(42, 1, 0.05, 200);
  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  let reduceMotion = motionQuery?.matches ?? false;
  const controls = new CameraControls(camera, renderer.domElement);
  cleanupStack.push(() => controls.dispose());
  controls.smoothTime = reduceMotion ? 0.01 : 0.18;
  controls.draggingSmoothTime = reduceMotion ? 0.01 : 0.08;
  controls.restThreshold = 0.02;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minPolarAngle = Math.PI * 0.12;
  // OrbitControls sets `touch-action: none` while connecting. Restore vertical
  // page scrolling on coarse pointers after the controls own the canvas.
  renderer.domElement.style.touchAction = window.matchMedia?.("(pointer: coarse)").matches ? "pan-y" : "none";

  const bounds = measureBounds(data);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  scene.add(new HemisphereLight(0xfffbf4, 0x68796f, 1.18));
  const sun = new DirectionalLight(0xffe2bd, 2.75);
  sun.position.set(center.x + 8, center.y + 12, center.z + 6);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = Math.max(40, size.length() * 6);
  const shadowExtent = Math.max(4, Math.max(size.x, size.z) * 0.72 + 1);
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0008;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const fill = new DirectionalLight(0xcce9dc, 0.72);
  fill.position.set(center.x - 7, center.y + 5, center.z - 5);
  scene.add(fill);
  // Cool rim/back light separates furniture silhouettes from the off-white walls.
  // castShadow stays false so it costs no extra shadow pass (GPU budget safe).
  const rim = new DirectionalLight(0xdfecff, 0.55);
  rim.position.set(center.x - 4, center.y + 7, center.z - 9);
  scene.add(rim);

  const content = new Group();
  scene.add(content);

  for (const room of data.rooms) addRoom(content, room);
  let roomTriangles = 0;
  content.traverse((object) => {
    if (!(object instanceof Mesh) || !data.rooms.some((room) => object.name.startsWith(`${room.id}:`))) return;
    const count = object.geometry.index?.count ?? object.geometry.getAttribute("position")?.count ?? 0;
    roomTriangles += count / 3;
  });
  renderer.domElement.dataset.spatialRoomTriangles = String(roomTriangles);
  renderer.domElement.dataset.spatialReducedMotion = String(reduceMotion);
  renderer.domElement.dataset.spatialDamping = String(!reduceMotion);

  const { solid: solidObjects, proposals: proposalObjects } = sceneObjects(data);
  renderer.domElement.dataset.spatialLabelSize = proposalObjects.length ? `${LABEL_TEXTURE_WIDTH}x${LABEL_TEXTURE_HEIGHT}` : "0x0";

  // Parented layer groups so the inspector legend can toggle whole layers on/off.
  // View-local visibility only — never Place Graph truth, never in the scene payload.
  const furnitureLayer = new Group(); furnitureLayer.name = "layer:furniture";
  const boxLayer = new Group(); boxLayer.name = "layer:boxes";
  const proposalLayer = new Group(); proposalLayer.name = "layer:proposals";
  const pinLayer = new Group(); pinLayer.name = "layer:pin";
  content.add(furnitureLayer, boxLayer, proposalLayer, pinLayer);
  const layerGroups: Record<string, Group> = { furniture: furnitureLayer, boxes: boxLayer, proposals: proposalLayer, pin: pinLayer };

  const furnitureMaterials = createFurnitureMaterials();
  const interactiveMeshes: Mesh[] = [];
  const objectRoots = new Map<string, Group>();
  const objectData = new Map(solidObjects.map((object) => [object.id, object]));
  const archetypes = new Set<SpatialArchetype>();
  for (const object of solidObjects) {
    const layer = object.kind === "box" ? boxLayer : furnitureLayer;
    const built = addSpatialObject(layer, object, furnitureMaterials);
    interactiveMeshes.push(...built.interactiveMeshes);
    objectRoots.set(object.id, built.root);
    archetypes.add(object.archetype ?? (object.kind === "box" ? "box" : "block"));
  }
  for (const proposal of proposalObjects) addProposalObject(proposalLayer, proposal);
  if (data.pin) {
    const orb = addPin(pinLayer, data.pin);
    if (data.pin.objectId) interactiveMeshes.push(orb);
  }
  renderer.domElement.dataset.spatialArchetypes = [...archetypes].sort().join(",");

  const gridSize = Math.max(4, Math.ceil(Math.max(size.x, size.z) + 2));
  const shadowPlane = new Mesh(
    new PlaneGeometry(gridSize + 3, gridSize + 3),
    new ShadowMaterial({ color: 0x17251f, opacity: 0.18 })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(center.x, -0.018, center.z);
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);
  applySize(container, renderer, camera);
  frameCamera(camera, controls, bounds);

  let mounted = true;
  let frameHandle = 0;
  let inViewport = true;
  let documentVisible = document.visibilityState !== "hidden";
  let contextAvailable = true;
  let interacting = false;
  let settleFrames = 0;
  let lastFrameAt = performance.now();
  // camera-controls' update() reports "changed" for any nonzero delta, so its
  // exponential damping tail keeps drifting sub-millimeter forever and never
  // lets the loop quiesce. Gate rescheduling on visible movement instead: early
  // transition frames move far, only the imperceptible tail falls below this.
  const restEpsilon = 1e-3;
  let lastCameraX = camera.position.x;
  let lastCameraY = camera.position.y;
  let lastCameraZ = camera.position.z;
  const restingTarget = controls.getTarget(new Vector3());
  let lastTargetX = restingTarget.x;
  let lastTargetY = restingTarget.y;
  let lastTargetZ = restingTarget.z;
  const pinHalo = scene.getObjectByName("pin-halo");
  const pinCore = scene.getObjectByName("pin-core");
  const pinBaseY = pinCore?.position.y ?? 0;
  let pinAnimationStartedAt: number | null = null;
  let renderedFrames = 0;
  cleanupStack.push(() => {
    mounted = false;
    if (frameHandle) window.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  });

  const canRender = (): boolean => mounted && inViewport && documentVisible && contextAvailable;

  const renderFrame = (time = 0): void => {
    frameHandle = 0;
    if (!canRender()) return;
    if (pinCore && !reduceMotion && pinAnimationStartedAt === null) pinAnimationStartedAt = time;
    const pinAnimating = !!pinCore && !reduceMotion && time - (pinAnimationStartedAt ?? time) < 800;
    if (pinHalo && pinAnimating) {
      const pulse = 1 + Math.sin(time * 0.0038) * 0.08;
      pinHalo.scale.setScalar(pulse);
    } else if (pinHalo) {
      pinHalo.scale.setScalar(1);
    }
    if (pinCore) pinCore.position.y = pinAnimating ? pinBaseY + Math.sin(time * 0.0032) * 0.018 : pinBaseY;
    const delta = Math.min(Math.max(0, time - lastFrameAt) / 1_000, 0.05);
    lastFrameAt = time;
    controls.update(delta);
    const cameraTarget = controls.getTarget(new Vector3());
    // "Meaningful" motion = the camera or its target moved more than a hair
    // this frame. The damping tail drops below restEpsilon within a few frames
    // even though controls.update() would keep reporting change indefinitely.
    const cameraMoving =
      Math.abs(camera.position.x - lastCameraX) > restEpsilon ||
      Math.abs(camera.position.y - lastCameraY) > restEpsilon ||
      Math.abs(camera.position.z - lastCameraZ) > restEpsilon ||
      Math.abs(cameraTarget.x - lastTargetX) > restEpsilon ||
      Math.abs(cameraTarget.y - lastTargetY) > restEpsilon ||
      Math.abs(cameraTarget.z - lastTargetZ) > restEpsilon;
    lastCameraX = camera.position.x;
    lastCameraY = camera.position.y;
    lastCameraZ = camera.position.z;
    lastTargetX = cameraTarget.x;
    lastTargetY = cameraTarget.y;
    lastTargetZ = cameraTarget.z;
    const labelBudget = declutterLabels(content, camera, renderer.domElement);
    renderer.render(scene, camera);
    renderedFrames += 1;
    renderer.domElement.dataset.spatialRenderedFrames = String(renderedFrames);
    renderer.domElement.dataset.spatialDrawCalls = String(renderer.info.render.calls);
    renderer.domElement.dataset.spatialTriangles = String(renderer.info.render.triangles);
    renderer.domElement.dataset.spatialTextures = String(renderer.info.memory.textures);
    renderer.domElement.dataset.spatialVisibleLabels = String(labelBudget.visible);
    renderer.domElement.dataset.spatialTotalLabels = String(labelBudget.total);
    renderer.domElement.dataset.spatialCameraState = [camera.position.x, camera.position.y, camera.position.z].map((value) => value.toFixed(3)).join(",");
    renderer.domElement.dataset.spatialCameraTarget = [cameraTarget.x, cameraTarget.y, cameraTarget.z].map((value) => value.toFixed(3)).join(",");
    if (reduceMotion) settleFrames = 0;
    else if (!interacting && settleFrames > 0) settleFrames -= 1;
    if (pinAnimating || interacting || settleFrames > 0 || cameraMoving) scheduleRender();
  };

  function scheduleRender(): void {
    if (!canRender() || frameHandle) return;
    frameHandle = window.requestAnimationFrame(renderFrame);
  }

  const updateActivity = (): void => {
    if (canRender()) scheduleRender();
    else if (frameHandle) {
      window.cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    }
  };

  const resizeScene = (): void => {
    if (!mounted) return;
    applySize(container, renderer, camera);
    frameCamera(camera, controls, bounds);
    settleFrames = reduceMotion ? 0 : Math.max(settleFrames, 2);
    scheduleRender();
  };

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resizeScene);
  observer?.observe(container);
  cleanupStack.push(() => observer?.disconnect());
  window.addEventListener("resize", resizeScene, { passive: true });
  cleanupStack.push(() => window.removeEventListener("resize", resizeScene));

  const intersectionObserver = typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver((entries) => {
      inViewport = entries[0]?.isIntersecting ?? true;
      updateActivity();
    }, { threshold: 0.01 });
  intersectionObserver?.observe(container);
  cleanupStack.push(() => intersectionObserver?.disconnect());

  const onVisibilityChange = (): void => {
    documentVisible = document.visibilityState !== "hidden";
    updateActivity();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  cleanupStack.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));

  const onMotionChange = (event: MediaQueryListEvent): void => {
    reduceMotion = event.matches;
    controls.smoothTime = reduceMotion ? 0.01 : 0.18;
    controls.draggingSmoothTime = reduceMotion ? 0.01 : 0.08;
    renderer.domElement.dataset.spatialReducedMotion = String(reduceMotion);
    renderer.domElement.dataset.spatialDamping = String(!reduceMotion);
    if (reduceMotion) {
      settleFrames = 0;
      pinHalo?.scale.setScalar(1);
      if (pinCore) pinCore.position.y = pinBaseY;
    } else {
      pinAnimationStartedAt = null;
    }
    updateActivity();
  };
  motionQuery?.addEventListener("change", onMotionChange);
  cleanupStack.push(() => motionQuery?.removeEventListener("change", onMotionChange));

  const onControlsStart = (): void => {
    interacting = true;
    settleFrames = 0;
    scheduleRender();
  };
  const onControlsEnd = (): void => {
    interacting = false;
    settleFrames = reduceMotion ? 0 : Math.max(settleFrames, 6);
    scheduleRender();
  };
  const onControlsRest = (): void => {
    interacting = false;
    settleFrames = 0;
  };
  controls.addEventListener("controlstart", onControlsStart);
  controls.addEventListener("control", scheduleRender);
  controls.addEventListener("controlend", onControlsEnd);
  controls.addEventListener("rest", onControlsRest);
  cleanupStack.push(() => {
    controls.removeEventListener("controlstart", onControlsStart);
    controls.removeEventListener("control", scheduleRender);
    controls.removeEventListener("controlend", onControlsEnd);
    controls.removeEventListener("rest", onControlsRest);
  });

  const orbitFromKeyboard = (azimuth: number, polar: number, zoom: number): void => {
    // Glide the nudge to match pointer damping, but only when motion is allowed —
    // under prefers-reduced-motion this must resolve in a single frame (no settle
    // loop), so we step instantly and force one update.
    const eased = !reduceMotion;
    void controls.rotate(azimuth, polar, eased);
    if (zoom !== 1) void controls.dolly(controls.distance * (1 - zoom), eased);
    if (!eased) controls.update(0);
    settleFrames = reduceMotion ? 0 : Math.max(settleFrames, 6);
    scheduleRender();
  };

  // Keyboard object selection: [ and ] cycle through furniture/boxes, Enter/Space
  // frames the selected object. Lets keyboard users reach specific objects, not
  // just orbit — parity with the DOM anchor list.
  const cycleSelection = (direction: 1 | -1): void => {
    if (!solidObjects.length) return;
    const currentId = renderer.domElement.dataset.spatialSelectedId || null;
    const index = currentId ? solidObjects.findIndex((object) => object.id === currentId) : -1;
    const next = solidObjects[(index + direction + solidObjects.length) % solidObjects.length];
    if (next) setSelected(next.id);
  };

  const onCanvasKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case "ArrowLeft": orbitFromKeyboard(-CAMERA_KEY_ROTATION, 0, 1); break;
      case "ArrowRight": orbitFromKeyboard(CAMERA_KEY_ROTATION, 0, 1); break;
      case "ArrowUp": orbitFromKeyboard(0, -CAMERA_KEY_ROTATION, 1); break;
      case "ArrowDown": orbitFromKeyboard(0, CAMERA_KEY_ROTATION, 1); break;
      case "+":
      case "=": orbitFromKeyboard(0, 0, 0.88); break;
      case "-":
      case "_": orbitFromKeyboard(0, 0, 1.14); break;
      case "]": cycleSelection(1); break;
      case "[": cycleSelection(-1); break;
      case "Enter":
      case " ": {
        const current = renderer.domElement.dataset.spatialSelectedId;
        const object = current ? objectData.get(current) ?? null : null;
        if (object) focusObject(object, true); else return;
        break;
      }
      case "Home": frameCamera(camera, controls, bounds); settleFrames = reduceMotion ? 0 : Math.max(settleFrames, 6); scheduleRender(); break;
      default: return;
    }
    event.preventDefault();
  };
  renderer.domElement.addEventListener("keydown", onCanvasKeyDown);
  cleanupStack.push(() => renderer.domElement.removeEventListener("keydown", onCanvasKeyDown));

  // Fitted selection + hover outlines: EdgesGeometry line loops parented to the
  // object root, so they inherit the object's rotation instead of the crude
  // axis-aligned cage the old Box3Helper drew. Rebuilt on change, disposed on clear.
  let selectionOutline: Group | null = null;
  let hoverOutline: Group | null = null;

  const disposeOutline = (holder: Group | null): void => {
    if (!holder) return;
    holder.parent?.remove(holder);
    holder.traverse((node: Object3D) => {
      const line = node as LineSegments;
      if (line.isLineSegments) {
        line.geometry.dispose();
        (line.material as Material).dispose();
      }
    });
  };

  const buildOutline = (id: string, color: number, opacity: number, renderOrder: number): Group | null => {
    const root = objectRoots.get(id);
    if (!root) return null;
    const holder = new Group();
    holder.name = "spatial-outline";
    root.traverse((node: Object3D) => {
      const mesh = node as Mesh;
      if (mesh.isMesh && mesh.geometry) {
        const edges = new LineSegments(
          new EdgesGeometry(mesh.geometry, 24),
          new LineBasicMaterial({ color, transparent: true, opacity })
        );
        edges.position.copy(mesh.position);
        edges.quaternion.copy(mesh.quaternion);
        edges.scale.copy(mesh.scale);
        edges.renderOrder = renderOrder;
        holder.add(edges);
      }
    });
    if (!holder.children.length) return null;
    root.add(holder);
    return holder;
  };

  const raycaster = new Raycaster();
  const pointer = new Vector2();

  const selectedObject = (): SpatialObject | null => {
    const id = renderer.domElement.dataset.spatialSelectedId;
    return id ? objectData.get(id) ?? null : null;
  };

  const focusObject = (object: SpatialObject, transition: boolean): void => {
    const root = objectRoots.get(object.id);
    if (!root) return;
    const objectBounds = new Box3().setFromObject(root);
    const objectCenter = objectBounds.getCenter(new Vector3());
    const objectSize = objectBounds.getSize(new Vector3());
    const radius = Math.max(0.7, objectSize.length());
    const room = data.rooms.find((entry) => entry.id === object.roomId);
    const position = objectCenter.clone().add(new Vector3(-radius * 1.28, radius * 0.95, radius * 1.48));
    if (room) {
      position.x = MathUtils.clamp(position.x, room.x + 0.35, room.x + room.w - 0.35);
      position.z = MathUtils.clamp(position.z, room.z + 0.42, room.z + room.d - 0.42);
      position.y = Math.max(position.y, 1.4);
    }
    void controls.setLookAt(position.x, position.y, position.z, objectCenter.x, Math.max(0.28, objectCenter.y * 0.62), objectCenter.z, transition && !reduceMotion);
    settleFrames = reduceMotion ? 0 : 6;
    scheduleRender();
  };

  let hoverId: string | null = null;
  const setSelected = (id: string | null, { focus = false }: { focus?: boolean } = {}): void => {
    const object = id ? objectData.get(id) ?? null : null;
    renderer.domElement.dataset.spatialSelectedId = object?.id ?? "";
    disposeOutline(selectionOutline);
    selectionOutline = null;
    if (object) {
      selectionOutline = buildOutline(object.id, SELECTION_OUTLINE_COLOR, 0.95, 42);
      // A newly selected object should not keep a stale hover ghost on it.
      if (hoverId === object.id) { disposeOutline(hoverOutline); hoverOutline = null; hoverId = null; }
      // Selecting the located object re-arms the pin pulse so pin and outline
      // read as one gesture. Time-boxed to ~800ms in renderFrame, so it quiesces.
      if (!reduceMotion && data.pin?.objectId === object.id) pinAnimationStartedAt = null;
      if (focus) focusObject(object, true);
    }
    // Observable marker: 'fitted' when a fitted EdgesGeometry outline is mounted,
    // '' when nothing is selected. Lets verification assert the outline style.
    renderer.domElement.dataset.spatialSelectionOutline = selectionOutline ? "fitted" : "";
    container.dispatchEvent(new CustomEvent<SpatialSelection | null>("spatial-selection", {
      bubbles: true,
      detail: object ? {
        id: object.id,
        name: object.name ?? object.label ?? object.id,
        roomId: object.roomId,
        kind: object.kind ?? "furniture",
        archetype: object.archetype ?? (object.kind === "box" ? "box" : "block")
      } : null
    }));
    scheduleRender();
  };

  // Hover is a lightweight, dimmer outline distinct from the committed selection.
  // It also emits a `spatial-hover` event (id + screen coords, or null) so the DOM
  // can show a confidence tooltip — the scene stays ignorant of the Place Graph and
  // just reports what's under the pointer and where.
  const setHovered = (id: string | null, screen: { x: number; y: number } | null = null): void => {
    if (id === hoverId) {
      if (id && screen) container.dispatchEvent(new CustomEvent("spatial-hover", { bubbles: true, detail: { id, x: screen.x, y: screen.y } }));
      return;
    }
    hoverId = id;
    disposeOutline(hoverOutline);
    hoverOutline = null;
    // Never draw a hover ghost on the already-selected object.
    if (id && id !== renderer.domElement.dataset.spatialSelectedId) {
      hoverOutline = buildOutline(id, HOVER_OUTLINE_COLOR, 0.5, 41);
    }
    renderer.domElement.style.cursor = id ? "pointer" : "";
    renderer.domElement.dataset.spatialHovered = hoverOutline ? (hoverId ?? "") : "";
    container.dispatchEvent(new CustomEvent("spatial-hover", { bubbles: true, detail: id && screen ? { id, x: screen.x, y: screen.y } : null }));
    scheduleRender();
  };
  cleanupStack.push(() => { disposeOutline(selectionOutline); disposeOutline(hoverOutline); });

  const applyPreset = (preset: SpatialViewPreset): void => {
    const animate = !reduceMotion;
    if (preset === "study") {
      const desk = solidObjects.find((object) => object.archetype === "desk") ?? solidObjects[0];
      if (desk) focusObject(desk, animate);
    } else if (preset === "top") {
      const planCenter = bounds.getCenter(new Vector3());
      const extent = Math.max(size.x, size.z) * 1.18;
      void controls.setLookAt(planCenter.x, extent + 3.4, planCenter.z + 0.001, planCenter.x, 0, planCenter.z, animate);
      settleFrames = animate ? 6 : 0;
      scheduleRender();
    } else {
      const planCenter = bounds.getCenter(new Vector3());
      const radius = Math.max(size.length() * 0.5, 1);
      const position = planCenter.clone().add(new Vector3(radius * 1.42, radius * 1.05, radius * 1.48));
      void controls.setLookAt(position.x, position.y, position.z, planCenter.x, 0.56, planCenter.z, animate);
      settleFrames = animate ? 6 : 0;
      scheduleRender();
    }
    renderer.domElement.dataset.spatialPreset = preset;
    container.dispatchEvent(new CustomEvent<SpatialViewPreset>("spatial-preset-change", { bubbles: true, detail: preset }));
  };

  // X-ray: drop wall + furniture/box opacity so the user can see through the
  // dollhouse to boxes/items behind near walls. Pure render-state, one flag.
  let xrayOn = false;
  const setXray = (on: boolean): void => {
    if (on === xrayOn) return;
    xrayOn = on;
    const apply = (root: Object3D, opacity: number, matchWallsOnly: boolean): void => {
      root.traverse((node: Object3D) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        if (matchWallsOnly && !mesh.name.includes(":wall:")) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const std = material as MeshStandardMaterial;
          if (std.userData["baseOpacity"] === undefined) std.userData["baseOpacity"] = std.opacity;
          const base = std.userData["baseOpacity"] as number;
          std.transparent = on ? true : base < 1;
          std.opacity = on ? Math.min(base, opacity) : base;
          std.needsUpdate = true;
        }
      });
    };
    apply(content, 0.16, true);      // walls
    apply(furnitureLayer, 0.34, false);
    apply(boxLayer, 0.4, false);
    renderer.domElement.dataset.spatialXray = String(on);
    scheduleRender();
  };

  const layerDatasetKey = (layer: string): string => `spatialLayer${layer.charAt(0).toUpperCase()}${layer.slice(1)}`;

  const onSurfaceCommand = (event: Event): void => {
    const command = event as CustomEvent<{ type?: string; preset?: SpatialViewPreset; id?: string; layer?: string; visible?: boolean; on?: boolean }>;
    if (command.detail?.type === "preset" && (command.detail.preset === "home" || command.detail.preset === "study" || command.detail.preset === "top")) {
      applyPreset(command.detail.preset);
    } else if (command.detail?.type === "select") {
      setSelected(command.detail.id ?? null, { focus: true });
    } else if (command.detail?.type === "layer" && command.detail.layer) {
      const layer = command.detail.layer;
      const group = layerGroups[layer];
      if (group) {
        group.visible = command.detail.visible ?? !group.visible;
        renderer.domElement.dataset[layerDatasetKey(layer)] = String(group.visible);
        scheduleRender();
      }
    } else if (command.detail?.type === "xray") {
      setXray(command.detail.on ?? !xrayOn);
    }
  };
  container.addEventListener("spatial-command", onSurfaceCommand);
  cleanupStack.push(() => container.removeEventListener("spatial-command", onSurfaceCommand));

  // Publish initial layer/xray telemetry so the DOM can reflect current state.
  for (const [name, group] of Object.entries(layerGroups)) {
    renderer.domElement.dataset[layerDatasetKey(name)] = String(group.visible);
  }
  renderer.domElement.dataset.spatialXray = "false";

  const pickObject = (event: MouseEvent): { id: string | null; isPin: boolean } => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(interactiveMeshes, false)[0]?.object;
    const id = hit?.userData["spatialObjectId"];
    return { id: typeof id === "string" ? id : null, isPin: hit?.name === "pin-core" };
  };
  const pickObjectId = (event: MouseEvent): string | null => pickObject(event).id;

  const onCanvasClick = (event: MouseEvent): void => {
    const { id, isPin } = pickObject(event);
    setSelected(id);
    // Clicking the confidence pin re-focuses the located item (read-only camera
    // move). Plain furniture clicks stay a select; double-click frames them.
    if (isPin && id) {
      const object = objectData.get(id) ?? null;
      if (object) focusObject(object, true);
    }
  };
  renderer.domElement.addEventListener("click", onCanvasClick);
  cleanupStack.push(() => renderer.domElement.removeEventListener("click", onCanvasClick));

  // A second click / double-click on an object frames it, matching the eased
  // focus that list + command selection already gets (focus:true). Single click
  // stays a plain select so it never surprises the user with a camera move.
  const onCanvasDblClick = (event: MouseEvent): void => {
    const id = pickObjectId(event);
    const object = id ? objectData.get(id) ?? null : null;
    if (object) focusObject(object, true);
  };
  renderer.domElement.addEventListener("dblclick", onCanvasDblClick);
  cleanupStack.push(() => renderer.domElement.removeEventListener("dblclick", onCanvasDblClick));

  // Hover raycast, rAF-throttled to one probe per frame. Each hover change fires a
  // single scheduleRender (which quiesces) — never a continuous loop. Skipped while
  // the pointer is dragging the camera so orbit stays cheap.
  let hoverProbePending = false;
  let lastPointerEvent: MouseEvent | null = null;
  const onCanvasPointerMove = (event: MouseEvent): void => {
    if (interacting) return;
    lastPointerEvent = event;
    if (hoverProbePending) return;
    hoverProbePending = true;
    window.requestAnimationFrame(() => {
      hoverProbePending = false;
      if (!lastPointerEvent || !canRender()) return;
      setHovered(pickObjectId(lastPointerEvent), { x: lastPointerEvent.clientX, y: lastPointerEvent.clientY });
    });
  };
  const onCanvasPointerLeave = (): void => setHovered(null);
  renderer.domElement.addEventListener("pointermove", onCanvasPointerMove, { passive: true });
  renderer.domElement.addEventListener("pointerleave", onCanvasPointerLeave);
  cleanupStack.push(() => {
    renderer.domElement.removeEventListener("pointermove", onCanvasPointerMove);
    renderer.domElement.removeEventListener("pointerleave", onCanvasPointerLeave);
  });

  renderer.domElement.dataset.spatialPreset = "home";
  // Prefer auto-selecting the object the pin sits on/in so the located memory and
  // its selection outline reinforce each other; fall back to a room-level match.
  // When the selection came from an active locate pin (a "take me there" from
  // Recall/Ask), frame the camera on it too so the answer is centred, not left for
  // the user to hunt for. A plain plan visit (no pin, or only a room-level match)
  // keeps the whole-home overview.
  const pinnedObjectId = data.pin?.objectId && objectData.has(data.pin.objectId) ? data.pin.objectId : null;
  const initial = pinnedObjectId
    ? objectData.get(pinnedObjectId) ?? null
    : solidObjects.find((object) => data.pin && object.roomId === data.pin.roomId) ?? null;
  if (initial) setSelected(initial.id, { focus: initial.id === pinnedObjectId });

  const onContextLost = (event: Event): void => {
    event.preventDefault();
    contextAvailable = false;
    updateActivity();
  };
  const onContextRestored = (): void => {
    contextAvailable = true;
    scheduleRender();
  };
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
  cleanupStack.push(() => {
    renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
    renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
  });

  scheduleRender();

  return cleanup;
  } catch {
    cleanup();
    return mountSpatialFallback(container, data);
  }
}
