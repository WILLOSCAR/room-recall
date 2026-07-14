# RoomRecall Scan Algorithm Options

This note records the current scan strategy for the prototype. RoomRecall should start as a proposal-first spatial memory system, not as a high-fidelity reconstruction product. Last reviewed against primary project documentation: 2026-07-13.

## Product Contract

Scanning should produce reviewable facts:

1. Capture room, furniture, container, or item media.
2. Run local preflight for blur, coverage, privacy, and known-size anchors.
3. Produce observations, not canonical truth.
4. Convert observations into typed proposals.
5. Resolve identity as `match existing`, `create new`, or `merge`.
6. Commit accepted proposals through an atomic ledger entry.

The model layer may improve geometry, but the user-visible contract remains proposal review and commit.

## Candidate Routes

### Marker-Assisted Visual Capture

Use known sizes, printed markers, product dimensions, or simple manual measurements to recover metric scale. OpenCV ArUco markers are a practical reference because marker pose estimation uses a known marker side length, and translation vectors share that metric unit.

Good for:

- P0/P1 local-first scans.
- Desk, drawer, shelf, and furniture dimension correction.
- Cheap metric scale without requiring a large model.

Risk:

- Less automatic than dense reconstruction.
- User may need to place a marker or provide a known measurement.

### Sparse SLAM or Phone VIO

Use a phone sweep to recover camera motion, room envelope, and approximate furniture anchors. This is the likely default upgrade after marker-assisted capture.

Good for:

- Room-level layout draft.
- Door, window, wall, and large furniture outline proposals.

Risk:

- Texture, motion blur, mirrors, and narrow rooms can degrade quality.
- Still does not solve item identity or drawer/container semantics by itself.

### Feed-Forward 3D Reconstruction (Research Track)

VGGT-style systems can infer camera parameters, depth maps, point maps, and tracks from one or many views on suitable hardware. MASt3R and SLAM3R point toward stronger monocular/dense reconstruction workflows.

Good for:

- Batch geometry refinement when the user wants a better room model.
- Turning a scan session into a denser point cloud draft.

Risk:

- Not a tiny in-browser default route today.
- Strong geometry does not automatically decide whether a candidate is an existing item, a duplicate, or a container-only placement.

### Scene Parsing From Point Clouds

SpatialLM-style parsing can turn point clouds into walls, doors, windows, oriented object boxes, and semantic categories.

Good for:

- Converting reconstruction output into a Place Graph draft.
- Finding walls, openings, furniture boxes, and coarse object categories.

Risk:

- Depends on point cloud quality.
- Needs privacy redaction and user review before commit.

## Prototype Decision

The current prototype should show four pipeline options:

- `marker-assisted`: local, low-compute, best P0/P1 default.
- `sparse-slam`: phone sweep layout draft.
- `feed-forward-3d`: heavier geometry refinement job.
- `scene-parser`: convert point cloud output into structured Place Graph proposals.

The default product route is marker-assisted capture plus proposal review. Heavy reconstruction is an escalation path, not the core source of truth.

## 2026 Production Recommendation

Separate the practical baseline from research experiments:

- **Browser / PWA**: capture, blur and coverage preflight, ArUco or known-size scale, lightweight detection/segmentation, upload, and 2D/3D proposal review.
- **Backend geometry baseline**: keyframe extraction + COLMAP reconstruction + Metric3D metric-depth prior, followed by floor/wall fitting and coarse furniture cuboids.
- **Small depth fallback**: Depth Anything V2 Small where relative depth is enough; larger checkpoints need a separate license review.
- **Research-only comparison lane**: VGGT, MASt3R, SLAM3R, and VGGT-Omega. Do not make the product depend on them until GPU cost, commercial licensing, and failure behavior are accepted.
- **Optional iOS object sidecar**: Apple Object Capture for a few important individual objects. Apple RoomPlan is a strong room-envelope shortcut only if the product relaxes the visual-only requirement and accepts LiDAR-capable devices.

The honest prototype boundary is unchanged: browser capture and review are real; the current V2 room reconstruction result is deterministic sample data. A first real-CV spike should output only a room envelope, scale confidence, and 5–10 large furniture proposals.

## Sources Checked

- COLMAP: https://colmap.github.io/
- Metric3D: https://github.com/YvanYin/Metric3D
- Depth Anything V2: https://github.com/DepthAnything/Depth-Anything-V2
- OpenCV ArUco marker detection: https://docs.opencv.org/4.x/d5/dae/tutorial_aruco_detection.html
- MediaPipe Object Detector for Web: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js
- ONNX Runtime Web: https://onnxruntime.ai/docs/tutorials/web/
- Apple Object Capture: https://developer.apple.com/videos/play/wwdc2023/10191/
- Apple RoomPlan: https://developer.apple.com/augmented-reality/roomplan/
- VGGT: https://github.com/facebookresearch/vggt
- MASt3R: https://github.com/naver/mast3r
- SLAM3R: https://github.com/pku-vcl-3dv/slam3r
- SpatialLM: https://github.com/manycore-research/SpatialLM
