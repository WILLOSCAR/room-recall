import type { BufferGeometry, ColorRepresentation, Material, Object3D } from "three";
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  EdgesGeometry
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type SpatialObjectKind = "furniture" | "box";
export type SpatialProposalState = "accepted" | "pending" | "rejected";

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
  color?: ColorRepresentation;
  proposalState?: SpatialProposalState;
}

export interface SpatialPin {
  x: number;
  z: number;
  y?: number;
  radius?: number;
  roomId?: string;
  color?: ColorRepresentation;
}

export interface SpatialSceneData {
  rooms: SpatialRoom[];
  objects?: SpatialObject[];
  proposals?: SpatialObject[];
  pin?: SpatialPin | null;
}

const OFF_WHITE = 0xf7f3ec;
const FLOOR_COLOR = 0xfdfaf5;
const WALL_COLOR = 0xe6ddd0;
const FURNITURE_COLOR = 0xd8d0c2;
const BOX_COLOR = 0xc9643b;
const PIN_COLOR = 0xc9643b;
const PROPOSAL_COLORS: Record<SpatialProposalState, number> = {
  accepted: 0x5f7d5a,
  pending: 0xb07d24,
  rejected: 0xb04a3c
};

const FLOOR_THICKNESS = 0.04;
const WALL_HEIGHT = 0.82;
const WALL_THICKNESS = 0.06;

function createSolidMaterial(color: ColorRepresentation): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.95,
    metalness: 0.02
  });
}

function createProposalMaterial(color: ColorRepresentation): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.02,
    transparent: true,
    opacity: 0.32,
    depthWrite: false
  });
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
  const mesh = new Mesh(new BoxGeometry(w, h, d), material);
  mesh.name = id;
  positionCuboid(mesh, x, y, z, w, h, d);
  parent.add(mesh);
  return mesh;
}

function addRoom(parent: Group, room: SpatialRoom): void {
  const floor = addCuboid(
    parent,
    `${room.id}:floor`,
    room.x,
    -FLOOR_THICKNESS,
    room.z,
    room.w,
    FLOOR_THICKNESS,
    room.d,
    createSolidMaterial(FLOOR_COLOR)
  );
  floor.receiveShadow = false;

  addCuboid(
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
  addCuboid(
    parent,
    `${room.id}:wall:south`,
    room.x,
    0,
    room.z + room.d - WALL_THICKNESS,
    room.w,
    WALL_HEIGHT,
    WALL_THICKNESS,
    createSolidMaterial(WALL_COLOR)
  );
  addCuboid(
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
  addCuboid(
    parent,
    `${room.id}:wall:east`,
    room.x + room.w - WALL_THICKNESS,
    0,
    room.z,
    WALL_THICKNESS,
    WALL_HEIGHT,
    room.d,
    createSolidMaterial(WALL_COLOR)
  );
}

function addSpatialObject(parent: Group, object: SpatialObject): void {
  const color = object.color ?? (object.kind === "box" ? BOX_COLOR : FURNITURE_COLOR);
  const mesh = addCuboid(
    parent,
    object.id,
    object.x,
    object.y ?? 0,
    object.z,
    object.w,
    object.h,
    object.d,
    createSolidMaterial(color)
  );
  mesh.userData.kind = object.kind ?? "furniture";
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

  const edges = new LineSegments(
    new EdgesGeometry(mesh.geometry),
    new LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
  );
  edges.position.copy(mesh.position);
  edges.renderOrder = 5;
  parent.add(edges);
}

function addPin(parent: Group, pin: SpatialPin): void {
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
  parent.add(orb);
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

  const solidObjects = (data.objects ?? []).filter((object) => !object.proposalState);
  const proposalObjects = [...(data.proposals ?? []), ...(data.objects ?? []).filter((object) => !!object.proposalState)];

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

function applySize(container: HTMLElement, renderer: WebGLRenderer, camera: PerspectiveCamera): void {
  const width = Math.max(1, Math.round(container.clientWidth || container.getBoundingClientRect().width || 1));
  const height = Math.max(1, Math.round(container.clientHeight || container.getBoundingClientRect().height || 1));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function frameCamera(camera: PerspectiveCamera, controls: OrbitControls, bounds: Box3): void {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const halfFovY = MathUtils.degToRad(camera.fov * 0.5);
  const halfFovX = Math.atan(Math.tan(halfFovY) * camera.aspect);
  const distance = Math.max(radius / Math.sin(halfFovY), radius / Math.sin(halfFovX)) * 1.18;
  const direction = new Vector3(1, 0.78, 1).normalize();

  controls.target.copy(center);
  controls.minDistance = Math.max(1.4, radius * 0.32);
  controls.maxDistance = Math.max(8, radius * 8);

  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.05, distance / 120);
  camera.far = Math.max(50, distance * 24);
  camera.updateProjectionMatrix();
  controls.update();
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
  for (const material of materials) material.dispose();
}

export function mountSpatialScene(container: HTMLElement, data: SpatialSceneData): () => void {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(OFF_WHITE, 0.94);
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", "Interactive 3D spatial layout");
  renderer.domElement.tabIndex = 0;
  renderer.domElement.dataset.spatialSceneCanvas = "true";
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.zIndex = "0";

  const originalContainerStyle = {
    position: container.style.position,
    overflow: container.style.overflow,
    minHeight: container.style.minHeight
  };

  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  container.style.overflow = "hidden";
  if (!container.style.minHeight && container.clientHeight === 0) {
    container.style.minHeight = "240px";
  }

  container.insertBefore(renderer.domElement, container.firstChild);

  const overlaySnapshots = Array.from(container.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== renderer.domElement)
    .map((child) => {
      const snapshot = { child, position: child.style.position, zIndex: child.style.zIndex };
      if (getComputedStyle(child).position === "static") child.style.position = "relative";
      if (getComputedStyle(child).zIndex === "auto") child.style.zIndex = "1";
      return snapshot;
    });

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.screenSpacePanning = false;

  scene.add(new AmbientLight(0xffffff, 1.1));
  const sun = new DirectionalLight(0xffffff, 1.35);
  sun.position.set(8, 12, 6);
  scene.add(sun);

  const content = new Group();
  scene.add(content);

  for (const room of data.rooms) addRoom(content, room);

  const solidObjects = (data.objects ?? []).filter((object) => !object.proposalState);
  const proposalObjects = [...(data.proposals ?? []), ...(data.objects ?? []).filter((object) => !!object.proposalState)];

  for (const object of solidObjects) addSpatialObject(content, object);
  for (const proposal of proposalObjects) addProposalObject(content, proposal);
  if (data.pin) addPin(content, data.pin);

  const bounds = measureBounds(data);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const gridSize = Math.max(4, Math.ceil(Math.max(size.x, size.z) + 2));
  const grid = new GridHelper(gridSize, Math.max(4, gridSize * 2), 0xd7cec2, 0xe9e2d8);
  grid.position.set(center.x, 0.001, center.z);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const material of gridMaterials) {
    material.transparent = true;
    material.opacity = 0.55;
  }
  scene.add(grid);

  applySize(container, renderer, camera);
  frameCamera(camera, controls, bounds);

  let mounted = true;
  let frameHandle = 0;

  const observer = new ResizeObserver(() => {
    if (!mounted) return;
    applySize(container, renderer, camera);
    frameCamera(camera, controls, bounds);
  });
  observer.observe(container);

  const renderLoop = (): void => {
    if (!mounted) return;
    controls.update();
    renderer.render(scene, camera);
    frameHandle = window.requestAnimationFrame(renderLoop);
  };
  frameHandle = window.requestAnimationFrame(renderLoop);

  return () => {
    mounted = false;
    if (frameHandle) window.cancelAnimationFrame(frameHandle);
    observer.disconnect();
    controls.dispose();
    disposeScene(scene);
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();

    for (const snapshot of overlaySnapshots) {
      snapshot.child.style.position = snapshot.position;
      snapshot.child.style.zIndex = snapshot.zIndex;
    }
    container.style.position = originalContainerStyle.position;
    container.style.overflow = originalContainerStyle.overflow;
    container.style.minHeight = originalContainerStyle.minHeight;
  };
}
