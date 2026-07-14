// Nestory V2 seed data: catalog + seed records.
// The catalog describes the home; all placements, states, proposals, and
// history live in append-only records built by buildSeedRecords(now).

import type {
  AnyRecord, Catalog, CommitOp, ContainerKind, EvidenceKind, ObservationRecord, PlaceRef, Relation
} from "./types.ts";

const DAY = 24 * 60 * 60 * 1000;

export const catalog: Catalog = {
  rooms: [
    { id: "bedroom", name: "Bedroom", plan: { x: 0.0, y: 0.0, w: 4.2, h: 3.6 } },
    { id: "bathroom", name: "Bathroom", plan: { x: 4.4, y: 0.0, w: 2.0, h: 1.7 } },
    { id: "entryway", name: "Entryway", plan: { x: 4.4, y: 1.9, w: 2.0, h: 1.7 } }
  ],

  furniture: [
    { id: "bed", name: "Bed", room: "bedroom", plan: { x: 0.2, y: 1.9, w: 2.0, h: 1.5 } },
    { id: "wardrobe", name: "Wardrobe", room: "bedroom", plan: { x: 0.2, y: 0.15, w: 1.7, h: 0.6 } },
    { id: "desk", name: "Desk", room: "bedroom", plan: { x: 2.6, y: 0.15, w: 1.4, h: 0.7 } },
    { id: "storage-shelf", name: "Storage shelf", room: "bedroom", plan: { x: 3.7, y: 1.2, w: 0.4, h: 1.0 } },
    { id: "bedside-table", name: "Bedside table", room: "bedroom", plan: { x: 2.3, y: 2.9, w: 0.5, h: 0.5 } },
    { id: "shoe-rack", name: "Shoe rack", room: "entryway", plan: { x: 4.55, y: 3.15, w: 1.3, h: 0.32 } },
    { id: "bathroom-shelf", name: "Bathroom shelf", room: "bathroom", plan: { x: 4.55, y: 0.15, w: 1.3, h: 0.32 } }
  ],

  containers: [
    { id: "wardrobe-top-drawer", name: "Wardrobe top drawer", kind: "drawer", parent: { type: "furniture", id: "wardrobe" } },
    { id: "wardrobe-second-drawer", name: "Wardrobe second drawer", kind: "drawer", parent: { type: "furniture", id: "wardrobe" } },
    { id: "wardrobe-rail", name: "Wardrobe hanging rail", kind: "shelf", parent: { type: "furniture", id: "wardrobe" } },
    { id: "desk-drawer", name: "Desk drawer", kind: "drawer", parent: { type: "furniture", id: "desk" } },
    { id: "desk-top", name: "Desk top", kind: "surface", parent: { type: "furniture", id: "desk" } },
    { id: "shelf-middle-basket", name: "Shelf middle basket", kind: "basket", parent: { type: "furniture", id: "storage-shelf" } },
    { id: "backpack", name: "Backpack", kind: "bag", parent: { type: "furniture", id: "desk" } },
    { id: "suitcase", name: "Suitcase", kind: "suitcase", parent: { type: "furniture", id: "bed" }, note: "under the bed" },
    { id: "entry-tray", name: "Entry tray", kind: "tray", parent: { type: "furniture", id: "shoe-rack" } },
    { id: "shoe-rack-bottom", name: "Shoe rack bottom level", kind: "shelf", parent: { type: "furniture", id: "shoe-rack" } },
    { id: "bathroom-basket", name: "Bathroom middle basket", kind: "basket", parent: { type: "furniture", id: "bathroom-shelf" } },
    { id: "bedside-drawer", name: "Bedside drawer", kind: "drawer", parent: { type: "furniture", id: "bedside-table" } }
  ],

  belongings: [
    { id: "black-training-shirt", name: "Black training shirt", kinds: ["training-shirt", "sports-top", "clothing"], importance: "normal", defaultHome: { type: "container", id: "wardrobe-second-drawer" } },
    { id: "training-shorts", name: "Training shorts", kinds: ["training-shorts", "clothing"], importance: "normal", defaultHome: { type: "container", id: "wardrobe-second-drawer" } },
    { id: "sport-socks", name: "Sport socks", kinds: ["sport-socks", "clothing"], group: true, importance: "normal", defaultHome: { type: "container", id: "wardrobe-top-drawer" } },
    { id: "gym-shoes", name: "Gym shoes", kinds: ["gym-shoes", "shoes"], importance: "normal", defaultHome: { type: "container", id: "shoe-rack-bottom" } },
    { id: "small-towel", name: "Small towel", kinds: ["towel"], importance: "normal", defaultHome: { type: "container", id: "bathroom-basket" } },
    { id: "large-towel", name: "Large towel", kinds: ["towel"], importance: "normal", defaultHome: { type: "container", id: "bathroom-basket" } },
    { id: "water-bottle", name: "Water bottle", kinds: ["water-bottle"], importance: "normal", defaultHome: { type: "container", id: "desk-top" } },
    { id: "earphones", name: "Earphones", kinds: ["earphones", "electronics"], importance: "high", defaultHome: { type: "container", id: "backpack" } },
    { id: "resistance-band", name: "Resistance band", kinds: ["resistance-band", "gym-gear"], importance: "normal", defaultHome: { type: "container", id: "shelf-middle-basket" } },
    { id: "gym-card", name: "Gym card", kinds: ["gym-card", "card"], importance: "high", defaultHome: { type: "container", id: "backpack" } },
    { id: "laundry-bag", name: "Laundry bag", kinds: ["laundry-bag"], importance: "normal", defaultHome: { type: "container", id: "wardrobe-rail" } },
    { id: "passport", name: "Passport", kinds: ["passport", "document"], importance: "essential", defaultHome: { type: "container", id: "bedside-drawer" } },
    { id: "usb-c-charger", name: "USB-C charger", kinds: ["charger", "electronics"], importance: "essential", defaultHome: { type: "container", id: "desk-drawer" } },
    { id: "travel-adapter", name: "Travel adapter", kinds: ["travel-adapter", "electronics"], importance: "normal", defaultHome: { type: "container", id: "desk-drawer" } },
    { id: "toiletries-bag", name: "Toiletries bag", kinds: ["toiletries"], importance: "normal", defaultHome: { type: "container", id: "bathroom-basket" } },
    { id: "medicine-kit", name: "Medicine kit", kinds: ["medicine"], importance: "essential", defaultHome: { type: "container", id: "bedside-drawer" } },
    { id: "winter-jacket", name: "Winter jacket", kinds: ["jacket", "clothing"], importance: "normal", defaultHome: { type: "container", id: "wardrobe-rail" } },
    { id: "desk-lamp", name: "Desk lamp", kinds: ["lamp", "electronics"], importance: "normal", defaultHome: { type: "container", id: "desk-top" } },
    { id: "paperbacks", name: "Paperback books", kinds: ["books"], group: true, importance: "normal", defaultHome: { type: "container", id: "shelf-middle-basket" } },
    { id: "power-strip", name: "Power strip", kinds: ["power-strip", "electronics"], importance: "normal", defaultHome: { type: "container", id: "desk-drawer" } },
    { id: "training-tee", name: "Training tee", kinds: ["training-shirt", "clothing"], importance: "normal", defaultHome: { type: "container", id: "wardrobe-second-drawer" }, note: "possible duplicate of Black training shirt" }
  ],

  kits: [
    {
      id: "fitness",
      name: "Fitness kit",
      requirements: [
        { id: "req-sports-shirt", label: "Sports shirt", kindsAny: ["sports-top"], level: "required" },
        { id: "req-training-shirt", label: "Training shirt", kindsAny: ["training-shirt"], level: "required" },
        { id: "req-shorts", label: "Training shorts", kindsAny: ["training-shorts"], level: "required" },
        { id: "req-socks", label: "Sport socks", kindsAny: ["sport-socks"], level: "required" },
        { id: "req-shoes", label: "Gym shoes", kindsAny: ["gym-shoes"], level: "required" },
        { id: "req-towel", label: "Towel", kindsAny: ["towel"], level: "required", substituteGroup: true },
        { id: "req-bottle", label: "Water bottle", kindsAny: ["water-bottle"], level: "required" },
        { id: "req-earphones", label: "Earphones", kindsAny: ["earphones"], level: "optional" },
        { id: "req-band", label: "Resistance band", kindsAny: ["resistance-band"], level: "optional" },
        { id: "req-gym-card", label: "Gym card", kindsAny: ["gym-card"], level: "required" },
        { id: "req-laundry", label: "Laundry bag", kindsAny: ["laundry-bag"], level: "optional" }
      ]
    },
    {
      id: "travel",
      name: "Travel kit",
      requirements: [
        { id: "req-passport", label: "Passport", kindsAny: ["passport"], level: "required" },
        { id: "req-charger", label: "Charger", kindsAny: ["charger"], level: "required" },
        { id: "req-adapter", label: "Travel adapter", kindsAny: ["travel-adapter"], level: "optional" },
        { id: "req-toiletries", label: "Toiletries bag", kindsAny: ["toiletries"], level: "required" },
        { id: "req-travel-earphones", label: "Earphones", kindsAny: ["earphones"], level: "optional" },
        { id: "req-travel-bottle", label: "Water bottle", kindsAny: ["water-bottle"], level: "optional" },
        { id: "req-medicine", label: "Medicine kit", kindsAny: ["medicine"], level: "required" },
        { id: "req-travel-towel", label: "Towel", kindsAny: ["towel"], level: "optional", substituteGroup: true }
      ]
    }
  ],

  operationTemplates: [
    { id: "move", name: "Move", type: "move", description: "Pack boxes, track them, restore the new home." },
    { id: "gym", name: "Gym", type: "kit", kitId: "fitness", description: "Prepare the fitness kit." },
    { id: "travel", name: "Travel", type: "kit", kitId: "travel", description: "Pack for a trip." },
    { id: "cleaning", name: "Cleaning", type: "kit", kitId: null, description: "Reset a space (placeholder checklist in V1)." }
  ]
};

// Seed records: append-only history that the store folds into current state.
export function buildSeedRecords(now: number): AnyRecord[] {
  const at = (daysAgo: number, hours = 0): string => new Date(now - daysAgo * DAY - hours * 3600 * 1000).toISOString();
  const records: AnyRecord[] = [];
  let n = 0;
  const rid = (prefix: string): string => `${prefix}-seed-${++n}`;

  const evidence = (kind: EvidenceKind, summary: string, daysAgo: number): string => {
    const id = rid("ev");
    records.push({ recordType: "evidence", id, kind, summary, at: at(daysAgo) });
    return id;
  };

  interface PlaceOpts {
    daysAgo: number;
    confidence?: number;
    relation?: Relation;
    evidenceIds?: string[] | null;
    confirmed?: boolean;
  }

  const place = (itemId: string, placeRef: PlaceRef, { daysAgo, confidence = 0.8, relation = "inside", evidenceIds = null, confirmed = false }: PlaceOpts): void => {
    const evs = evidenceIds ?? [evidence(confirmed ? "user_confirmation" : "seed_import", `${itemId} recorded here`, daysAgo)];
    records.push({
      recordType: "commit",
      id: rid("commit"),
      at: at(daysAgo),
      summary: `Record ${itemId} placement`,
      ops: [{ type: "create_placement", itemId, placeRef, relation, confidence, evidenceIds: evs }]
    });
  };

  // --- Baseline placements (freshness varies to exercise staleness rules) ---
  place("black-training-shirt", { type: "container", id: "wardrobe-second-drawer" }, { daysAgo: 6, confidence: 0.85, confirmed: true });
  place("training-shorts", { type: "container", id: "wardrobe-second-drawer" }, { daysAgo: 6, confidence: 0.85, confirmed: true });
  place("training-tee", { type: "container", id: "wardrobe-second-drawer" }, { daysAgo: 21, confidence: 0.6 });
  place("sport-socks", { type: "container", id: "wardrobe-top-drawer" }, { daysAgo: 41, confidence: 0.7 });
  place("gym-shoes", { type: "container", id: "shoe-rack-bottom" }, { daysAgo: 2, confidence: 0.9, confirmed: true });
  place("small-towel", { type: "container", id: "bathroom-basket" }, { daysAgo: 3, confidence: 0.85 });
  place("large-towel", { type: "container", id: "bathroom-basket" }, { daysAgo: 3, confidence: 0.85 });
  place("water-bottle", { type: "container", id: "desk-top" }, { daysAgo: 1, confidence: 0.88, relation: "on_surface", confirmed: true });
  place("earphones", { type: "container", id: "backpack" }, { daysAgo: 4, confidence: 0.75 });
  place("resistance-band", { type: "container", id: "shelf-middle-basket" }, { daysAgo: 12, confidence: 0.7 });
  place("gym-card", { type: "container", id: "backpack" }, { daysAgo: 9, confidence: 0.65 });
  place("laundry-bag", { type: "container", id: "wardrobe-rail" }, { daysAgo: 5, confidence: 0.8 });
  place("passport", { type: "container", id: "bedside-drawer" }, { daysAgo: 30, confidence: 0.9, confirmed: true });
  place("usb-c-charger", { type: "container", id: "desk-drawer" }, { daysAgo: 2, confidence: 0.85, confirmed: true });
  place("travel-adapter", { type: "container", id: "desk-drawer" }, { daysAgo: 60, confidence: 0.6 });
  place("toiletries-bag", { type: "container", id: "bathroom-basket" }, { daysAgo: 8, confidence: 0.8 });
  place("medicine-kit", { type: "container", id: "bedside-drawer" }, { daysAgo: 15, confidence: 0.85, confirmed: true });
  place("winter-jacket", { type: "container", id: "wardrobe-rail" }, { daysAgo: 90, confidence: 0.75 });
  place("desk-lamp", { type: "container", id: "desk-top" }, { daysAgo: 10, confidence: 0.85, relation: "on_surface" });
  place("paperbacks", { type: "container", id: "shelf-middle-basket" }, { daysAgo: 45, confidence: 0.7 });
  place("power-strip", { type: "container", id: "desk-drawer" }, { daysAgo: 25, confidence: 0.7 });

  // Small towel is in the laundry: substitute-group resolution should pick the large towel.
  records.push({
    recordType: "commit",
    id: rid("commit"),
    at: at(1),
    summary: "Small towel goes to laundry",
    ops: [{ type: "set_state", itemId: "small-towel", state: "laundry" }]
  });

  // --- Container freshness confirmations (wardrobe top drawer left stale on purpose) ---
  const confirmations: Array<[string, number]> = [
    ["wardrobe-second-drawer", 6],
    ["desk-drawer", 2],
    ["desk-top", 1],
    ["bathroom-basket", 3],
    ["shoe-rack-bottom", 2],
    ["backpack", 4],
    ["bedside-drawer", 15],
    ["wardrobe-rail", 5],
    ["entry-tray", 7],
    ["wardrobe-top-drawer", 41],
    ["shelf-middle-basket", 45],
    ["suitcase", 70]
  ];
  for (const [containerId, daysAgo] of confirmations) {
    records.push({
      recordType: "commit",
      id: rid("commit"),
      at: at(daysAgo),
      summary: `Confirm contents of ${containerId}`,
      ops: [{ type: "confirm_container", containerId }]
    });
  }

  // --- Active Move operation with two boxes already packing ---
  records.push({
    recordType: "commit",
    id: rid("commit"),
    at: at(2),
    summary: "Start operation: Move to the new apartment",
    ops: [{
      type: "create_operation",
      operation: { id: "op-move-1", type: "move", name: "Move to the new apartment", startedAt: at(2), status: "active" }
    }]
  });
  records.push({
    recordType: "commit",
    id: rid("commit"),
    at: at(2),
    summary: "Create box: Essentials first night",
    ops: [{
      type: "create_container",
      container: {
        id: "box-essentials",
        name: "Box 1 · Essentials first night",
        kind: "box",
        parent: { type: "room", id: "bedroom" },
        box: { label: "Essentials first night", destination: "New home · bedroom", operationId: "op-move-1" }
      }
    }, { type: "set_box_status", boxId: "box-essentials", status: "packing" }]
  });
  records.push({
    recordType: "commit",
    id: rid("commit"),
    at: at(2),
    summary: "Create box: Books and desk",
    ops: [{
      type: "create_container",
      container: {
        id: "box-books",
        name: "Box 2 · Books and desk",
        kind: "box",
        parent: { type: "room", id: "bedroom" },
        box: { label: "Books and desk", destination: "New home · study corner", operationId: "op-move-1" }
      }
    }, { type: "set_box_status", boxId: "box-books", status: "packing" }]
  });

  // Winter jacket already packed into the essentials box.
  const jacketEv = evidence("user_confirmation", "Packed winter jacket into Box 1", 1);
  records.push({
    recordType: "commit",
    id: rid("commit"),
    at: at(1),
    summary: "Pack winter jacket into Box 1",
    ops: [
      { type: "contradict_placement", itemId: "winter-jacket", reason: "packed_into_box", evidenceIds: [jacketEv] },
      { type: "create_placement", itemId: "winter-jacket", placeRef: { type: "container", id: "box-essentials" }, relation: "inside", confidence: 0.95, evidenceIds: [jacketEv] },
      { type: "set_state", itemId: "winter-jacket", state: "packed" }
    ]
  });
  // Paperbacks packed into the books box.
  const booksEv = evidence("user_confirmation", "Packed paperbacks into Box 2", 1);
  records.push({
    recordType: "commit",
    id: rid("commit"),
    at: at(1),
    summary: "Pack paperbacks into Box 2",
    ops: [
      { type: "contradict_placement", itemId: "paperbacks", reason: "packed_into_box", evidenceIds: [booksEv] },
      { type: "create_placement", itemId: "paperbacks", placeRef: { type: "container", id: "box-books" }, relation: "inside", confidence: 0.95, evidenceIds: [booksEv] },
      { type: "set_state", itemId: "paperbacks", state: "packed" }
    ]
  });

  // --- Pending review inbox seeds ---
  // 1) A snapshot of the entry tray claims the gym card is there (recorded home: backpack).
  const snapObs: ObservationRecord = {
    recordType: "observation", id: "obs-entry-tray-snapshot", type: "container_snapshot",
    at: at(0, 5), containerId: "entry-tray", payload: { seenText: "keys, gym card, coins" }
  };
  records.push(snapObs);
  const gymCardOps: CommitOp[] = [
    { type: "contradict_placement", itemId: "gym-card", reason: "seen_elsewhere" },
    { type: "create_placement", itemId: "gym-card", placeRef: { type: "container", id: "entry-tray" }, relation: "inside", confidence: 0.7 }
  ];
  records.push({
    recordType: "proposal",
    id: "proposal-gym-card-move",
    type: "placement_correction",
    at: at(0, 5),
    sourceObservationIds: [snapObs.id],
    summary: "Snapshot of Entry tray suggests the gym card is there, not in the backpack.",
    suggestedOps: gymCardOps
  });
  // 2) Duplicate suspicion: training tee vs black training shirt.
  const dupObs: ObservationRecord = {
    recordType: "observation", id: "obs-duplicate-training-tee", type: "duplicate_suspected",
    at: at(3), payload: { itemIds: ["training-tee", "black-training-shirt"] }
  };
  records.push(dupObs);
  records.push({
    recordType: "proposal",
    id: "proposal-merge-training-tee",
    type: "duplicate_merge",
    at: at(3),
    sourceObservationIds: [dupObs.id],
    summary: "“Training tee” looks like a duplicate of “Black training shirt”.",
    suggestedOps: [{ type: "merge_belongings", keepId: "black-training-shirt", mergeId: "training-tee" }]
  });

  return records;
}

export const seedMeta = {
  staleContainerDays: 30,
  version: "v2-seed-2-ts"
} as const;

// "Own home" mode starts from an empty Place Graph but keeps the generic
// kits and operation templates so operations work from the first session.
export const emptyCatalog: Catalog = {
  rooms: [],
  furniture: [],
  containers: [],
  belongings: [],
  kits: catalog.kits,
  operationTemplates: catalog.operationTemplates
};

// Onboarding quick-add templates (Setup view).
export const ROOM_TEMPLATES: readonly string[] = [
  "Bedroom", "Bathroom", "Kitchen", "Entryway", "Living room", "Storage"
];

export const CONTAINER_KIND_OPTIONS: readonly ContainerKind[] = [
  "drawer", "shelf", "box", "bag", "basket", "suitcase", "surface", "tray"
];
