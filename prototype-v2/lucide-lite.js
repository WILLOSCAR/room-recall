/**
 * Selected Lucide v1.24.0 icon nodes, bundled locally to avoid one HTTP
 * request per icon in the zero-bundler prototype.
 * @license ISC — see node_modules/lucide/LICENSE
 */

const defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round"
};

function createSvgElement([tag, attributes, children]) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  for (const child of children ?? []) element.appendChild(createSvgElement(child));
  return element;
}
function createElement(iconNode, customAttributes = {}) {
  return createSvgElement(["svg", { ...defaultAttributes, ...customAttributes }, iconNode]);
}

const ArrowRight = [
  ["path", { d: "M5 12h14" }],
  ["path", { d: "m12 5 7 7-7 7" }]
];

const ArrowUp = [
  ["path", { d: "m5 12 7-7 7 7" }],
  ["path", { d: "M12 19V5" }]
];

const ArrowUpRight = [
  ["path", { d: "M7 7h10v10" }],
  ["path", { d: "M7 17 17 7" }]
];

const Backpack = [
  ["path", { d: "M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" }],
  ["path", { d: "M8 10h8" }],
  ["path", { d: "M8 18h8" }],
  ["path", { d: "M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6" }],
  ["path", { d: "M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" }]
];

const BadgeCheck = [
  [
    "path",
    {
      d: "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
    }
  ],
  ["path", { d: "m9 12 2 2 4-4" }]
];

const Barcode = [
  ["path", { d: "M3 5v14" }],
  ["path", { d: "M8 5v14" }],
  ["path", { d: "M12 5v14" }],
  ["path", { d: "M17 5v14" }],
  ["path", { d: "M21 5v14" }]
];

const Box = [
  [
    "path",
    {
      d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
    }
  ],
  ["path", { d: "m3.3 7 8.7 5 8.7-5" }],
  ["path", { d: "M12 22V12" }]
];

const Boxes = [
  [
    "path",
    {
      d: "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"
    }
  ],
  ["path", { d: "m7 16.5-4.74-2.85" }],
  ["path", { d: "m7 16.5 5-3" }],
  ["path", { d: "M7 16.5v5.17" }],
  [
    "path",
    {
      d: "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"
    }
  ],
  ["path", { d: "m17 16.5-5-3" }],
  ["path", { d: "m17 16.5 4.74-2.85" }],
  ["path", { d: "M17 16.5v5.17" }],
  [
    "path",
    {
      d: "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"
    }
  ],
  ["path", { d: "M12 8 7.26 5.15" }],
  ["path", { d: "m12 8 4.74-2.85" }],
  ["path", { d: "M12 13.5V8" }]
];

const Camera = [
  [
    "path",
    {
      d: "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"
    }
  ],
  ["circle", { cx: "12", cy: "13", r: "3" }]
];

const Check = [["path", { d: "M20 6 9 17l-5-5" }]];

const ChevronLeft = [["path", { d: "m15 18-6-6 6-6" }]];
const ChevronRight = [["path", { d: "m9 18 6-6-6-6" }]];

const Cuboid = [
  ["path", { d: "M10 22v-8" }],
  ["path", { d: "M2.336 8.89 10 14l11.715-7.029" }],
  [
    "path",
    {
      d: "M22 14a2 2 0 0 1-.971 1.715l-10 6a2 2 0 0 1-2.138-.05l-6-4A2 2 0 0 1 2 16v-6a2 2 0 0 1 .971-1.715l10-6a2 2 0 0 1 2.138.05l6 4A2 2 0 0 1 22 8z"
    }
  ]
];

const Dumbbell = [
  [
    "path",
    {
      d: "M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"
    }
  ],
  ["path", { d: "m2.5 21.5 1.4-1.4" }],
  ["path", { d: "m20.1 3.9 1.4-1.4" }],
  [
    "path",
    {
      d: "M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"
    }
  ],
  ["path", { d: "m9.6 14.4 4.8-4.8" }]
];

const House = [
  ["path", { d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" }],
  [
    "path",
    {
      d: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
    }
  ]
];

const History = [
  ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
  ["path", { d: "M3 3v5h5" }],
  ["path", { d: "M12 7v5l4 2" }]
];

const Info = [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["path", { d: "M12 16v-4" }],
  ["path", { d: "M12 8h.01" }]
];

const ListChecks = [
  ["path", { d: "M13 5h8" }],
  ["path", { d: "M13 12h8" }],
  ["path", { d: "M13 19h8" }],
  ["path", { d: "m3 17 2 2 4-4" }],
  ["path", { d: "m3 7 2 2 4-4" }]
];

const Luggage = [
  ["path", { d: "M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2" }],
  ["path", { d: "M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14" }],
  ["path", { d: "M10 20h4" }],
  ["circle", { cx: "16", cy: "20", r: "2" }],
  ["circle", { cx: "8", cy: "20", r: "2" }]
];

const MapIcon = [
  [
    "path",
    {
      d: "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"
    }
  ],
  ["path", { d: "M15 5.764v15" }],
  ["path", { d: "M9 3.236v15" }]
];

const MapPin = [
  [
    "path",
    {
      d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
    }
  ],
  ["circle", { cx: "12", cy: "10", r: "3" }]
];

const Menu = [
  ["path", { d: "M4 6h16" }],
  ["path", { d: "M4 12h16" }],
  ["path", { d: "M4 18h16" }]
];

const Maximize2 = [
  ["path", { d: "M15 3h6v6" }],
  ["path", { d: "m21 3-7 7" }],
  ["path", { d: "m3 21 7-7" }],
  ["path", { d: "M9 21H3v-6" }]
];

const PackageSearch = [
  ["path", { d: "M12 22V12" }],
  ["path", { d: "M20.27 18.27 22 20" }],
  [
    "path",
    {
      d: "M21 10.498V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.98-.559"
    }
  ],
  ["path", { d: "M3.29 7 12 12l8.71-5" }],
  ["path", { d: "m7.5 4.27 8.997 5.148" }],
  ["circle", { cx: "18.5", cy: "16.5", r: "2.5" }]
];

const Package = [
  [
    "path",
    {
      d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"
    }
  ],
  ["path", { d: "M12 22V12" }],
  ["polyline", { points: "3.29 7 12 12 20.71 7" }],
  ["path", { d: "m7.5 4.27 9 5.15" }]
];

const PanelsTopLeft = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ["path", { d: "M3 9h18" }],
  ["path", { d: "M9 21V9" }]
];

const Plus = [
  ["path", { d: "M5 12h14" }],
  ["path", { d: "M12 5v14" }]
];

const Route = [
  ["circle", { cx: "6", cy: "19", r: "3" }],
  ["path", { d: "M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" }],
  ["circle", { cx: "18", cy: "5", r: "3" }]
];

const Rows3 = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ["path", { d: "M21 9H3" }],
  ["path", { d: "M21 15H3" }]
];

const Ruler = [
  [
    "path",
    {
      d: "M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"
    }
  ],
  ["path", { d: "m14.5 12.5 2-2" }],
  ["path", { d: "m11.5 9.5 2-2" }],
  ["path", { d: "m8.5 6.5 2-2" }],
  ["path", { d: "m17.5 15.5 2-2" }]
];

const ScanLine = [
  ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
  ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
  ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
  ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
  ["path", { d: "M7 12h10" }]
];

const ScanSearch = [
  ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
  ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
  ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
  ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
  ["circle", { cx: "12", cy: "12", r: "3" }],
  ["path", { d: "m16 16-1.9-1.9" }]
];

const Search = [
  ["path", { d: "m21 21-4.34-4.34" }],
  ["circle", { cx: "11", cy: "11", r: "8" }]
];

const ShieldCheck = [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
    }
  ],
  ["path", { d: "m9 12 2 2 4-4" }]
];

const Sparkles = [
  [
    "path",
    {
      d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"
    }
  ],
  ["path", { d: "M20 2v4" }],
  ["path", { d: "M22 4h-4" }],
  ["circle", { cx: "4", cy: "20", r: "2" }]
];

const Truck = [
  ["path", { d: "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" }],
  ["path", { d: "M15 18H9" }],
  [
    "path",
    { d: "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" }
  ],
  ["circle", { cx: "17", cy: "18", r: "2" }],
  ["circle", { cx: "7", cy: "18", r: "2" }]
];

const WandSparkles = [
  [
    "path",
    {
      d: "m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"
    }
  ],
  ["path", { d: "m14 7 3 3" }],
  ["path", { d: "M5 6v4" }],
  ["path", { d: "M19 14v4" }],
  ["path", { d: "M10 2v2" }],
  ["path", { d: "M7 8H3" }],
  ["path", { d: "M21 16h-4" }],
  ["path", { d: "M11 3H9" }]
];

const X = [
  ["path", { d: "M18 6 6 18" }],
  ["path", { d: "m6 6 12 12" }]
];

const icons = {
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "arrow-up-right": ArrowUpRight,
  backpack: Backpack,
  "badge-check": BadgeCheck,
  barcode: Barcode,
  box: Box,
  boxes: Boxes,
  camera: Camera,
  check: Check,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-help": Info,
  cuboid: Cuboid,
  dumbbell: Dumbbell,
  house: House,
  history: History,
  info: Info,
  "list-checks": ListChecks,
  luggage: Luggage,
  map: MapIcon,
  "map-pin": MapPin,
  menu: Menu,
  "maximize-2": Maximize2,
  "package-search": PackageSearch,
  package: Package,
  "panels-top-left": PanelsTopLeft,
  plus: Plus,
  route: Route,
  "rows-3": Rows3,
  ruler: Ruler,
  "scan-line": ScanLine,
  "scan-search": ScanSearch,
  search: Search,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  truck: Truck,
  "wand-sparkles": WandSparkles,
  x: X
};

const iconTemplates = new Map();

function iconElement(name) {
  let template = iconTemplates.get(name);
  if (!template) {
    const known = Object.hasOwn(icons, name);
    const icon = icons[name] ?? Info;
    template = createElement(icon, {
      "data-lucide": name,
      ...(known ? {} : { "data-lucide-fallback": "true" }),
      class: `lucide lucide-${name}`,
      "stroke-width": "1.8",
      "aria-hidden": "true"
    });
    iconTemplates.set(name, template);
  }
  return template.cloneNode(true);
}

export function decorateIcons(root = document) {
  root.querySelectorAll("i[data-lucide]").forEach((placeholder) => {
    const name = placeholder.getAttribute("data-lucide");
    placeholder.replaceWith(iconElement(name ?? "info"));
  });
}
