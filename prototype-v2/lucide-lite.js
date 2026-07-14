import createElement from "./node_modules/lucide/dist/esm/createElement.mjs";

import ArrowRight from "./node_modules/lucide/dist/esm/icons/arrow-right.mjs";
import Barcode from "./node_modules/lucide/dist/esm/icons/barcode.mjs";
import Box from "./node_modules/lucide/dist/esm/icons/box.mjs";
import Boxes from "./node_modules/lucide/dist/esm/icons/boxes.mjs";
import Camera from "./node_modules/lucide/dist/esm/icons/camera.mjs";
import Check from "./node_modules/lucide/dist/esm/icons/check.mjs";
import Cuboid from "./node_modules/lucide/dist/esm/icons/cuboid.mjs";
import Dumbbell from "./node_modules/lucide/dist/esm/icons/dumbbell.mjs";
import House from "./node_modules/lucide/dist/esm/icons/house.mjs";
import Info from "./node_modules/lucide/dist/esm/icons/info.mjs";
import ListChecks from "./node_modules/lucide/dist/esm/icons/list-checks.mjs";
import MapIcon from "./node_modules/lucide/dist/esm/icons/map.mjs";
import MapPin from "./node_modules/lucide/dist/esm/icons/map-pin.mjs";
import Maximize2 from "./node_modules/lucide/dist/esm/icons/maximize-2.mjs";
import PackageSearch from "./node_modules/lucide/dist/esm/icons/package-search.mjs";
import PanelsTopLeft from "./node_modules/lucide/dist/esm/icons/panels-top-left.mjs";
import Route from "./node_modules/lucide/dist/esm/icons/route.mjs";
import Rows3 from "./node_modules/lucide/dist/esm/icons/rows-3.mjs";
import Ruler from "./node_modules/lucide/dist/esm/icons/ruler.mjs";
import ScanLine from "./node_modules/lucide/dist/esm/icons/scan-line.mjs";
import ScanSearch from "./node_modules/lucide/dist/esm/icons/scan-search.mjs";
import Search from "./node_modules/lucide/dist/esm/icons/search.mjs";
import ShieldCheck from "./node_modules/lucide/dist/esm/icons/shield-check.mjs";
import Sparkles from "./node_modules/lucide/dist/esm/icons/sparkles.mjs";
import WandSparkles from "./node_modules/lucide/dist/esm/icons/wand-sparkles.mjs";
import X from "./node_modules/lucide/dist/esm/icons/x.mjs";

const icons = {
  "arrow-right": ArrowRight,
  barcode: Barcode,
  box: Box,
  boxes: Boxes,
  camera: Camera,
  check: Check,
  cuboid: Cuboid,
  dumbbell: Dumbbell,
  house: House,
  info: Info,
  "list-checks": ListChecks,
  map: MapIcon,
  "map-pin": MapPin,
  "maximize-2": Maximize2,
  "package-search": PackageSearch,
  "panels-top-left": PanelsTopLeft,
  route: Route,
  "rows-3": Rows3,
  ruler: Ruler,
  "scan-line": ScanLine,
  "scan-search": ScanSearch,
  search: Search,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  "wand-sparkles": WandSparkles,
  x: X
};

export function decorateIcons(root = document) {
  root.querySelectorAll("[data-lucide]").forEach((placeholder) => {
    const name = placeholder.getAttribute("data-lucide");
    const icon = name ? icons[name] : null;
    if (!icon) return;
    const svg = createElement(icon, {
      "data-lucide": name,
      class: `lucide lucide-${name}`,
      "stroke-width": "1.8",
      "aria-hidden": "true"
    });
    placeholder.replaceWith(svg);
  });
}
