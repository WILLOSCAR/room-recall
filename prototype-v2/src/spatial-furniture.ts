import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type SpatialArchetype = "bed" | "wardrobe" | "desk" | "bookcase" | "nightstand" | "rack" | "box" | "block";

export interface FurnitureMaterials {
  wood: MeshStandardMaterial;
  woodDark: MeshStandardMaterial;
  linen: MeshStandardMaterial;
  sage: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  paper: MeshStandardMaterial;
  cardboard: MeshStandardMaterial;
  tape: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  accent: MeshStandardMaterial;
}

export interface FurnitureBuildSpec {
  id: string;
  name: string;
  archetype: SpatialArchetype;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rotationY?: number;
}

export interface FurnitureBuildResult {
  root: Group;
  interactiveMeshes: Mesh[];
}

function roundedGeometry(w: number, h: number, d: number, radius = 0.025): RoundedBoxGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w * 0.2, h * 0.2, d * 0.2));
}

function part(
  parent: Group,
  name: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: MeshStandardMaterial,
  rounded = true
): Mesh {
  const mesh = new Mesh(rounded ? roundedGeometry(w, h, d) : new BoxGeometry(w, h, d), material);
  mesh.name = name;
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addHandle(parent: Group, x: number, y: number, z: number, vertical: boolean, materials: FurnitureMaterials): void {
  const handle = new Mesh(new CylinderGeometry(0.012, 0.012, 0.11, 10), materials.metal);
  handle.rotation.z = vertical ? 0 : Math.PI / 2;
  handle.position.set(x, y, z);
  handle.castShadow = true;
  parent.add(handle);
}

function buildBed(root: Group, spec: FurnitureBuildSpec, m: FurnitureMaterials): void {
  const { w, d, h } = spec;
  const frameH = Math.min(0.22, h * 0.46);
  part(root, "bed-frame", 0, 0.05, 0, w, frameH, d, m.woodDark);
  part(root, "mattress", 0, frameH, 0.02, w * 0.94, Math.max(0.18, h * 0.42), d * 0.92, m.linen, true);
  part(root, "duvet", 0, frameH + 0.14, d * 0.09, w * 0.9, 0.09, d * 0.65, m.sage, true);
  part(root, "headboard", 0, 0.04, -d * 0.47, w, Math.max(0.62, h + 0.2), 0.08, m.woodDark, true);
  const pillowW = Math.min(0.58, w * 0.32);
  part(root, "pillow-left", -w * 0.2, frameH + 0.22, -d * 0.3, pillowW, 0.12, d * 0.22, m.paper, true);
  part(root, "pillow-right", w * 0.2, frameH + 0.22, -d * 0.3, pillowW, 0.12, d * 0.22, m.paper, true);
}

function buildWardrobe(root: Group, spec: FurnitureBuildSpec, m: FurnitureMaterials): void {
  const { w, d, h } = spec;
  part(root, "wardrobe-case", 0, 0, 0, w, h, d, m.wood, true);
  const doorGap = 0.018;
  const doorW = (w - doorGap * 3) / 2;
  const front = d / 2 + 0.012;
  part(root, "wardrobe-door-left", -doorW / 2 - doorGap / 2, 0.06, front, doorW, h - 0.12, 0.035, m.paper, true);
  part(root, "wardrobe-door-right", doorW / 2 + doorGap / 2, 0.06, front, doorW, h - 0.12, 0.035, m.paper, true);
  addHandle(root, -0.055, h * 0.5, front + 0.035, true, m);
  addHandle(root, 0.055, h * 0.5, front + 0.035, true, m);
  part(root, "wardrobe-plinth", 0, -0.035, 0, w * 1.03, 0.08, d * 1.04, m.woodDark, true);
}

function buildDesk(root: Group, spec: FurnitureBuildSpec, m: FurnitureMaterials): void {
  const { w, d, h } = spec;
  const topH = 0.075;
  part(root, "desk-top", 0, h - topH, 0, w, topH, d, m.wood, true);
  const legH = h - topH - 0.02;
  const legW = 0.055;
  for (const x of [-w * 0.43, w * 0.43]) {
    for (const z of [-d * 0.38, d * 0.38]) part(root, "desk-leg", x, 0, z, legW, legH, legW, m.metal, true);
  }
  const drawerW = Math.min(0.34, w * 0.27);
  part(root, "desk-drawer", w * 0.28, h * 0.46, 0, drawerW, 0.16, d * 0.72, m.woodDark, true);
  addHandle(root, w * 0.28, h * 0.57, d * 0.38, false, m);

  // A restrained study vignette makes the furniture legible without adding
  // any new Place Graph entity: monitor and chair are presentation-only parts.
  part(root, "monitor-screen", -w * 0.12, h + 0.2, -d * 0.25, Math.min(0.55, w * 0.42), 0.32, 0.035, m.metal, true);
  part(root, "monitor-panel", -w * 0.12, h + 0.225, -d * 0.225, Math.min(0.49, w * 0.37), 0.25, 0.012, m.glass, true);
  part(root, "monitor-stand", -w * 0.12, h + 0.015, -d * 0.24, 0.035, 0.19, 0.035, m.metal, true);
  part(root, "monitor-foot", -w * 0.12, h + 0.005, -d * 0.21, 0.22, 0.025, 0.14, m.metal, true);
  part(root, "chair-seat", 0, 0.43, d * 0.78, 0.44, 0.09, 0.42, m.sage, true);
  part(root, "chair-back", 0, 0.49, d * 0.94, 0.44, 0.48, 0.08, m.sage, true);
  part(root, "chair-column", 0, 0.05, d * 0.78, 0.055, 0.39, 0.055, m.metal, true);
  part(root, "chair-base", 0, 0.04, d * 0.78, 0.46, 0.035, 0.12, m.metal, true);
}

function buildBookcase(root: Group, spec: FurnitureBuildSpec, m: FurnitureMaterials): void {
  const { w, d, h } = spec;
  const side = Math.min(0.055, Math.min(w, d) * 0.18);
  const alongZ = d > w;
  const long = alongZ ? d : w;
  const depth = alongZ ? w : d;
  const placeShelf = (height: number): void => {
    part(root, "bookcase-shelf", 0, height, 0, w, side, d, m.woodDark, false);
  };
  if (alongZ) {
    part(root, "bookcase-side", 0, 0, -d / 2 + side / 2, w, h, side, m.wood, false);
    part(root, "bookcase-side", 0, 0, d / 2 - side / 2, w, h, side, m.wood, false);
    part(root, "bookcase-back", -w / 2 + side / 2, 0, 0, side, h, d, m.woodDark, false);
  } else {
    part(root, "bookcase-side", -w / 2 + side / 2, 0, 0, side, h, d, m.wood, false);
    part(root, "bookcase-side", w / 2 - side / 2, 0, 0, side, h, d, m.wood, false);
    part(root, "bookcase-back", 0, 0, -d / 2 + side / 2, w, h, side, m.woodDark, false);
  }
  for (let index = 0; index <= 4; index += 1) placeShelf(Math.min(h - side, index * (h - side) / 4));

  const bookGeometry = new BoxGeometry(1, 1, 1);
  const bookMaterial = m.accent.clone();
  bookMaterial.vertexColors = true;
  const count = 15;
  const books = new InstancedMesh(bookGeometry, bookMaterial, count);
  const matrix = new Matrix4();
  const colors = [0x9e5b43, 0x355f54, 0xc39a62, 0x6c7284, 0x86734f];
  const available = Math.max(0.15, long - side * 2.5);
  for (let index = 0; index < count; index += 1) {
    const shelf = index % 3;
    const column = Math.floor(index / 3);
    const bookW = Math.min(0.055, available / 8);
    const bookH = h * (0.12 + (index % 4) * 0.012);
    const longPos = -available / 2 + bookW * 1.2 + column * bookW * 1.45;
    const y = (shelf + 1) * (h - side) / 4 + side / 2 + bookH / 2;
    const position = alongZ ? new Vector3(depth * 0.08, y, longPos) : new Vector3(longPos, y, depth * 0.08);
    matrix.compose(position, books.quaternion, alongZ ? new Vector3(depth * 0.22, bookH, bookW) : new Vector3(bookW, bookH, depth * 0.22));
    books.setMatrixAt(index, matrix);
    books.setColorAt(index, new Color(colors[index % colors.length] ?? colors[0]));
  }
  books.name = "book-spines";
  books.castShadow = true;
  books.receiveShadow = true;
  books.instanceMatrix.needsUpdate = true;
  books.instanceColor!.needsUpdate = true;
  root.add(books);
}

function buildNightstand(root: Group, spec: FurnitureBuildSpec, m: FurnitureMaterials): void {
  const { w, d, h } = spec;
  part(root, "nightstand-case", 0, 0.04, 0, w, h - 0.04, d, m.wood, true);
  part(root, "nightstand-top", 0, h - 0.025, 0, w * 1.05, 0.06, d * 1.05, m.woodDark, true);
  for (let index = 0; index < 2; index += 1) {
    const y = h * (0.18 + index * 0.34);
    part(root, "nightstand-drawer", 0, y, d / 2 + 0.012, w * 0.86, h * 0.26, 0.035, m.paper, true);
    addHandle(root, 0, y + h * 0.13, d / 2 + 0.04, false, m);
  }
}

function buildRack(root: Group, spec: FurnitureBuildSpec, m: FurnitureMaterials): void {
  const { w, d, h } = spec;
  const alongZ = d > w;
  const post = Math.min(0.045, Math.min(w, d) * 0.18);
  for (const x of [-w / 2 + post / 2, w / 2 - post / 2]) {
    for (const z of [-d / 2 + post / 2, d / 2 - post / 2]) part(root, "rack-post", x, 0, z, post, h, post, m.metal, true);
  }
  for (let level = 0; level < 3; level += 1) {
    const y = 0.04 + level * Math.max(0.1, (h - 0.12) / 2);
    part(root, "rack-shelf", 0, y, 0, w, 0.045, d, level === 2 ? m.wood : m.woodDark, true);
  }
  if (!alongZ && h > 0.45) part(root, "rack-basket", 0, h * 0.35, 0, w * 0.62, h * 0.22, d * 0.72, m.linen, true);
}

function buildBox(root: Group, spec: FurnitureBuildSpec, m: FurnitureMaterials): void {
  const { w, d, h } = spec;
  part(root, "moving-box", 0, 0, 0, w, h, d, m.cardboard, true);
  part(root, "box-tape", 0, h + 0.006, 0, Math.min(0.09, w * 0.22), 0.014, d * 0.92, m.tape, false);
  part(root, "box-label", 0, h * 0.46, d / 2 + 0.014, w * 0.52, h * 0.25, 0.018, m.paper, true);
}

function buildBlock(root: Group, spec: FurnitureBuildSpec, m: FurnitureMaterials): void {
  part(root, "furniture-block", 0, 0, 0, spec.w, spec.h, spec.d, m.sage, true);
}

export function addFurnitureObject(parent: Group, spec: FurnitureBuildSpec, materials: FurnitureMaterials): FurnitureBuildResult {
  const root = new Group();
  root.name = `spatial-object:${spec.id}`;
  root.position.set(spec.x + spec.w / 2, spec.y, spec.z + spec.d / 2);
  root.rotation.y = spec.rotationY ?? 0;
  root.userData["spatialObjectId"] = spec.id;
  root.userData["spatialObjectName"] = spec.name;
  root.userData["spatialArchetype"] = spec.archetype;

  switch (spec.archetype) {
    case "bed": buildBed(root, spec, materials); break;
    case "wardrobe": buildWardrobe(root, spec, materials); break;
    case "desk": buildDesk(root, spec, materials); break;
    case "bookcase": buildBookcase(root, spec, materials); break;
    case "nightstand": buildNightstand(root, spec, materials); break;
    case "rack": buildRack(root, spec, materials); break;
    case "box": buildBox(root, spec, materials); break;
    default: buildBlock(root, spec, materials);
  }

  const interactiveMeshes: Mesh[] = [];
  root.traverse((node: Object3D) => {
    node.userData["spatialObjectId"] = spec.id;
    node.userData["spatialObjectName"] = spec.name;
    node.userData["spatialArchetype"] = spec.archetype;
    if (node instanceof Mesh) interactiveMeshes.push(node);
  });
  parent.add(root);
  return { root, interactiveMeshes };
}
