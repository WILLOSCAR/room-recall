import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const rootUrl = "http://127.0.0.1:8789/";
const renderDir = new URL("./renders/", import.meta.url);
const userDataDir = join(tmpdir(), `room-recall-chrome-${Date.now()}`);
const port = 9237;
const browserEvents = [];

await mkdir(renderDir, { recursive: true });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--enable-unsafe-swiftshader",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-extensions",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  rootUrl
], { stdio: ["ignore", "pipe", "pipe"] });

let closed = false;
chrome.on("close", () => {
  closed = true;
});

try {
  const wsUrl = await waitForWebSocketUrl();
  const cdp = await connectCdp(wsUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Page.navigate", { url: rootUrl });
  await waitForLoad(cdp);
  await waitForDemo(cdp);
  await sleep(2400);

  const desktopBefore = await auditedPage(cdp, "desktop-initial");
  await saveScreenshot(cdp, "room-recall-desktop.png");

  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 460, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 600, y: 460, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 790, y: 445, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 790, y: 445, button: "left", clickCount: 1 });
  await sleep(700);
  const desktopAfterOrbit = await auditedPage(cdp, "desktop-after-orbit");
  await saveScreenshot(cdp, "room-recall-orbit-check.png");

  await evalPage(cdp, `window.roomRecallDemo.locate("water bottle")`);
  await sleep(900);
  const searchAudit = await auditedPage(cdp, "search-water-bottle");
  await saveScreenshot(cdp, "room-recall-search-water-bottle.png");

  const beforeMove = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "water-bottle")`);
  const initialWaterBottle = beforeMove;
  const initialContainerRoundTrip = await evalPage(cdp, `(() => {
    const item = ${JSON.stringify(initialWaterBottle)};
    const container = window.roomRecallDemo.coordinateSnapshot().containerFrames.find((frame) => frame.id === item.coordinate.semanticFrame);
    if (!container || !item.coordinate.local) return null;
    return {
      semanticFrame: item.coordinate.semanticFrame,
      parentId: item.coordinate.parentId,
      reconstructed: {
        x: Number((container.x + item.coordinate.local.x).toFixed(2)),
        z: Number((container.z + item.coordinate.local.z).toFixed(2))
      },
      world: item.coordinate.world,
      size: item.coordinate.containerSize,
      local: item.coordinate.local
    };
  })()`);
  const notThereDraft = await evalPage(cdp, `window.roomRecallDemo.markNotThere("water-bottle")`);
  await sleep(300);
  const contradictedWaterBottle = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "water-bottle")`);
  const notThereBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  await evalPage(cdp, `window.roomRecallDemo.moveItem("water-bottle", -1.2, 1.35)`);
  await sleep(650);
  const afterMove = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "water-bottle")`);
  const movedCoordinate = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "water-bottle").coordinate`);
  const correctedSnapshot = await evalPage(cdp, `window.roomRecallDemo.snapshot().layout.correctionDraft`);
  const correctedBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const correctionCommit = await evalPage(cdp, `window.roomRecallDemo.commitPlacementCorrection("water-bottle")`);
  await evalPage(cdp, `window.roomRecallDemo.locate("water bottle")`);
  await sleep(450);
  const futureLocateWaterBottle = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "water-bottle")`);
  const committedBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  await saveScreenshot(cdp, "room-recall-moved-water-bottle.png");

  await evalPage(cdp, `window.roomRecallDemo.activateKit("fitness")`);
  await sleep(650);
  const kitAudit = await auditedPage(cdp, "fitness-kit");
  await saveScreenshot(cdp, "room-recall-fitness-kit.png");

  await evalPage(cdp, `window.roomRecallDemo.setProjectionMode("plan2d")`);
  await sleep(850);
  const planAudit = await auditedPage(cdp, "plan-2d");
  const panelSections = await evalPage(cdp, `[...document.querySelectorAll(".side-panel .section-title h2")].map((node) => node.textContent.trim())`);
  await saveScreenshot(cdp, "room-recall-plan-2d.png");

  await evalPage(cdp, `window.roomRecallDemo.reviewVisionDraft()`);
  await sleep(650);
  await evalPage(cdp, `window.roomRecallDemo.selectScanPipeline("feed-forward-3d")`);
  await evalPage(cdp, `window.roomRecallDemo.setProposalStatus("proposal-wardrobe-shift", "rejected")`);
  await evalPage(cdp, `window.roomRecallDemo.selectProposal("proposal-nightstand")`);
  const mixedScanDraft = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot()`);
  const backendContract = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const scanPipelineSnapshot = await evalPage(cdp, `window.roomRecallDemo.scanPipelineSnapshot()`);
  const identityProducerDom = await evalPage(cdp, `(() => {
    const node = document.querySelector("[data-identity-producer]");
    return node ? {
      producerId: node.dataset.identityProducer,
      observationCount: Number(node.dataset.identityObservationCount || 0),
      observationTypes: (node.dataset.identityObservationTypes || "").split(",").filter(Boolean),
      text: node.textContent.trim()
    } : null;
  })()`);
  const reconstructionDom = await evalPage(cdp, `(() => {
    const job = document.querySelector("[data-reconstruction-job]");
    const coverage = document.querySelector("[data-keyframe-coverage]");
    return {
      job: job ? {
        id: job.dataset.reconstructionJob,
        route: job.dataset.reconstructionRoute,
        outputPolicy: job.dataset.reconstructionOutputPolicy,
        commitReady: job.dataset.reconstructionCommitReady,
        frameCount: Number(job.dataset.reconstructionFrameCount || 0),
        text: job.textContent.trim()
      } : null,
      coverage: coverage ? {
        coveredCount: Number(coverage.dataset.keyframeCoveredCount || 0),
        totalCount: Number(coverage.dataset.keyframeTotalCount || 0),
        missing: (coverage.dataset.keyframeMissing || "").split(",").filter(Boolean),
        text: coverage.textContent.trim()
      } : null
    };
  })()`);
  const identityProposalDom = await evalPage(cdp, `[...document.querySelectorAll("[data-identity-proposal]")].map((node) => ({
    id: node.dataset.identityProposal,
    observationId: node.dataset.identityObservation,
    type: node.dataset.identityType,
    resolutionRequired: node.dataset.resolutionRequired,
    visibilityState: node.dataset.visibilityState,
    privacyStatus: node.dataset.privacyStatus,
    containerId: node.dataset.containerId,
    regionId: node.dataset.regionId,
    priorCount: Number(node.dataset.priorCount || 0),
    buttonLabels: [...node.querySelectorAll("button")].map((button) => button.textContent.trim()),
    hasAccept: Boolean(node.querySelector("[data-proposal-accept]")),
    hasReject: Boolean(node.querySelector("[data-proposal-reject]")),
    hasCommit: Boolean(node.querySelector("[data-commit], [data-identity-commit], [data-action*='commit']")),
    text: node.textContent.trim()
  }))`);
  const identityReviewFlow = await evalPage(cdp, `(() => {
    const proposalId = "identity-proposal-identity-obs-desk-lamp-candidate";
    const row = document.querySelector(\`[data-identity-proposal="\${proposalId}"]\`);
    const reviewButton = row?.querySelector("[data-identity-review]");
    const geometryStatusesBefore = window.roomRecallDemo.layoutSnapshot().proposals.map((proposal) => [proposal.id, proposal.status]);
    reviewButton?.click();
    const afterReviewLayout = window.roomRecallDemo.layoutSnapshot();
    const afterReviewBackend = window.roomRecallDemo.backendContractSnapshot();
    const actionButton = document.querySelector(\`[data-identity-action="\${proposalId}"][data-identity-action-value="match_existing"]\`);
    actionButton?.click();
    const afterActionLayout = window.roomRecallDemo.layoutSnapshot();
    const afterActionBackend = window.roomRecallDemo.backendContractSnapshot();
    const activeRow = document.querySelector(\`[data-identity-proposal="\${proposalId}"]\`);
    const commitButton = activeRow?.querySelector("[data-identity-commit]");
    const ledgerCountBeforeCommit = afterActionBackend.commitPreview.commitLedgerEntries.length;
    commitButton?.click();
    const afterCommitLayout = window.roomRecallDemo.layoutSnapshot();
    const afterCommitBackend = window.roomRecallDemo.backendContractSnapshot();
    const geometryStatusesAfter = afterActionLayout.proposals.map((proposal) => [proposal.id, proposal.status]);
    const geometryStatusesAfterCommit = afterCommitLayout.proposals.map((proposal) => [proposal.id, proposal.status]);
    return {
      proposalId,
      reviewClicked: Boolean(reviewButton),
      actionClicked: Boolean(actionButton),
      afterReview: {
        selectedIdentityProposalId: afterReviewLayout.selectedIdentityProposalId,
        selectedIdentityObservationId: afterReviewLayout.selectedIdentityObservationId,
        identityCommitOps: afterReviewBackend.commitPreview.identityCommitOps,
        resolutionDrafts: afterReviewBackend.commitPreview.identityResolutionDrafts ?? []
      },
      afterAction: {
        selectedIdentityProposalId: afterActionLayout.selectedIdentityProposalId,
        selectedIdentityObservationId: afterActionLayout.selectedIdentityObservationId,
        resolutionDrafts: afterActionLayout.identityResolutionDrafts,
        backendResolutionDrafts: afterActionBackend.commitPreview.identityResolutionDrafts ?? [],
        identityCommitOps: afterActionBackend.commitPreview.identityCommitOps,
        proposalRecord: afterActionBackend.mutationBundle.identityProposalRecords.find((proposal) => proposal.id === proposalId),
        activeRow: activeRow ? {
          active: activeRow.classList.contains("is-active"),
          resolutionAction: activeRow.dataset.resolutionAction,
          resolutionStatus: activeRow.dataset.resolutionStatus,
          buttonLabels: [...activeRow.querySelectorAll("button")].map((button) => button.textContent.trim()),
          hasAccept: Boolean(activeRow.querySelector("[data-proposal-accept]")),
          hasReject: Boolean(activeRow.querySelector("[data-proposal-reject]")),
          hasCommit: Boolean(activeRow.querySelector("[data-commit], [data-identity-commit], [data-action*='commit']"))
        } : null
      },
      commitClicked: Boolean(commitButton),
      afterCommit: {
        selectedIdentityProposalId: afterCommitLayout.selectedIdentityProposalId,
        selectedIdentityObservationId: afterCommitLayout.selectedIdentityObservationId,
        resolutionDrafts: afterCommitLayout.identityResolutionDrafts,
        backendResolutionDrafts: afterCommitBackend.commitPreview.identityResolutionDrafts ?? [],
        identityCommitOps: afterCommitBackend.commitPreview.identityCommitOps,
        commitLedgerEntries: afterCommitBackend.commitPreview.commitLedgerEntries,
        proposalRecord: afterCommitBackend.mutationBundle.identityProposalRecords.find((proposal) => proposal.id === proposalId),
        geometryOps: afterCommitBackend.mutationBundle.draftOps.geometryOps,
        placementOps: afterCommitBackend.mutationBundle.draftOps.placementOps
      },
      ledgerCountBeforeCommit,
      geometryStatusesBefore,
      geometryStatusesAfter,
      geometryStatusesAfterCommit
    };
  })()`);
  const scan3dAudit = await auditedPage(cdp, "scan-proposals-3d");
  await saveScreenshot(cdp, "room-recall-scan-3d.png");
  await evalPage(cdp, `window.roomRecallDemo.setProjectionMode("plan2d")`);
  await sleep(450);
  const scanPlanOverlayCount = await evalPage(cdp, `document.querySelectorAll("[data-plan-proposal]").length`);
  const scanPlanDom = await evalPage(cdp, `({
    anchors: document.querySelectorAll(".plan-anchor").length,
    envelopes: document.querySelectorAll(".plan-envelope").length,
    unknownRegions: document.querySelectorAll(".plan-unknown").length,
    furnitureBlocks: document.querySelectorAll("[data-layout-furniture]").length,
    envelopeLabels: [...document.querySelectorAll(".plan-envelope")].map((node) => node.textContent.trim()),
    proposalLabels: [...document.querySelectorAll("[data-plan-proposal]")].map((node) => node.textContent.trim())
  })`);
  await saveScreenshot(cdp, "room-recall-scan-plan-overlays.png");
  await evalPage(cdp, `window.roomRecallDemo.selectFurniture("desk")`);
  const scanDraftBeforeCommit = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot()`);
  await evalPage(cdp, `window.roomRecallDemo.acceptAllProposals()`);
  await evalPage(cdp, `window.roomRecallDemo.commitScanProposals()`);
  const scanDraftAfterCommit = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot()`);
  const supportSurfaces = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot().supportSurfaces`);
  await evalPage(cdp, `window.roomRecallDemo.setProjectionMode("cutaway3d")`);
  await sleep(350);
  await evalPage(cdp, `window.roomRecallDemo.clearFocus()`);
  const beforeHoverEarphones = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "earphones")`);
  const precheckCountBeforeHover = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot().placementPrechecks.length`);
  const hoverSupportSurface = await evalPage(cdp, `window.roomRecallDemo.hoverSupportSurface("surface-desk-top", "earphones")`);
  const hoverSnapshot = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot()`);
  const hoverDom = await evalPage(cdp, `(() => {
    const chip = document.querySelector(".surface-hover-label");
    const stage = document.querySelector(".stage");
    return {
      chip: chip ? {
        surfaceId: chip.dataset.hoveredSurface,
        ownerId: chip.dataset.owner,
        containerId: chip.dataset.container,
        relation: chip.dataset.relation,
        status: chip.dataset.hoverStatus,
        candidate: chip.dataset.hoverCandidate,
        visible: chip.classList.contains("is-visible"),
        text: chip.textContent.trim()
      } : null,
      stage: stage ? {
        hoverSurfaceId: stage.dataset.hoverSurfaceId,
        selectedSurfaceId: stage.dataset.selectedSurfaceId ?? null,
        surfaceParent: stage.dataset.surfaceParent,
        surfaceRelation: stage.dataset.surfaceRelation
      } : null
    };
  })()`);
  const afterHoverEarphones = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "earphones")`);
  const precheckCountAfterHover = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot().placementPrechecks.length`);
  const clearedHover = await evalPage(cdp, `(() => {
    window.roomRecallDemo.clearSurfaceHover();
    return window.roomRecallDemo.layoutSnapshot();
  })()`);
  const clearedHoverDom = await evalPage(cdp, `(() => {
    const chip = document.querySelector(".surface-hover-label");
    const stage = document.querySelector(".stage");
    return {
      chipVisible: chip?.classList.contains("is-visible") ?? false,
      chipSurfaceId: chip?.dataset.hoveredSurface ?? null,
      stageHoverSurfaceId: stage?.dataset.hoverSurfaceId ?? null
    };
  })()`);
  const selectedSupportSurface = await evalPage(cdp, `window.roomRecallDemo.selectSupportSurface("surface-desk-top")`);
  const beforeReadyDragEarphones = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "earphones")`);
  const readyDragPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragOnSurface("earphones", "surface-desk-top")`);
  const readyDragSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const readyDragBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const readyDragBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  const afterReadyDragEarphones = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "earphones")`);
  await evalPage(cdp, `window.roomRecallDemo.clearDragPreview()`);
  await evalPage(cdp, `window.roomRecallDemo.setProjectionMode("plan2d")`);
  const planReadyDragPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragOnSurface("earphones", "surface-desk-top")`);
  const planReadyDragSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  await evalPage(cdp, `window.roomRecallDemo.clearDragPreview()`);
  await evalPage(cdp, `window.roomRecallDemo.setProjectionMode("cutaway3d")`);
  const allowedSupportPrecheck = await evalPage(cdp, `window.roomRecallDemo.supportPlacementPrecheck("earphones", "surface-desk-top")`);
  const supportReadyPrecheckDom = await evalPage(cdp, `[...document.querySelectorAll("[data-surface-precheck]")].map((node) => ({
    id: node.dataset.surfacePrecheck,
    status: node.dataset.precheckStatus,
    rawStatus: node.dataset.precheckRawStatus,
    reason: node.dataset.precheckReason,
    previousStatus: node.dataset.precheckPreviousStatus,
    uiSource: node.dataset.precheckUiSource,
    poseSource: node.dataset.supportPoseSource,
    poseSnapped: node.dataset.supportPoseSnapped,
    poseLocalX: Number(node.dataset.supportPoseLocalX || 0),
    poseLocalZ: Number(node.dataset.supportPoseLocalZ || 0),
    text: node.textContent.trim()
  }))`);
  const afterAllowedPrecheck = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "earphones")`);
  const supportBackendAfterAllowedPrecheck = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const supportReadyBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  const supportPlacement = await evalPage(cdp, `window.roomRecallDemo.confirmSupportPlacement("earphones", "surface-desk-top", ${JSON.stringify(allowedSupportPrecheck.id)})`);
  const afterSupportPlacement = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "earphones")`);
  await evalPage(cdp, `window.roomRecallDemo.selectSupportSurface("surface-desk-top")`);
  const supportConfirmedPrecheckDom = await evalPage(cdp, `[...document.querySelectorAll("[data-surface-precheck]")].map((node) => ({
    id: node.dataset.surfacePrecheck,
    status: node.dataset.precheckStatus,
    rawStatus: node.dataset.precheckRawStatus,
    reason: node.dataset.precheckReason,
    previousStatus: node.dataset.precheckPreviousStatus,
    uiSource: node.dataset.precheckUiSource,
    poseSource: node.dataset.supportPoseSource,
    poseSnapped: node.dataset.supportPoseSnapped,
    poseLocalX: Number(node.dataset.supportPoseLocalX || 0),
    poseLocalZ: Number(node.dataset.supportPoseLocalZ || 0),
    text: node.textContent.trim()
  }))`);
  const supportConfirmedBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  const beforeCollisionCharger = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "charger")`);
  const manualChargerPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragOnSurfaceAt("charger", "surface-desk-top", -0.45, 0)`);
  const manualChargerSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const manualChargerBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const afterManualChargerPreview = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "charger")`);
  await evalPage(cdp, `window.roomRecallDemo.clearDragPreview()`);
  const manualBlockedChargerPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragOnSurfaceAt("charger", "surface-desk-top", 0, 0)`);
  const manualBlockedChargerSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const manualBlockedChargerBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  await evalPage(cdp, `window.roomRecallDemo.clearDragPreview()`);
  await evalPage(cdp, `window.roomRecallDemo.setProjectionMode("plan2d")`);
  const planManualChargerPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragOnSurfaceAt("charger", "surface-desk-top", -0.45, 0)`);
  const planManualChargerSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const beforePatchHandleCharger = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "charger")`);
  const beforePatchHandlePrecheckCount = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot().placementPrechecks.length`);
  const patchHandleDragPoints = await evalPage(cdp, `(() => {
    const handle = document.querySelector("[data-plan-patch-handle]");
    const board = document.querySelector(".plan-board");
    const surface = window.roomRecallDemo.layoutSnapshot().supportSurfaces.find((entry) => entry.id === "surface-desk-top");
    if (!handle || !board || !surface) return null;
    const handleRect = handle.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const local = { x: -0.62, z: 0.24 };
    const rotation = surface.world.rotation || 0;
    const world = {
      x: surface.world.x + local.x * Math.cos(rotation) - local.z * Math.sin(rotation),
      z: surface.world.z + local.x * Math.sin(rotation) + local.z * Math.cos(rotation)
    };
    const targetPlan = window.roomRecallDemo.worldToPlan(world.x, world.z);
    return {
      startX: handleRect.left + handleRect.width / 2,
      startY: handleRect.top + handleRect.height / 2,
      targetX: boardRect.left + (targetPlan.left / 100) * boardRect.width,
      targetY: boardRect.top + (targetPlan.top / 100) * boardRect.height,
      targetLocal: local
    };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: patchHandleDragPoints.startX, y: patchHandleDragPoints.startY, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: patchHandleDragPoints.startX, y: patchHandleDragPoints.startY, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: patchHandleDragPoints.targetX, y: patchHandleDragPoints.targetY, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: patchHandleDragPoints.targetX, y: patchHandleDragPoints.targetY, button: "left", clickCount: 1 });
  await sleep(250);
  const planPatchHandleDragSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const planPatchHandleDragBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const afterPatchHandleCharger = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "charger")`);
  const afterPatchHandlePrecheckCount = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot().placementPrechecks.length`);
  const beforeVolumeResizeCharger = afterPatchHandleCharger;
  const beforeVolumeResizePrecheckCount = afterPatchHandlePrecheckCount;
  const volumeResizeDragPoints = await evalPage(cdp, `(() => {
    const handle = document.querySelector("[data-plan-volume-handle='se']");
    const board = document.querySelector(".plan-board");
    const surface = window.roomRecallDemo.layoutSnapshot().supportSurfaces.find((entry) => entry.id === "surface-desk-top");
    const preview = window.roomRecallDemo.dragPreviewSnapshot().preview;
    if (!handle || !board || !surface || !preview?.supportPose?.local) return null;
    const handleRect = handle.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const center = preview.supportPose.local;
    const targetLocal = { x: center.x + 0.09, z: center.z + 0.09 };
    const rotation = surface.world.rotation || 0;
    const world = {
      x: surface.world.x + targetLocal.x * Math.cos(rotation) - targetLocal.z * Math.sin(rotation),
      z: surface.world.z + targetLocal.x * Math.sin(rotation) + targetLocal.z * Math.cos(rotation)
    };
    const targetPlan = window.roomRecallDemo.worldToPlan(world.x, world.z);
    return {
      startX: handleRect.left + handleRect.width / 2,
      startY: handleRect.top + handleRect.height / 2,
      targetX: boardRect.left + (targetPlan.left / 100) * boardRect.width,
      targetY: boardRect.top + (targetPlan.top / 100) * boardRect.height,
      targetFootprint: { width: 0.18, depth: 0.18 }
    };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: volumeResizeDragPoints.startX, y: volumeResizeDragPoints.startY, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: volumeResizeDragPoints.startX, y: volumeResizeDragPoints.startY, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: volumeResizeDragPoints.targetX, y: volumeResizeDragPoints.targetY, button: "left", buttons: 1 });
  await sleep(150);
  const planVolumeResizeDuringSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const planVolumeResizeDuringBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: volumeResizeDragPoints.targetX, y: volumeResizeDragPoints.targetY, button: "left", clickCount: 1 });
  await sleep(250);
  const planVolumeResizeSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const planVolumeResizeBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const afterVolumeResizeCharger = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "charger")`);
  const afterVolumeResizePrecheckCount = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot().placementPrechecks.length`);
  await evalPage(cdp, `window.roomRecallDemo.clearDragPreview()`);
  const resizeCommitItem = await evalPage(cdp, `(() => {
    document.getElementById("newName").value = "Resizable patch block";
    document.getElementById("newType").value = "cube";
    document.getElementById("newWidth").value = "6";
    document.getElementById("newDepth").value = "6";
    document.getElementById("newHeight").value = "4";
    document.getElementById("newKit").value = "daily";
    document.getElementById("newPlace").value = "Desk, right side";
    document.getElementById("newTags").value = "resize, patch, geometry";
    document.getElementById("createItem").click();
    return window.roomRecallDemo.snapshot().items.find((item) => item.label === "Resizable patch block");
  })()`);
  const beforeResizeCommitItem = resizeCommitItem;
  const resizeCommitPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragOnSurfaceAt(${JSON.stringify(resizeCommitItem.id)}, "surface-desk-top", -0.85, -0.26)`);
  await sleep(250);
  const resizeCommitDragPoints = await evalPage(cdp, `(() => {
    const handle = document.querySelector("[data-plan-volume-handle='se']");
    const board = document.querySelector(".plan-board");
    const surface = window.roomRecallDemo.layoutSnapshot().supportSurfaces.find((entry) => entry.id === "surface-desk-top");
    const preview = window.roomRecallDemo.dragPreviewSnapshot().preview;
    if (!handle || !board || !surface || !preview?.supportPose?.local) return null;
    const handleRect = handle.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const center = preview.supportPose.local;
    const targetLocal = { x: center.x + 0.08, z: center.z + 0.08 };
    const rotation = surface.world.rotation || 0;
    const world = {
      x: surface.world.x + targetLocal.x * Math.cos(rotation) - targetLocal.z * Math.sin(rotation),
      z: surface.world.z + targetLocal.x * Math.sin(rotation) + targetLocal.z * Math.cos(rotation)
    };
    const targetPlan = window.roomRecallDemo.worldToPlan(world.x, world.z);
    return {
      startX: handleRect.left + handleRect.width / 2,
      startY: handleRect.top + handleRect.height / 2,
      targetX: boardRect.left + (targetPlan.left / 100) * boardRect.width,
      targetY: boardRect.top + (targetPlan.top / 100) * boardRect.height,
      targetFootprint: { width: 0.16, depth: 0.16 }
    };
  })()`);
  if (!resizeCommitDragPoints) throw new Error("Could not resolve resize commit drag handle");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: resizeCommitDragPoints.startX, y: resizeCommitDragPoints.startY, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: resizeCommitDragPoints.startX, y: resizeCommitDragPoints.startY, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: resizeCommitDragPoints.targetX, y: resizeCommitDragPoints.targetY, button: "left", buttons: 1 });
  await sleep(150);
  const resizeCommitDuringSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const resizeCommitDuringBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: resizeCommitDragPoints.targetX, y: resizeCommitDragPoints.targetY, button: "left", clickCount: 1 });
  await sleep(250);
  const resizeCommitPreviewSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const resizeCommitPreviewBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const resizeCommitUiDraft = await evalPage(cdp, `(() => {
    const preview = document.querySelector("[data-plan-drop-preview]");
    const draft = document.querySelector("[data-resize-draft]");
    const confirm = document.querySelector("button[data-action='surface-confirm-item']");
    const discard = document.querySelector("button[data-action='discard-resize-preview']");
    return {
      preview: preview ? {
        phase: preview.dataset.previewPhase,
        dirty: preview.dataset.previewGeometryDirty,
        originalWidth: Number(preview.dataset.previewOriginalWidth || 0),
        originalDepth: Number(preview.dataset.previewOriginalDepth || 0),
        candidateWidth: Number(preview.dataset.previewCandidateWidth || 0),
        candidateDepth: Number(preview.dataset.previewCandidateDepth || 0),
        text: preview.textContent.trim()
      } : null,
      draft: draft ? {
        itemId: draft.dataset.resizeDraftItem,
        surfaceId: draft.dataset.resizeDraftSurface,
        status: draft.dataset.resizeDraftStatus,
        before: draft.dataset.resizeBefore,
        after: draft.dataset.resizeAfter,
        text: draft.textContent.trim()
      } : null,
      confirm: confirm ? {
        mode: confirm.dataset.surfaceConfirmMode,
        text: confirm.textContent.trim(),
        disabled: confirm.disabled
      } : null,
      discard: discard ? {
        text: discard.textContent.trim(),
        disabled: discard.disabled
      } : null
    };
  })()`);
  const resizeCommitPlacement = await evalPage(cdp, `(() => {
    const button = document.querySelector("button[data-action='surface-confirm-item'][data-surface-confirm-mode='geometry+placement']");
    if (!button) return null;
    button.click();
    return window.roomRecallDemo.lastActionResult();
  })()`);
  await sleep(250);
  const afterResizeCommitItem = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === ${JSON.stringify(resizeCommitItem.id)})`);
  const resizeCommitBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const resizeCommitBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  const resizeCommitLayout = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot()`);
  const resizeCommitFinalBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  await evalPage(cdp, `window.roomRecallDemo.setProjectionMode("cutaway3d")`);
  const snappedDragPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragOnSurface("charger", "surface-desk-top")`);
  const snappedDragSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const snappedDragBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const afterSnappedDragCharger = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "charger")`);
  await evalPage(cdp, `window.roomRecallDemo.clearDragPreview()`);
  const snappedChargerPrecheck = await evalPage(cdp, `window.roomRecallDemo.supportPlacementPrecheck("charger", "surface-desk-top")`);
  const afterSnapPrecheckCharger = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "charger")`);
  const supportSnapPrecheckDom = await evalPage(cdp, `[...document.querySelectorAll("[data-surface-precheck]")].map((node) => ({
    id: node.dataset.surfacePrecheck,
    status: node.dataset.precheckStatus,
    rawStatus: node.dataset.precheckRawStatus,
    reason: node.dataset.precheckReason,
    previousStatus: node.dataset.precheckPreviousStatus,
    uiSource: node.dataset.precheckUiSource,
    poseSource: node.dataset.supportPoseSource,
    poseSnapped: node.dataset.supportPoseSnapped,
    poseLocalX: Number(node.dataset.supportPoseLocalX || 0),
    poseLocalZ: Number(node.dataset.supportPoseLocalZ || 0),
    text: node.textContent.trim()
  }))`);
  const snappedChargerPlacement = await evalPage(cdp, `window.roomRecallDemo.confirmSupportPlacement("charger", "surface-desk-top", ${JSON.stringify(snappedChargerPrecheck.id)})`);
  const afterSnappedChargerPlacement = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "charger")`);
  const manualCommitItem = await evalPage(cdp, `(() => {
    document.getElementById("newName").value = "Manual patch marker";
    document.getElementById("newType").value = "cube";
    document.getElementById("newWidth").value = "6";
    document.getElementById("newDepth").value = "6";
    document.getElementById("newHeight").value = "4";
    document.getElementById("newKit").value = "daily";
    document.getElementById("newPlace").value = "Desk, right side";
    document.getElementById("newTags").value = "manual, patch, marker";
    document.getElementById("createItem").click();
    return window.roomRecallDemo.snapshot().items.find((item) => item.label === "Manual patch marker");
  })()`);
  const manualCommitPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragOnSurfaceAt(${JSON.stringify(manualCommitItem.id)}, "surface-desk-top", -0.55, 0.28)`);
  const manualCommitPlacement = await evalPage(cdp, `window.roomRecallDemo.commitDragPreview(${JSON.stringify(manualCommitItem.id)})`);
  const afterManualCommitPlacement = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === ${JSON.stringify(manualCommitItem.id)})`);
  const manualCommitBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const manualCommitBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  await evalPage(cdp, `window.roomRecallDemo.clearDragPreview()`);
  const manualCommitFinalBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const manualCommitFinalBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  const saturatedCandidate = await evalPage(cdp, `(() => {
    document.getElementById("newName").value = "Desk-wide tray";
    document.getElementById("newType").value = "cube";
    document.getElementById("newWidth").value = "208";
    document.getElementById("newDepth").value = "86";
    document.getElementById("newHeight").value = "5";
    document.getElementById("newKit").value = "daily";
    document.getElementById("newPlace").value = "Desk, right side";
    document.getElementById("newTags").value = "tray, desk, wide";
    document.getElementById("createItem").click();
    return window.roomRecallDemo.snapshot().items.find((item) => item.label === "Desk-wide tray");
  })()`);
  const beforeBlockedDragCandidate = saturatedCandidate;
  const blockedDragPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragOnSurface(${JSON.stringify(saturatedCandidate.id)}, "surface-desk-top")`);
  const blockedDragSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const blockedDragBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const blockedDragBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  const afterBlockedDragCandidate = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === ${JSON.stringify(saturatedCandidate.id)})`);
  await evalPage(cdp, `window.roomRecallDemo.clearDragPreview()`);
  const saturatedCollisionPrecheck = await evalPage(cdp, `window.roomRecallDemo.supportPlacementPrecheck(${JSON.stringify(saturatedCandidate.id)}, "surface-desk-top")`);
  const afterSaturatedCandidate = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === ${JSON.stringify(saturatedCandidate.id)})`);
  const beforeFitLaundry = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "laundry-bag")`);
  const blockedFitPrecheck = await evalPage(cdp, `window.roomRecallDemo.supportPlacementPrecheck("laundry-bag", "surface-desk-right-side-base")`);
  const afterFitLaundry = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "laundry-bag")`);
  const supportPrecheckDom = await evalPage(cdp, `[...document.querySelectorAll("[data-surface-precheck]")].map((node) => ({
    id: node.dataset.surfacePrecheck,
    status: node.dataset.precheckStatus,
    rawStatus: node.dataset.precheckRawStatus,
    reason: node.dataset.precheckReason,
    previousStatus: node.dataset.precheckPreviousStatus,
    uiSource: node.dataset.precheckUiSource,
    poseSource: node.dataset.supportPoseSource,
    poseSnapped: node.dataset.supportPoseSnapped,
    poseLocalX: Number(node.dataset.supportPoseLocalX || 0),
    poseLocalZ: Number(node.dataset.supportPoseLocalZ || 0),
    text: node.textContent.trim()
  }))`);
  const supportBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const supportBlockedBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  const beforeLayout = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot().furniture.find((item) => item.id === "desk")`);
  await evalPage(cdp, `window.roomRecallDemo.resizeFurniture("desk", 2.8, 1.0, 0.72)`);
  await evalPage(cdp, `window.roomRecallDemo.moveFurniture("desk", -3.35, -1.95)`);
  await sleep(650);
  const layoutAudit = await auditedPage(cdp, "layout-planner");
  await evalPage(cdp, `(() => { window.roomRecallDemo.selectItem("earphones"); return window.roomRecallDemo.selectSupportSurface("surface-desk-top"); })()`);
  const staleConfirmedPrecheckDom = await evalPage(cdp, `[...document.querySelectorAll("[data-surface-precheck]")].map((node) => ({
    id: node.dataset.surfacePrecheck,
    status: node.dataset.precheckStatus,
    rawStatus: node.dataset.precheckRawStatus,
    reason: node.dataset.precheckReason,
    previousStatus: node.dataset.precheckPreviousStatus,
    uiSource: node.dataset.precheckUiSource,
    poseSource: node.dataset.supportPoseSource,
    poseSnapped: node.dataset.supportPoseSnapped,
    poseLocalX: Number(node.dataset.supportPoseLocalX || 0),
    poseLocalZ: Number(node.dataset.supportPoseLocalZ || 0),
    text: node.textContent.trim()
  }))`);
  const staleConfirmedBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  const beforeStaleDragEarphones = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "earphones")`);
  const staleDragPreview = await evalPage(cdp, `window.roomRecallDemo.previewDragFromPrecheck(${JSON.stringify(allowedSupportPrecheck.id)})`);
  const staleDragSnapshot = await evalPage(cdp, `window.roomRecallDemo.dragPreviewSnapshot()`);
  const staleDragBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const afterStaleDragEarphones = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "earphones")`);
  await evalPage(cdp, `window.roomRecallDemo.clearDragPreview()`);
  await evalPage(cdp, `(() => { window.roomRecallDemo.selectItem("laundry-bag"); return window.roomRecallDemo.selectSupportSurface("surface-desk-right-side-base"); })()`);
  const staleSupportPrecheckDom = await evalPage(cdp, `[...document.querySelectorAll("[data-surface-precheck]")].map((node) => ({
    id: node.dataset.surfacePrecheck,
    status: node.dataset.precheckStatus,
    rawStatus: node.dataset.precheckRawStatus,
    reason: node.dataset.precheckReason,
    previousStatus: node.dataset.precheckPreviousStatus,
    uiSource: node.dataset.precheckUiSource,
    poseSource: node.dataset.supportPoseSource,
    poseSnapped: node.dataset.supportPoseSnapped,
    poseLocalX: Number(node.dataset.supportPoseLocalX || 0),
    poseLocalZ: Number(node.dataset.supportPoseLocalZ || 0),
    text: node.textContent.trim()
  }))`);
  const staleBlockedBackendDom = await evalPage(cdp, `JSON.parse(document.getElementById("backendPreview").textContent)`);
  const visibleAffectedPlacements = await evalPage(cdp, `[...document.querySelectorAll("[data-affected-placement]")].map((node) => ({
    id: node.dataset.affectedPlacement,
    itemLabel: node.dataset.itemLabel,
    parentLabel: node.dataset.parentLabel,
    text: node.textContent.trim()
  }))`);
  const afterLayout = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot()`);
  const backendContractAfterLayout = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const coordinateSnapshot = await evalPage(cdp, `window.roomRecallDemo.coordinateSnapshot()`);
  const coordinateRoundTrip = await evalPage(cdp, `(() => {
    const source = { x: 2.35, z: -1.15 };
    const plan = window.roomRecallDemo.worldToPlan(source.x, source.z);
    const world = window.roomRecallDemo.planPercentToWorld(plan.left, plan.top);
    return {
      source,
      plan,
      world,
      error: Math.hypot(world.x - source.x, world.z - source.z)
    };
  })()`);
  const multiRoundTrip = await evalPage(cdp, `(() => {
    const points = [
      { x: 0, z: 0 },
      { x: -4.3, z: -2.6 },
      { x: 4.2, z: -2.4 },
      { x: -3.7, z: 2.4 },
      { x: 3.9, z: 2.2 },
      { x: 1.15, z: -0.85 }
    ];
    return points.map((source) => {
      const plan = window.roomRecallDemo.worldToPlan(source.x, source.z);
      const world = window.roomRecallDemo.planPercentToWorld(plan.left, plan.top);
      return { source, plan, world, error: Math.hypot(world.x - source.x, world.z - source.z) };
    });
  })()`);
  await saveScreenshot(cdp, "room-recall-layout-planner.png");

  const beforePlanDrag = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "water-bottle")`);
  const dragPoints = await evalPage(cdp, `(() => {
    const pin = document.querySelector('[data-plan-item="water-bottle"]');
    const board = document.querySelector('.plan-board');
    const p = pin.getBoundingClientRect();
    const b = board.getBoundingClientRect();
    return {
      startX: p.left + p.width / 2,
      startY: p.top + p.height / 2,
      endX: b.left + b.width * 0.72,
      endY: b.top + b.height * 0.38
    };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragPoints.startX, y: dragPoints.startY, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: dragPoints.startX, y: dragPoints.startY, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragPoints.endX, y: dragPoints.endY, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dragPoints.endX, y: dragPoints.endY, button: "left", clickCount: 1 });
  await sleep(500);
  const afterPlanDrag = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "water-bottle")`);
  await saveScreenshot(cdp, "room-recall-plan-dragged.png");

  const beforeRotate = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "water-bottle")`);
  await evalPage(cdp, `window.roomRecallDemo.rotateItem("water-bottle", 30)`);
  await sleep(450);
  const afterRotate = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.id === "water-bottle")`);
  await saveScreenshot(cdp, "room-recall-rotated-water-bottle.png");

  await evalPage(cdp, `(() => {
    document.getElementById("newName").value = "Foldable desk lamp";
    document.getElementById("newType").value = "cube";
    document.getElementById("newWidth").value = "18";
    document.getElementById("newDepth").value = "12";
    document.getElementById("newHeight").value = "32";
    document.getElementById("newKit").value = "daily";
    document.getElementById("newPlace").value = "Desk, right side";
    document.getElementById("newTags").value = "lamp, lighting, desk";
    document.getElementById("createItem").click();
  })()`);
  await sleep(500);
  const productItem = await evalPage(cdp, `window.roomRecallDemo.snapshot().items.find((item) => item.label === "Foldable desk lamp")`);
  const productAfterMove = productItem
    ? await evalPage(cdp, `(() => {
        window.roomRecallDemo.moveItem(${JSON.stringify(productItem.id)}, -2.1, 1.25);
        return window.roomRecallDemo.snapshot().items.find((item) => item.id === ${JSON.stringify(productItem.id)});
      })()`)
    : null;
  const productIdentityAnswerFlow = productItem
    ? await evalPage(cdp, `(async () => {
        const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const readPlanOverlay = () => {
          const overlay = document.querySelector("[data-plan-answer-overlay]");
          const targetPin = document.querySelector("[data-plan-answer-target='true']");
          const holdPin = document.querySelector("[data-plan-answer-hold='true']");
          const empty = document.querySelector("[data-plan-answer-empty]");
          const board = document.querySelector(".plan-board");
          return {
            board: board ? {
              density: board.dataset.planDensity,
              labelPolicy: board.dataset.planLabelPolicy,
              densityReason: board.dataset.planDensityReason,
              visibleLabelCount: Number(board.dataset.planVisibleLabelCount || 0),
              collapsedLabelCount: Number(board.dataset.planCollapsedLabelCount || 0),
              hoveredItem: board.dataset.planHoveredItem,
              focusedItem: board.dataset.planFocusedItem,
              state: board.dataset.planAnswerState,
              query: board.dataset.planAnswerQuery,
              source: board.dataset.planAnswerSource
            } : null,
            overlay: overlay ? {
              status: overlay.dataset.planAnswerStatus,
              state: overlay.dataset.planAnswerState,
              itemId: overlay.dataset.planAnswerItem,
              anchorItemId: overlay.dataset.planAnswerAnchorItem,
              placementId: overlay.dataset.planAnswerPlacementId,
              identityCommitId: overlay.dataset.planAnswerIdentityCommit,
              latestIdentityCommitId: overlay.dataset.planAnswerLatestIdentityCommit,
              reviewRequired: overlay.dataset.planAnswerReviewRequired,
              confidence: Number(overlay.dataset.planAnswerConfidence || 0),
              suppressedCommits: overlay.dataset.planAnswerSuppressedCommits,
              blockedOlderCommits: overlay.dataset.planAnswerBlockedOlderCommits,
              text: overlay.textContent.trim()
            } : null,
            targetPin: targetPin ? {
              itemId: targetPin.dataset.planItem,
              state: targetPin.dataset.planAnswerState
            } : null,
            holdPin: holdPin ? {
              itemId: holdPin.dataset.planItem,
              state: holdPin.dataset.planAnswerState
            } : null,
            empty: empty ? {
              status: empty.dataset.planAnswerStatus,
              text: empty.textContent.trim()
            } : null,
            labelModes: [...document.querySelectorAll("[data-plan-item]")].map((pin) => ({
              itemId: pin.dataset.planItem,
              labelMode: pin.dataset.planLabelMode,
              labelPriority: pin.dataset.planLabelPriority,
              labelState: pin.dataset.planLabelState,
              revealReason: pin.dataset.planLabelRevealReason,
              labelText: pin.dataset.planLabelText,
              answerTarget: pin.dataset.planAnswerTarget,
              answerHold: pin.dataset.planAnswerHold,
              answerState: pin.dataset.planAnswerState,
              text: pin.textContent.trim()
            }))
          };
        };
        const read3dOverlay = () => {
          const layout = window.roomRecallDemo.layoutSnapshot();
          const sceneLabel = document.querySelector("[data-retrieval3d-overlay]");
          const itemLabel = document.querySelector("[data-retrieval-overlay][data-answer-item]");
          return {
            overlay: layout.retrievalSpatialOverlay,
            productRenderedItem: layout.renderedItems.find((item) => item.id === productId) ?? null,
            productItem: layout.renderedItems.find((item) => item.id === productId)?.retrievalOverlay ?? null,
            visibleVolumeOutlines: layout.renderedItems
              .filter((item) => item.volumeOutline?.visible)
              .map((item) => ({ id: item.id, volumeOutline: item.volumeOutline })),
            itemOverlays: layout.renderedItems.filter((item) => item.retrievalOverlay).map((item) => ({
              id: item.id,
              retrievalOverlay: item.retrievalOverlay
            })),
            sceneLabel: sceneLabel ? {
              state: sceneLabel.dataset.retrievalState,
              kind: sceneLabel.dataset.retrievalOverlayKind,
              itemId: sceneLabel.dataset.answerItem,
              source: sceneLabel.dataset.answerSource,
              confidence: Number(sceneLabel.dataset.answerConfidence || 0),
              identityCommitId: sceneLabel.dataset.identityCommit,
              placementId: sceneLabel.dataset.placementId,
              reviewRequired: sceneLabel.dataset.reviewRequired,
              suppressedCommitId: sceneLabel.dataset.suppressedCommitId,
              text: sceneLabel.textContent.trim(),
              opacity: sceneLabel.style.opacity
            } : null,
            itemLabel: itemLabel ? {
              state: itemLabel.dataset.retrievalState,
              kind: itemLabel.dataset.retrievalOverlayKind,
              itemId: itemLabel.dataset.answerItem,
              source: itemLabel.dataset.answerSource,
              confidence: Number(itemLabel.dataset.answerConfidence || 0),
              identityCommitId: itemLabel.dataset.identityCommit,
              placementId: itemLabel.dataset.placementId,
              reviewRequired: itemLabel.dataset.reviewRequired,
              text: itemLabel.textContent.trim()
            } : null
          };
        };
        const proposalId = "identity-proposal-identity-obs-desk-lamp-candidate";
        const productId = ${JSON.stringify(productItem?.id ?? null)};
        const geometryStatusesBefore = window.roomRecallDemo.layoutSnapshot().proposals.map((proposal) => [proposal.id, proposal.status]);
        const draft = window.roomRecallDemo.setIdentityResolutionDraft(proposalId, "match_existing", productId);
        const commit = window.roomRecallDemo.commitIdentityResolutionDraft(proposalId);
        const afterCommitBackend = window.roomRecallDemo.backendContractSnapshot();
        const answer = window.roomRecallDemo.locateAnswer("lamp-shaped object");
        window.roomRecallDemo.setProjectionMode("plan2d");
        await settle();
        const answeredPlan = readPlanOverlay();
        const answeredPlanBackend = window.roomRecallDemo.backendContractSnapshot();
        window.roomRecallDemo.setProjectionMode("cutaway3d");
        await settle();
        const answered3d = read3dOverlay();
        const afterLocateBackend = window.roomRecallDemo.backendContractSnapshot();
        const answerDom = document.querySelector("[data-answer-evidence-source='scan_identity_commit']");
        const rowDom = document.querySelector(\`[data-identity-proposal="\${proposalId}"]\`);
        window.roomRecallDemo.selectIdentityProposal(proposalId);
        const lineageDetail = document.querySelector("[data-identity-lineage-detail]");
        const rollbackButton = document.querySelector(\`[data-identity-rollback="\${commit?.id}"]\`);
        const ledgerCountBeforeRollback = afterLocateBackend.commitPreview.commitLedgerEntries.length;
        rollbackButton?.click();
        const afterRollbackBackend = window.roomRecallDemo.backendContractSnapshot();
        const afterRollbackLayout = window.roomRecallDemo.layoutSnapshot();
        const afterRollbackAnswer = window.roomRecallDemo.locateAnswer("lamp-shaped object");
        const afterRollbackExplanation = window.roomRecallDemo.retrievalExplanation("lamp-shaped object");
        window.roomRecallDemo.setProjectionMode("plan2d");
        await settle();
        const needsReviewPlan = readPlanOverlay();
        const needsReviewPlanBackend = window.roomRecallDemo.backendContractSnapshot();
        window.roomRecallDemo.setProjectionMode("cutaway3d");
        await settle();
        const needsReview3d = read3dOverlay();
        const needsReviewDom = document.querySelector("[data-retrieval-explanation]");
        const afterNeedsReviewBackend = window.roomRecallDemo.backendContractSnapshot();
        const notFoundAnswer = window.roomRecallDemo.locateAnswer("astronaut helmet");
        const notFoundExplanation = window.roomRecallDemo.retrievalExplanation("astronaut helmet");
        window.roomRecallDemo.setProjectionMode("plan2d");
        await settle();
        const notFoundPlan = readPlanOverlay();
        const notFoundPlanBackend = window.roomRecallDemo.backendContractSnapshot();
        window.roomRecallDemo.setProjectionMode("cutaway3d");
        await settle();
        const notFound3d = read3dOverlay();
        const notFoundDomNode = document.querySelector("[data-retrieval-no-result]")?.closest("[data-answer-preview]");
        const afterNotFoundBackend = window.roomRecallDemo.backendContractSnapshot();
        const labelRevealLedgerCountBefore = afterNotFoundBackend.commitPreview.commitLedgerEntries.length;
        const hoverLabelSnapshot = window.roomRecallDemo.hoverPlanItem("water-bottle");
        await settle();
        const hoverPlan = readPlanOverlay();
        const clearAfterHoverSnapshot = window.roomRecallDemo.clearPlanLabelReveal();
        await settle();
        const focusLabelSnapshot = window.roomRecallDemo.focusPlanItem("water-bottle");
        await settle();
        const focusPlan = readPlanOverlay();
        const clearAfterFocusSnapshot = window.roomRecallDemo.clearPlanLabelReveal();
        const afterLabelRevealBackend = window.roomRecallDemo.backendContractSnapshot();
        const geometryStatusesAfter = afterRollbackLayout.proposals.map((proposal) => [proposal.id, proposal.status]);
        return {
          proposalId,
          productId,
          draft,
          commit,
          answer,
          answeredPlan,
          answeredPlanBackend,
          answered3d,
          afterCommitBackend,
          afterLocateBackend,
          dom: {
            answer: answerDom ? {
              source: answerDom.dataset.answerEvidenceSource,
              identityCommit: answerDom.dataset.answerIdentityCommit,
              placementId: answerDom.dataset.answerPlacementId,
              observationId: answerDom.dataset.answerObservation,
              text: answerDom.textContent.trim()
            } : null,
            row: rowDom ? {
              proposalId: rowDom.dataset.identityProposal,
              targetItemId: rowDom.dataset.identityTargetItem,
              commitId: rowDom.dataset.identityCommitId,
              lineageId: rowDom.dataset.identityLineage,
              lineageStatus: rowDom.dataset.lineageStatus,
              text: rowDom.textContent.trim()
            } : null,
            lineageDetail: lineageDetail ? {
              commitId: lineageDetail.dataset.identityLineageDetail,
              status: lineageDetail.dataset.lineageStatus,
              opId: lineageDetail.dataset.lineageOp,
              observationId: lineageDetail.dataset.lineageObservation,
              targetItemId: lineageDetail.dataset.lineageTargetItem,
              text: lineageDetail.textContent.trim()
            } : null,
            rollbackClicked: Boolean(rollbackButton)
          },
          afterRollbackBackend,
          afterRollbackLayout,
          afterRollbackAnswer,
          afterRollbackExplanation,
          needsReviewPlan,
          needsReviewPlanBackend,
          needsReview3d,
          afterNeedsReviewBackend,
          needsReviewDom: needsReviewDom ? {
            status: needsReviewDom.dataset.retrievalExplanation,
            answerStatus: needsReviewDom.dataset.answerStatus,
            answerSource: needsReviewDom.dataset.answerSource,
            reviewRequired: needsReviewDom.dataset.reviewRequired,
            holdReason: needsReviewDom.dataset.answerHoldReason,
            latestIdentityStatus: needsReviewDom.dataset.latestIdentityStatus,
            latestIdentityCommit: needsReviewDom.dataset.latestIdentityCommit,
            blockedOlderIdentityCommits: needsReviewDom.dataset.blockedOlderIdentityCommits,
            suppressedIdentityCount: Number(needsReviewDom.dataset.suppressedIdentityCount || 0),
            finalConfidence: Number(needsReviewDom.dataset.finalConfidence || 0),
            suppressedRows: [...needsReviewDom.querySelectorAll("[data-suppressed-identity-evidence]")].map((node) => ({
              commitId: node.dataset.suppressedCommitId,
              reason: node.dataset.suppressedReason,
              rollbackCommitId: node.dataset.rollbackCommitId,
              text: node.textContent.trim()
            })),
            text: needsReviewDom.textContent.trim()
          } : null,
          notFoundAnswer,
          notFoundExplanation,
          notFoundPlan,
          notFoundPlanBackend,
          notFound3d,
          notFoundDom: notFoundDomNode ? {
            status: notFoundDomNode.dataset.retrievalState,
            answerStatus: notFoundDomNode.dataset.answerStatus,
            answerSource: notFoundDomNode.dataset.answerSource,
            reviewRequired: notFoundDomNode.dataset.reviewRequired,
            finalConfidence: Number(notFoundDomNode.dataset.finalConfidence || 0),
            text: notFoundDomNode.textContent.trim()
          } : null,
          afterNotFoundBackend,
          labelReveal: {
            ledgerCountBefore: labelRevealLedgerCountBefore,
            hoverSnapshot: hoverLabelSnapshot,
            hoverPlan,
            clearAfterHoverSnapshot,
            focusSnapshot: focusLabelSnapshot,
            focusPlan,
            clearAfterFocusSnapshot,
            afterBackend: afterLabelRevealBackend
          },
          ledgerCountBeforeRollback,
          geometryStatusesBefore,
          geometryStatusesAfter
        };
      })()`)
    : null;
  const productIdentityBackend = await evalPage(cdp, `window.roomRecallDemo.backendContractSnapshot()`);
  const productIdentityLayout = await evalPage(cdp, `window.roomRecallDemo.layoutSnapshot()`);
  const manipulationAffordanceFlow = await evalPage(cdp, `(async () => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.roomRecallDemo.setProjectionMode("cutaway3d");
    window.roomRecallDemo.selectItem("gym-card");
    await settle();
    const layout = window.roomRecallDemo.layoutSnapshot();
    const backend = window.roomRecallDemo.backendContractSnapshot();
    const detail = document.querySelector("[data-container-fit-readout]");
    return {
      selectedItem: layout.renderedItems.find((item) => item.id === "gym-card") ?? null,
      fitDetail: detail ? {
        id: detail.dataset.containerFitReadout,
        status: detail.dataset.containerFitStatus,
        target: detail.dataset.containerFitTarget,
        text: detail.textContent.trim()
      } : null,
      backendFit: backend.commitPreview.selectedItemFitReadout,
      ledgerCount: backend.commitPreview.commitLedgerEntries.length,
      geometryOps: backend.mutationBundle.draftOps.geometryOps,
      placementOps: backend.mutationBundle.draftOps.placementOps
    };
  })()`);
  const layoutScenarioCompareFlow = await evalPage(cdp, `(async () => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const beforeLayout = window.roomRecallDemo.layoutSnapshot();
    const beforeBackend = window.roomRecallDemo.backendContractSnapshot();
    const beforeFurniture = JSON.stringify(beforeLayout.furniture);
    const beforePlacementState = JSON.stringify(window.roomRecallDemo.snapshot().items.map((item) => ({
      id: item.id,
      status: item.currentPlacement?.status ?? null,
      placementId: item.currentPlacement?.id ?? null,
      confidence: item.confidence
    })));
    const beforeCommitCount = beforeBackend.commitPreview.commitLedgerEntries.length;
    const beforeGeometryOps = beforeBackend.mutationBundle.draftOps.geometryOps.length;
    const beforePlacementOps = beforeBackend.mutationBundle.draftOps.placementOps.length;
    const records = window.roomRecallDemo.layoutScenarioCompareRecords();
    const afterRecordsLayout = window.roomRecallDemo.layoutSnapshot();
    const afterRecordsBackend = window.roomRecallDemo.backendContractSnapshot();
    window.roomRecallDemo.setProjectionMode("plan2d");
    await settle();
    const scenarioDom = {
      summary: document.querySelector("[data-layout-scenario-compare]") ? {
        count: Number(document.querySelector("[data-layout-scenario-compare]").dataset.scenarioCount || 0),
        text: document.querySelector("[data-layout-scenario-compare]").textContent.trim()
      } : null,
      rows: [...document.querySelectorAll("[data-layout-scenario]")].map((node) => ({
        id: node.dataset.layoutScenario,
        scenarioId: node.dataset.scenarioId,
        readOnly: node.dataset.scenarioReadOnly,
        commitReady: node.dataset.scenarioCommitReady,
        currentPathCm: Number(node.dataset.currentPathCm || 0),
        proposedPathCm: Number(node.dataset.proposedPathCm || 0),
        storageDelta: Number(node.dataset.storageDelta || 0),
        collisionDelta: Number(node.dataset.collisionDelta || 0),
        geometryDiffIds: (node.dataset.geometryDiffIds || "").split(",").filter(Boolean),
        predictedImpactCount: Number(node.dataset.predictedImpactCount || 0),
        supportImpactCount: Number(node.dataset.supportImpactCount || 0),
        reasonCodes: (node.dataset.reasonCodes || "").split(",").filter(Boolean),
        recommendationStatus: node.dataset.recommendationStatus,
        certaintyStatus: node.dataset.certaintyStatus,
        certaintyScore: Number(node.dataset.certaintyScore || 0),
        capturePromptCount: Number(node.dataset.capturePromptCount || 0),
        commitGateId: node.dataset.commitGate,
        commitGateStatus: node.dataset.commitGateStatus,
        commitBlockerCount: Number(node.dataset.commitBlockerCount || 0),
        commitBlockerTypes: (node.dataset.commitBlockerTypes || "").split(",").filter(Boolean),
        text: node.textContent.trim()
      })),
      ghosts: [...document.querySelectorAll("[data-plan-scenario-ghost]")].map((node) => ({
        scenarioId: node.dataset.scenarioId,
        furnitureId: node.dataset.furnitureId,
        geometryDiffId: node.dataset.geometryDiffId,
        readOnly: node.dataset.scenarioReadOnly,
        commitReady: node.dataset.scenarioCommitReady,
        storageDelta: Number(node.dataset.storageDelta || 0),
        text: node.textContent.trim()
      }))
    };
    const afterDomLayout = window.roomRecallDemo.layoutSnapshot();
    const afterDomBackend = window.roomRecallDemo.backendContractSnapshot();
    return {
      records,
      layoutRecords: afterDomLayout.layoutScenarioCompareRecords,
      backendRecords: afterDomBackend.commitPreview.layoutScenarioCompareRecords,
      backendGhosts: afterDomBackend.commitPreview.planScenarioGhosts,
      scenarioDom,
      readOnlyState: {
        furnitureUnchangedAfterRecords: JSON.stringify(afterRecordsLayout.furniture) === beforeFurniture,
        furnitureUnchangedAfterDom: JSON.stringify(afterDomLayout.furniture) === beforeFurniture,
        placementsUnchangedAfterDom: JSON.stringify(window.roomRecallDemo.snapshot().items.map((item) => ({
          id: item.id,
          status: item.currentPlacement?.status ?? null,
          placementId: item.currentPlacement?.id ?? null,
          confidence: item.confidence
        }))) === beforePlacementState,
        commitCountBefore: beforeCommitCount,
        commitCountAfter: afterDomBackend.commitPreview.commitLedgerEntries.length,
        geometryOpsBefore: beforeGeometryOps,
        geometryOpsAfter: afterDomBackend.mutationBundle.draftOps.geometryOps.length,
        placementOpsBefore: beforePlacementOps,
        placementOpsAfter: afterDomBackend.mutationBundle.draftOps.placementOps.length
      },
      backendAfterRecords: {
        recordCount: afterRecordsBackend.commitPreview.layoutScenarioCompareRecords?.length ?? 0,
        ghostCount: afterRecordsBackend.commitPreview.planScenarioGhosts?.length ?? 0
      }
    };
  })()`);
  const anchorEditFlow = await evalPage(cdp, `(async () => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const beforeCoordinate = window.roomRecallDemo.coordinateSnapshot();
    const beforeLayout = window.roomRecallDemo.layoutSnapshot();
    const beforeBackend = window.roomRecallDemo.backendContractSnapshot();
    const beforeAnchor = beforeCoordinate.anchors.find((anchor) => anchor.id === "anchor-desk-edge");
    const beforeFurniture = JSON.stringify(beforeLayout.furniture);
    const beforeAnchors = JSON.stringify(beforeCoordinate.anchors);
    const beforeCommitCount = beforeBackend.commitPreview.commitLedgerEntries.length;
    const draft = window.roomRecallDemo.previewAnchorEdit("anchor-desk-edge", {
      x: 2.5,
      z: -1.31,
      errorCm: 2.2,
      confidence: 0.91
    });
    await settle();
    const afterCoordinate = window.roomRecallDemo.coordinateSnapshot();
    const afterLayout = window.roomRecallDemo.layoutSnapshot();
    const afterBackend = window.roomRecallDemo.backendContractSnapshot();
    const dom = document.querySelector("[data-anchor-edit-draft]");
    return {
      beforeAnchor,
      draft,
      layoutDraft: afterLayout.anchorEditDraft,
      backendDraft: afterBackend.commitPreview.anchorEditDraft,
      backendStaleGeometry: afterBackend.commitPreview.anchorStaleGeometryRecords,
      dom: dom ? {
        id: dom.dataset.anchorEditDraft,
        anchorId: dom.dataset.anchorId,
        commitReady: dom.dataset.anchorCommitReady,
        writesCanonical: dom.dataset.anchorWritesCanonical,
        staleGeometryCount: Number(dom.dataset.staleGeometryCount || 0),
        reconstructionStatus: dom.dataset.reconstructionAfterAnchor,
        text: dom.textContent.trim()
      } : null,
      readOnlyState: {
        anchorsUnchanged: JSON.stringify(afterCoordinate.anchors) === beforeAnchors,
        furnitureUnchanged: JSON.stringify(afterLayout.furniture) === beforeFurniture,
        commitCountBefore: beforeCommitCount,
        commitCountAfter: afterBackend.commitPreview.commitLedgerEntries.length,
        geometryOpsBefore: beforeBackend.mutationBundle.draftOps.geometryOps.length,
        geometryOpsAfter: afterBackend.mutationBundle.draftOps.geometryOps.length
      }
    };
  })()`);
  const anchorResolutionFlow = await evalPage(cdp, `(async () => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const beforeCommitBackend = JSON.parse(JSON.stringify(window.roomRecallDemo.backendContractSnapshot()));
    const beforeCommitAnchor = JSON.parse(JSON.stringify(window.roomRecallDemo.coordinateSnapshot().anchors.find((anchor) => anchor.id === "anchor-desk-edge")));
    const commit = window.roomRecallDemo.commitAnchorEditDraft();
    await settle();
    const afterCommitCoordinate = window.roomRecallDemo.coordinateSnapshot();
    const afterCommitBackend = window.roomRecallDemo.backendContractSnapshot();
    const afterCommitLayout = window.roomRecallDemo.layoutSnapshot();
    const committedAnchor = afterCommitCoordinate.anchors.find((anchor) => anchor.id === "anchor-desk-edge");
    const scenarioAfterCommit = window.roomRecallDemo.layoutScenarioCompareRecords();
    const locateAfterCommit = window.roomRecallDemo.locateAnswer("water bottle");
    const historyDomAfterCommit = [...document.querySelectorAll("[data-anchor-edit-history]")].map((node) => ({
      id: node.dataset.anchorEditHistory,
      status: node.dataset.anchorHistoryStatus,
      commitId: node.dataset.anchorHistoryCommit,
      refreshProposalId: node.dataset.refreshProposal,
      text: node.textContent.trim()
    }));
    const beforeRejectAnchors = JSON.stringify(afterCommitCoordinate.anchors);
    const rejectDraft = window.roomRecallDemo.previewAnchorEdit("anchor-entry-wall", { errorCm: 4.4, confidence: 0.88 });
    const reject = window.roomRecallDemo.rejectAnchorEditDraft("needs better wall capture");
    await settle();
    const afterRejectCoordinate = window.roomRecallDemo.coordinateSnapshot();
    const afterRejectBackend = window.roomRecallDemo.backendContractSnapshot();
    const historyDomAfterReject = [...document.querySelectorAll("[data-anchor-edit-history]")].map((node) => ({
      id: node.dataset.anchorEditHistory,
      status: node.dataset.anchorHistoryStatus,
      commitId: node.dataset.anchorHistoryCommit,
      refreshProposalId: node.dataset.refreshProposal,
      text: node.textContent.trim()
    }));
    return {
      beforeCommitAnchor,
      commit,
      committedAnchor,
      anchorChanged: committedAnchor.x !== beforeCommitAnchor.x || committedAnchor.errorCm !== beforeCommitAnchor.errorCm,
      commitLedgerCountBefore: beforeCommitBackend.commitPreview.commitLedgerEntries.length,
      commitLedgerCountAfter: afterCommitBackend.commitPreview.commitLedgerEntries.length,
      historyAfterCommit: afterCommitBackend.commitPreview.anchorEditHistory,
      refreshProposalsAfterCommit: afterCommitBackend.commitPreview.reconstructionRefreshProposals,
      layoutRefreshProposalsAfterCommit: afterCommitLayout.reconstructionRefreshProposals,
      scenarioAfterCommit,
      locateAfterCommit,
      backendAnchorRecord: afterCommitBackend.writeModelPreview.anchorRecords.find((anchor) => anchor.id === "anchor-desk-edge"),
      historyDomAfterCommit,
      rejectDraft,
      reject,
      anchorsUnchangedAfterReject: JSON.stringify(afterRejectCoordinate.anchors) === beforeRejectAnchors,
      historyAfterReject: afterRejectBackend.commitPreview.anchorEditHistory,
      historyDomAfterReject
    };
  })()`);
  const layoutScenarioDecisionFlow = await evalPage(cdp, `(async () => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const beforeLayout = window.roomRecallDemo.layoutSnapshot();
    const beforeBackend = window.roomRecallDemo.backendContractSnapshot();
    const beforeFurniture = JSON.stringify(beforeLayout.furniture);
    const beforeLedgerCount = beforeBackend.commitPreview.commitLedgerEntries.length;
    const applyDraft = window.roomRecallDemo.requestLayoutScenarioApply("scenario-desk-wall-align");
    await settle();
    const afterApplyLayout = window.roomRecallDemo.layoutSnapshot();
    const afterApplyBackend = window.roomRecallDemo.backendContractSnapshot();
    const draftDom = document.querySelector("[data-layout-scenario-decision-draft]");
    const rejectRecord = window.roomRecallDemo.rejectLayoutScenario("scenario-entry-rack-flush", "entry path feels worse");
    await settle();
    const afterRejectLayout = window.roomRecallDemo.layoutSnapshot();
    const afterRejectBackend = window.roomRecallDemo.backendContractSnapshot();
    const historyDom = document.querySelector("[data-layout-scenario-decision-history]");
    return {
      applyDraft,
      backendDecisionAfterApply: afterApplyBackend.commitPreview.layoutScenarioDecision,
      layoutDecisionAfterApply: afterApplyLayout.layoutScenarioDecision,
      draftDom: draftDom ? {
        id: draftDom.dataset.layoutScenarioDecisionDraft,
        scenarioId: draftDom.dataset.decisionScenario,
        status: draftDom.dataset.decisionStatus,
        canApply: draftDom.dataset.decisionCanApply,
        blockerCount: Number(draftDom.dataset.decisionBlockerCount || 0),
        text: draftDom.textContent.trim()
      } : null,
      rejectRecord,
      backendDecisionAfterReject: afterRejectBackend.commitPreview.layoutScenarioDecision,
      layoutDecisionAfterReject: afterRejectLayout.layoutScenarioDecision,
      historyDom: historyDom ? {
        id: historyDom.dataset.layoutScenarioDecisionHistory,
        scenarioId: historyDom.dataset.historyScenario,
        status: historyDom.dataset.historyStatus,
        text: historyDom.textContent.trim()
      } : null,
      readOnlyState: {
        furnitureUnchanged: JSON.stringify(afterRejectLayout.furniture) === beforeFurniture,
        ledgerCountBefore: beforeLedgerCount,
        ledgerCountAfter: afterRejectBackend.commitPreview.commitLedgerEntries.length,
        geometryOpsBefore: beforeBackend.mutationBundle.draftOps.geometryOps.length,
        geometryOpsAfter: afterRejectBackend.mutationBundle.draftOps.geometryOps.length
      }
    };
  })()`);
  const layoutScenarioFocusFlow = await evalPage(cdp, `(async () => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const focus = window.roomRecallDemo.focusLayoutScenario("scenario-shelf-vertical-storage");
    window.roomRecallDemo.setProjectionMode("plan2d");
    await settle();
    const layout = window.roomRecallDemo.layoutSnapshot();
    const backend = window.roomRecallDemo.backendContractSnapshot();
    const locate = window.roomRecallDemo.locateAnswer("water bottle");
    const focusDom = document.querySelector("[data-layout-scenario-focus]");
    const focusedRow = document.querySelector("[data-layout-scenario][data-scenario-focused='true']");
    const ghosts = [...document.querySelectorAll("[data-plan-scenario-ghost]")].map((node) => ({
      scenarioId: node.dataset.scenarioId,
      furnitureId: node.dataset.furnitureId,
      geometryDiffId: node.dataset.geometryDiffId,
      focused: node.dataset.scenarioFocused,
      text: node.textContent.trim()
    }));
    return {
      focus,
      layoutFocus: layout.layoutScenarioFocus,
      backendFocus: backend.commitPreview.layoutScenarioFocus,
      locate,
      focusDom: focusDom ? {
        id: focusDom.dataset.layoutScenarioFocus,
        scenarioId: focusDom.dataset.focusScenario,
        geometryDiffIds: (focusDom.dataset.focusGeometryDiffIds || "").split(",").filter(Boolean),
        commitGateId: focusDom.dataset.focusCommitGate,
        text: focusDom.textContent.trim()
      } : null,
      focusedRow: focusedRow ? {
        scenarioId: focusedRow.dataset.scenarioId,
        focused: focusedRow.dataset.scenarioFocused
      } : null,
      ghosts
    };
  })()`);
  const layoutScenarioReplayFlow = await evalPage(cdp, `(async () => {
    const beforeLayout = window.roomRecallDemo.layoutSnapshot();
    const beforeBackend = window.roomRecallDemo.backendContractSnapshot();
    const beforeFurniture = JSON.stringify(beforeLayout.furniture);
    const beforePlacementState = JSON.stringify(window.roomRecallDemo.snapshot().items.map((item) => ({
      id: item.id,
      status: item.currentPlacement?.status ?? null,
      placementId: item.currentPlacement?.id ?? null,
      confidence: item.confidence
    })));
    const fixtures = window.roomRecallDemo.layoutScenarioFixtureRecords();
    const replay = window.roomRecallDemo.replayLayoutScenarioFixture("scenario-shelf-vertical-storage");
    const replayByFixture = window.roomRecallDemo.replayLayoutScenarioFixture(replay?.fixtureId);
    const afterLayout = window.roomRecallDemo.layoutSnapshot();
    const afterBackend = window.roomRecallDemo.backendContractSnapshot();
    return {
      fixtures,
      replay,
      replayByFixture,
      layoutFixtures: afterLayout.layoutScenarioFixtures,
      layoutReplay: afterLayout.layoutScenarioReplay,
      backendFixtures: afterBackend.commitPreview.layoutScenarioFixtures,
      backendReplay: afterBackend.commitPreview.layoutScenarioReplay,
      readOnlyState: {
        furnitureUnchanged: JSON.stringify(afterLayout.furniture) === beforeFurniture,
        placementsUnchanged: JSON.stringify(window.roomRecallDemo.snapshot().items.map((item) => ({
          id: item.id,
          status: item.currentPlacement?.status ?? null,
          placementId: item.currentPlacement?.id ?? null,
          confidence: item.confidence
        }))) === beforePlacementState,
        ledgerCountBefore: beforeBackend.commitPreview.commitLedgerEntries.length,
        ledgerCountAfter: afterBackend.commitPreview.commitLedgerEntries.length,
        geometryOpsBefore: beforeBackend.mutationBundle.draftOps.geometryOps.length,
        geometryOpsAfter: afterBackend.mutationBundle.draftOps.geometryOps.length,
        placementOpsBefore: beforeBackend.mutationBundle.draftOps.placementOps.length,
        placementOpsAfter: afterBackend.mutationBundle.draftOps.placementOps.length
      }
    };
  })()`);
  const endToEndDemoFlow = await evalPage(cdp, `(() => {
    const record = window.roomRecallDemo.roomRecallEndToEndDemoRecord();
    const layout = window.roomRecallDemo.layoutSnapshot();
    const backend = window.roomRecallDemo.backendContractSnapshot();
    return {
      record,
      layoutRecord: layout.endToEndDemo,
      backendRecord: backend.commitPreview.endToEndDemo,
      stageIds: record.stages.map((stage) => stage.id),
      stageOrder: record.stageOrder,
      writeTypes: record.canonicalWriteTypes,
      commitIds: record.commitsByType,
      proposalOnlyProof: record.proposalOnlyProof,
      privacyAndUnknownPolicy: record.privacyAndUnknownPolicy,
      locateEvidence: record.locateReadback?.placementEvidence ?? null
    };
  })()`);

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenOrientation: { type: "portraitPrimary", angle: 0 }
  });
  await cdp.send("Page.navigate", { url: rootUrl });
  await waitForLoad(cdp);
  await waitForDemo(cdp);
  await sleep(2200);
  const mobileAudit = await auditedPage(cdp, "mobile-initial");
  await saveScreenshot(cdp, "room-recall-mobile.png");

  const screenshotStats = await analyzeScreenshots();
  const assertions = [];
  const assert = (condition, name, details = {}) => {
    assertions.push({ name, pass: Boolean(condition), details });
  };
  const manualCommitLocal = { x: -0.55, z: 0.28 };
  const matchesManualCommitLocal = (pose) =>
    Boolean(pose?.manual) &&
    pose.poseSource === "manual_patch" &&
    Math.abs((pose.local?.x ?? 99) - manualCommitLocal.x) <= 0.01 &&
    Math.abs((pose.local?.z ?? 99) - manualCommitLocal.z) <= 0.01;
  const resizeCommitLedgerEntry = resizeCommitBackend.commitPreview.commitLedgerEntries.find((entry) => entry.id === resizeCommitPlacement?.commit?.id);
  const resizeCommitGeometryOp = resizeCommitLedgerEntry?.ops?.find((op) => op.type === "commit_item_geometry_update");
  const resizeCommitPlacementOp = resizeCommitLedgerEntry?.ops?.find((op) => op.type === "commit_support_surface_placement");
  const resizeCommitPlacementRecord = resizeCommitBackend.writeModelPreview.placementRecords.find((record) => record.subjectRef === `item:${resizeCommitItem.id}`);
  const resizeCommitGeometryRecord = resizeCommitBackend.mutationBundle.draftOps.geometryOps.find((op) =>
    op.type === "commit_item_geometry_update" &&
    op.itemId === resizeCommitItem.id &&
    op.commitId === resizeCommitPlacement?.commit?.id
  );
  const resizeCommitPreviewGeometryRecord = resizeCommitBackend.commitPreview.geometryOps.find((op) =>
    op.type === "commit_item_geometry_update" &&
    op.itemId === resizeCommitItem.id &&
    op.commitId === resizeCommitPlacement?.commit?.id
  );
  const resizeCommitRenderedItem = resizeCommitLayout.renderedItems.find((item) => item.id === resizeCommitItem.id);
  const scanIdentityObservations = backendContract.observationInbox.observations.filter((observation) =>
    observation.producerId === "scan-identity-producer-v1"
  );
  const scanIdentityTypes = new Set(scanIdentityObservations.map((observation) => observation.type));
  const scanIdentityMutationRecords = backendContract.mutationBundle.identityObservationRecords ?? [];
  const scanIdentityProposalRecords = backendContract.mutationBundle.identityProposalRecords ?? [];
  const scanIdentityDraftProposals = backendContract.mutationBundle.draftOps.identityProposals ?? [];
  const scanIdentityCommitPreviewProposals = backendContract.commitPreview.identityProposalRecords ?? [];
  const scanIdentityProposalTypes = new Set(scanIdentityProposalRecords.map((proposal) => proposal.type));
  const deskLampIdentityObservation = productIdentityBackend.observationInbox.observations.find((observation) =>
    observation.id === "identity-obs-desk-lamp-candidate"
  );
  const productLayoutDeskLampObservation = productIdentityLayout.identityObservations.find((observation) =>
    observation.id === "identity-obs-desk-lamp-candidate"
  );
  assert(coordinateRoundTrip.error <= 0.01, "coordinate round trip stays within 1cm", coordinateRoundTrip);
  assert(multiRoundTrip.every((point) => point.error <= 0.01), "multiple coordinate round trips stay within 1cm", multiRoundTrip);
  assert(coordinateSnapshot.frame.unit === "meter", "coordinate frame uses meters", coordinateSnapshot.frame);
  assert(coordinateSnapshot.anchors.length >= 3, "coordinate anchors are modeled", coordinateSnapshot.anchors);
  assert(coordinateSnapshot.anchors.length === backendContract.coordinateFrame.anchors.length, "backend contract exposes same anchor set", backendContract.coordinateFrame.anchors);
  assert(afterLayout.metrics.coordinateHealth.bestAnchorErrorCm <= coordinateSnapshot.frame.accuracyBudgetCm.markerAnchor, "best anchor error stays inside marker budget", afterLayout.metrics.coordinateHealth);
  assert(coordinateSnapshot.containerFrames.length >= 3, "container local frames are modeled", coordinateSnapshot.containerFrames);
  assert(initialWaterBottle.coordinate.semanticFrame === "desk-right-side", "initial desk item uses container-local frame", initialWaterBottle.coordinate);
  assert(initialContainerRoundTrip && Math.abs(initialContainerRoundTrip.reconstructed.x - initialContainerRoundTrip.world.x) <= 0.02 && Math.abs(initialContainerRoundTrip.reconstructed.z - initialContainerRoundTrip.world.z) <= 0.02, "container-local coordinate reconstructs room world coordinate", initialContainerRoundTrip);
  assert(Math.abs(initialWaterBottle.coordinate.local.x) <= initialWaterBottle.coordinate.containerSize.width / 2 && Math.abs(initialWaterBottle.coordinate.local.z) <= initialWaterBottle.coordinate.containerSize.depth / 2, "container-local coordinate fits inside container footprint", initialWaterBottle.coordinate);
  assert(notThereDraft?.status === "needs_corrected_place", "Not there creates a correction draft", notThereDraft);
  assert(contradictedWaterBottle.currentPlacement.status === "contradicted", "Not there marks prior placement contradicted", contradictedWaterBottle.currentPlacement);
  assert(notThereBackend.observationInbox.observations.some((item) => item.type === "negative_placement_evidence"), "backend contract exposes negative placement evidence", notThereBackend.observationInbox);
  assert(correctedSnapshot?.status === "corrected", "corrected placement closes the Not there draft", correctedSnapshot);
  assert(afterMove.currentPlacement.status === "confirmed" && afterMove.currentPlacement.source === "corrected placement", "item move records corrected placement after Not there", afterMove.currentPlacement);
  assert(correctedBackend.commitPreview.correctionOps.some((op) => op.status === "corrected"), "backend contract exposes corrected placement op", correctedBackend.commitPreview.correctionOps);
  assert(correctionCommit?.type === "placement_correction" && correctionCommit.ops.some((op) => op.type === "create_placement"), "correction commit creates ledger entry", correctionCommit);
  assert(futureLocateWaterBottle.currentPlacement.commitId === correctionCommit?.id && futureLocateWaterBottle.currentPlacement.source === "corrected placement", "future locate answer uses committed corrected placement", futureLocateWaterBottle.currentPlacement);
  assert(Array.isArray(committedBackend.mutationBundle?.observationRecords) && Array.isArray(committedBackend.mutationBundle?.draftOps?.placementOps) && Array.isArray(committedBackend.mutationBundle?.resultingRecords?.placementRecordIds), "backend contract exposes mutation bundle shape", committedBackend.mutationBundle);
  assert(movedCoordinate.frameId === "bedroom-local-v1" && movedCoordinate.world.x === afterMove.x, "item coordinate record tracks room-local world coordinates", movedCoordinate);
  assert(["Selection", "Retrieval Plan", "Spatial Frame", "Layout Health", "Scan Diff", "Contract"].every((label) => panelSections.includes(label)), "right panel is split into stable product scopes", panelSections);
  assert(coordinateSnapshot.mainRoutes.length >= 2, "main routes are modeled", coordinateSnapshot.mainRoutes);
  assert(afterLayout.keepOutZones.length >= 2, "keep-out zones are modeled", afterLayout.keepOutZones);
  assert(afterLayout.interactionZones.length >= 4, "interaction envelopes are modeled", afterLayout.interactionZones);
  assert(Number.isFinite(afterLayout.metrics.coordinateHealth.bestAnchorErrorCm), "coordinate health includes anchor error", afterLayout.metrics.coordinateHealth);
  assert(afterLayout.metrics.containerFit.length >= 3, "container fit checks are modeled", afterLayout.metrics.containerFit);
  assert(afterLayout.metrics.mainPathClearance >= 0, "main path clearance is measured", afterLayout.metrics);
  assert(afterLayout.metrics.usableStorageVolume < afterLayout.metrics.grossStorageVolume, "usable storage is lower than gross storage", afterLayout.metrics);
  assert(
    layoutScenarioCompareFlow.records.length >= 3 &&
      layoutScenarioCompareFlow.records.every((record) =>
        record.readOnly === true &&
        record.commitReady === false &&
        record.current &&
        record.proposed &&
        Number.isFinite(record.deltas?.mainPathClearanceCm) &&
        Number.isFinite(record.deltas?.usableStorageVolume) &&
        Array.isArray(record.patches) &&
        record.patches.length > 0
      ) &&
      layoutScenarioCompareFlow.records.some((record) => record.deltas.usableStorageVolume !== 0),
    "layout scenario compare exposes current proposed metrics and storage delta",
    layoutScenarioCompareFlow.records
  );
  assert(
    layoutScenarioCompareFlow.records.every((record) =>
      record.geometryDiffs?.length === record.patches.length &&
      record.geometryDiffIds?.length === record.geometryDiffs.length &&
      record.geometryDiffs.every((diff) =>
        diff.id === `geomdiff-${record.id}-${diff.furnitureId}` &&
        diff.scenarioId === record.id &&
        diff.before &&
        diff.after &&
        Object.keys(diff.fieldDeltas ?? {}).length > 0 &&
        diff.changedFields.length === Object.keys(diff.fieldDeltas ?? {}).length &&
        diff.readOnly === true &&
        diff.commitReady === false
      )
    ),
    "layout scenarios preserve stable geometry diff ids with before after deltas",
    layoutScenarioCompareFlow.records
  );
  assert(
    layoutScenarioCompareFlow.records.some((record) => record.predictedPlacementImpactCount > 0) &&
      layoutScenarioCompareFlow.records.every((record) =>
        record.predictedPlacementImpacts.length === record.predictedPlacementImpactCount &&
        record.predictedPlacementImpacts.every((impact) =>
          impact.scenarioId === record.id &&
          record.geometryDiffIds.includes(impact.geometryDiffId) &&
          impact.subjectRef?.startsWith("item:") &&
          impact.currentPlacementId &&
          impact.predictedStatus === "draft_stale" &&
          impact.impactScope === "scenario_only" &&
          impact.wouldMutateCanonical === false &&
          impact.reviewAction
        )
      ),
    "layout scenarios expose predicted placement impacts without canonical stale writes",
    layoutScenarioCompareFlow.records.map((record) => ({
      id: record.id,
      impacts: record.predictedPlacementImpacts
    }))
  );
  assert(
    layoutScenarioCompareFlow.records.some((record) =>
      record.predictedSupportSurfaceImpacts.some((impact) => impact.predictedStatus === "requires_recheck")
    ) &&
      layoutScenarioCompareFlow.records.every((record) =>
        record.predictedSupportSurfaceImpacts.length === record.predictedSupportSurfaceImpactCount &&
        record.predictedSupportSurfaceImpacts.every((impact) =>
          impact.scenarioId === record.id &&
          record.geometryDiffIds.includes(impact.geometryDiffId) &&
          impact.surfaceId &&
          impact.beforeWorld &&
          impact.afterWorld &&
          Number.isFinite(impact.shiftCm) &&
          impact.impactScope === "scenario_only" &&
          impact.wouldMutateCanonical === false &&
          impact.reasonCode === "support_surface_pose_would_change"
        )
      ),
    "layout scenarios expose predicted support surface impacts with geometry refs",
    layoutScenarioCompareFlow.records.map((record) => ({
      id: record.id,
      impacts: record.predictedSupportSurfaceImpacts
    }))
  );
  assert(
    layoutScenarioCompareFlow.records.every((record) =>
      record.recommendationReasons.length > 0 &&
      record.recommendationReasonCodes.length === record.recommendationReasons.length &&
      ["review_ready", "needs_tradeoff_review"].includes(record.recommendationStatus) &&
      record.recommendationReasons.every((reason) =>
        reason.code &&
        ["benefit", "cost", "neutral"].includes(reason.sentiment) &&
        Array.isArray(reason.evidenceRefs) &&
        reason.evidenceRefs.length > 0
      )
    ) &&
      layoutScenarioCompareFlow.records.some((record) =>
        record.recommendationReasonCodes.includes("requires_child_placement_review") ||
        record.recommendationReasonCodes.includes("requires_support_surface_recheck")
      ),
    "layout recommendation exposes reason codes evidence refs and tradeoffs",
    layoutScenarioCompareFlow.records.map((record) => ({
      id: record.id,
      status: record.recommendationStatus,
      reasons: record.recommendationReasons
    }))
  );
  assert(
    layoutScenarioCompareFlow.records.every((record) =>
      record.certainty?.scenarioId === record.id &&
      ["needs_capture_before_commit", "high_confidence"].includes(record.certainty.status) &&
      Number.isFinite(record.certainty.score) &&
      record.certainty.checks.length >= 5 &&
      ["coverage", "occlusion", "scaleErrorCm", "driftCm", "bestAnchorErrorCm"].every((metric) =>
        record.certainty.checks.some((check) => check.metric === metric && typeof check.pass === "boolean")
      ) &&
      record.certainty.guidedCapturePrompts.length === record.guidedCapturePrompts.length &&
      record.guidedCapturePrompts.every((prompt) =>
        prompt.scenarioId === record.id &&
        prompt.targetRef &&
        prompt.reasonCode &&
        prompt.sourceMetric &&
        Array.isArray(prompt.geometryDiffIds) &&
        prompt.geometryDiffIds.every((id) => record.geometryDiffIds.includes(id))
      )
    ) &&
      layoutScenarioCompareFlow.records.some((record) =>
        record.certainty.status === "needs_capture_before_commit" &&
        record.guidedCapturePrompts.length > 0
      ),
    "layout scenarios expose scan certainty checks and guided capture prompts",
    layoutScenarioCompareFlow.records.map((record) => ({
      id: record.id,
      certainty: record.certainty,
      prompts: record.guidedCapturePrompts
    }))
  );
  assert(
    layoutScenarioCompareFlow.records.every((record) =>
      record.guidedCapturePrompts.length === 0 ||
      record.recommendationReasons.some((reason) =>
        reason.code === "scan_quality_capture_needed" &&
        record.guidedCapturePrompts.every((prompt) => reason.evidenceRefs.includes(prompt.id) || reason.evidenceRefs.length >= 4)
      )
    ),
    "layout recommendation reasons reference scan quality capture prompts",
    layoutScenarioCompareFlow.records.map((record) => ({
      id: record.id,
      prompts: record.guidedCapturePrompts,
      reasons: record.recommendationReasons
    }))
  );
  assert(
    layoutScenarioCompareFlow.records.every((record) =>
      record.commitGate?.scenarioId === record.id &&
      record.commitGate.status === "blocked" &&
      record.commitGate.canCommit === false &&
      record.commitGate.blockerCount === record.commitGate.blockers.length &&
      record.commitGate.blockingRecordIds.length === record.commitGate.blockers.length &&
      record.commitReady === false &&
      record.commitGate.blockerTypes.length > 0 &&
      record.commitGate.blockers.every((blocker) =>
        blocker.id &&
        blocker.type &&
        blocker.reasonCode &&
        blocker.recordId &&
        Array.isArray(blocker.evidenceRefs) &&
        blocker.evidenceRefs.length > 0 &&
        blocker.action
      )
    ) &&
      ["placement", "support_surface", "scan_quality", "reconstruction", "identity_or_coverage", "privacy"].every((type) =>
        layoutScenarioCompareFlow.records.some((record) => record.commitGate.blockerTypes.includes(type))
      ),
    "layout scenario commit gate merges placement support scan reconstruction identity and privacy blockers",
    layoutScenarioCompareFlow.records.map((record) => ({
      id: record.id,
      gate: record.commitGate
    }))
  );
  assert(
    layoutScenarioDecisionFlow.applyDraft?.scenarioId === "scenario-desk-wall-align" &&
      layoutScenarioDecisionFlow.applyDraft.action === "apply" &&
      layoutScenarioDecisionFlow.applyDraft.status === "blocked" &&
      layoutScenarioDecisionFlow.applyDraft.canApply === false &&
      layoutScenarioDecisionFlow.applyDraft.blockerCount > 0 &&
      layoutScenarioDecisionFlow.applyDraft.blockingRecordIds.length === layoutScenarioDecisionFlow.applyDraft.blockerCount &&
      layoutScenarioDecisionFlow.applyDraft.writesCanonical === false,
    "requesting scenario apply creates blocked decision draft from commit gate",
    layoutScenarioDecisionFlow.applyDraft
  );
  assert(
    layoutScenarioDecisionFlow.backendDecisionAfterApply.draft?.id === layoutScenarioDecisionFlow.applyDraft.id &&
      layoutScenarioDecisionFlow.layoutDecisionAfterApply.draft?.id === layoutScenarioDecisionFlow.applyDraft.id &&
      layoutScenarioDecisionFlow.draftDom?.id === layoutScenarioDecisionFlow.applyDraft.id &&
      layoutScenarioDecisionFlow.draftDom.status === "blocked" &&
      layoutScenarioDecisionFlow.draftDom.canApply === "false",
    "layout scenario apply draft round-trips through panel backend and layout snapshot",
    layoutScenarioDecisionFlow
  );
  assert(
    layoutScenarioDecisionFlow.rejectRecord?.scenarioId === "scenario-entry-rack-flush" &&
      layoutScenarioDecisionFlow.rejectRecord.status === "rejected" &&
      layoutScenarioDecisionFlow.rejectRecord.reason === "entry path feels worse" &&
      layoutScenarioDecisionFlow.rejectRecord.writesCanonical === false &&
      layoutScenarioDecisionFlow.backendDecisionAfterReject.history.some((record) => record.id === layoutScenarioDecisionFlow.rejectRecord.id) &&
      layoutScenarioDecisionFlow.layoutDecisionAfterReject.history.some((record) => record.id === layoutScenarioDecisionFlow.rejectRecord.id) &&
      layoutScenarioDecisionFlow.historyDom?.id === layoutScenarioDecisionFlow.rejectRecord.id,
    "rejecting layout scenario records decision history without applying geometry",
    layoutScenarioDecisionFlow
  );
  assert(
    layoutScenarioDecisionFlow.readOnlyState.furnitureUnchanged &&
      layoutScenarioDecisionFlow.readOnlyState.ledgerCountAfter === layoutScenarioDecisionFlow.readOnlyState.ledgerCountBefore &&
      layoutScenarioDecisionFlow.readOnlyState.geometryOpsAfter === layoutScenarioDecisionFlow.readOnlyState.geometryOpsBefore,
    "layout scenario decisions do not mutate furniture ledger or geometry ops while blocked",
    layoutScenarioDecisionFlow.readOnlyState
  );
  assert(
    layoutScenarioFocusFlow.focus?.scenarioId === "scenario-shelf-vertical-storage" &&
      layoutScenarioFocusFlow.focus.geometryDiffIds.length > 0 &&
      layoutScenarioFocusFlow.focus.commitGateId &&
      layoutScenarioFocusFlow.layoutFocus?.id === layoutScenarioFocusFlow.focus.id &&
      layoutScenarioFocusFlow.backendFocus?.id === layoutScenarioFocusFlow.focus.id,
    "layout scenario focus round-trips through backend and layout snapshot",
    layoutScenarioFocusFlow
  );
  assert(
    layoutScenarioFocusFlow.focusDom?.id === layoutScenarioFocusFlow.focus.id &&
      layoutScenarioFocusFlow.focusDom.scenarioId === "scenario-shelf-vertical-storage" &&
      layoutScenarioFocusFlow.focusedRow?.scenarioId === "scenario-shelf-vertical-storage" &&
      layoutScenarioFocusFlow.focusedRow.focused === "true",
    "layout scenario focus is visible in panel row and focus summary",
    layoutScenarioFocusFlow
  );
  assert(
    layoutScenarioFocusFlow.ghosts.length >= 1 &&
      layoutScenarioFocusFlow.ghosts.every((ghost) =>
        ghost.scenarioId === "scenario-shelf-vertical-storage" &&
        ghost.focused === "true" &&
        layoutScenarioFocusFlow.focus.geometryDiffIds.includes(ghost.geometryDiffId)
      ),
    "2D plan scenario ghosts follow focused scenario",
    layoutScenarioFocusFlow.ghosts
  );
  assert(
    layoutScenarioFocusFlow.locate?.placementEvidence?.focusedLayoutScenarioId === "scenario-shelf-vertical-storage" &&
      layoutScenarioFocusFlow.locate.placementEvidence.layoutScenarioFocusId === layoutScenarioFocusFlow.focus.id,
    "locate answer carries focused layout scenario context",
    layoutScenarioFocusFlow.locate
  );
  assert(
    layoutScenarioReplayFlow.fixtures.length === layoutScenarioCompareFlow.records.length &&
      layoutScenarioReplayFlow.fixtures.every((fixture) =>
        fixture.fixtureVersion === "layout-scenario-fixture-v1" &&
        fixture.outputPolicy === "deterministic_read_only" &&
        fixture.writesCanonical === false &&
        fixture.replayKey &&
        fixture.comparedPayload.geometryDiffIds.length > 0 &&
        fixture.comparedPayload.commitGate.blockerTypes.length > 0
      ),
    "layout scenario deterministic fixtures freeze decision-critical fields",
    layoutScenarioReplayFlow.fixtures
  );
  assert(
    layoutScenarioReplayFlow.replay?.scenarioId === "scenario-shelf-vertical-storage" &&
      layoutScenarioReplayFlow.replay.matches === true &&
      layoutScenarioReplayFlow.replay.status === "matched" &&
      layoutScenarioReplayFlow.replay.replayKey === layoutScenarioReplayFlow.replay.replayedKey &&
      layoutScenarioReplayFlow.replay.mismatchFields.length === 0 &&
      layoutScenarioReplayFlow.replay.comparedFields.includes("commitGate") &&
      layoutScenarioReplayFlow.replay.comparedFields.includes("certainty"),
    "layout scenario fixture replay is deterministic for focused scenario",
    layoutScenarioReplayFlow.replay
  );
  assert(
    layoutScenarioReplayFlow.replayByFixture?.fixtureId === layoutScenarioReplayFlow.replay?.fixtureId &&
      layoutScenarioReplayFlow.replayByFixture.matches === true,
    "layout scenario fixture can replay by fixture id",
    layoutScenarioReplayFlow.replayByFixture
  );
  assert(
    layoutScenarioReplayFlow.layoutFixtures.length === layoutScenarioReplayFlow.fixtures.length &&
      layoutScenarioReplayFlow.backendFixtures.length === layoutScenarioReplayFlow.fixtures.length &&
      layoutScenarioReplayFlow.layoutReplay?.scenarioId === "scenario-shelf-vertical-storage" &&
      layoutScenarioReplayFlow.backendReplay?.scenarioId === "scenario-shelf-vertical-storage" &&
      layoutScenarioReplayFlow.layoutReplay.matches === true &&
      layoutScenarioReplayFlow.backendReplay.matches === true,
    "layout scenario fixtures and replay round-trip through backend and layout snapshot",
    layoutScenarioReplayFlow
  );
  assert(
    layoutScenarioReplayFlow.readOnlyState.furnitureUnchanged &&
      layoutScenarioReplayFlow.readOnlyState.placementsUnchanged &&
      layoutScenarioReplayFlow.readOnlyState.ledgerCountAfter === layoutScenarioReplayFlow.readOnlyState.ledgerCountBefore &&
      layoutScenarioReplayFlow.readOnlyState.geometryOpsAfter === layoutScenarioReplayFlow.readOnlyState.geometryOpsBefore &&
      layoutScenarioReplayFlow.readOnlyState.placementOpsAfter === layoutScenarioReplayFlow.readOnlyState.placementOpsBefore,
    "layout scenario fixture replay does not mutate canonical furniture placement or write ops",
    layoutScenarioReplayFlow.readOnlyState
  );
  assert(
    JSON.stringify(endToEndDemoFlow.stageOrder) === JSON.stringify([
      "scan_capture",
      "reconstruction_job",
      "scenario_compare",
      "scenario_gate",
      "anchor_commit",
      "scenario_decision",
      "locate_readback"
    ]) &&
      endToEndDemoFlow.stageIds.length === 7 &&
      endToEndDemoFlow.record.reviewCommitPolicy === "proposal_first_no_auto_truth_writes",
    "end-to-end demo trace exposes ordered proposal-first stages",
    endToEndDemoFlow.record
  );
  assert(
    endToEndDemoFlow.record.allReviewBoundariesPresent === true &&
      endToEndDemoFlow.proposalOnlyProof.reconstructionWritesCanonical === false &&
      endToEndDemoFlow.proposalOnlyProof.scenarioReplayWritesCanonical === false &&
      endToEndDemoFlow.proposalOnlyProof.scenarioDecisionWritesCanonical === false &&
      endToEndDemoFlow.proposalOnlyProof.scenarioGateStatus === "blocked" &&
      endToEndDemoFlow.proposalOnlyProof.layoutScenarioApplyBlocked === true,
    "end-to-end demo keeps scan reconstruction and scenario application behind review gates",
    endToEndDemoFlow.proposalOnlyProof
  );
  assert(
    ["commit_scan_geometry_create", "commit_scan_geometry_update"].some((type) => endToEndDemoFlow.writeTypes.includes(type)) &&
      endToEndDemoFlow.writeTypes.includes("create_placement") &&
      endToEndDemoFlow.writeTypes.includes("commit_support_surface_placement") &&
      endToEndDemoFlow.writeTypes.includes("commit_anchor_edit") &&
      endToEndDemoFlow.writeTypes.includes("commit_identity_resolution") &&
      endToEndDemoFlow.commitIds.scanReview &&
      endToEndDemoFlow.commitIds.placementCorrection &&
      endToEndDemoFlow.commitIds.supportPlacement &&
      endToEndDemoFlow.commitIds.anchorEdit,
    "end-to-end demo trace names committed Place Graph write types",
    {
      writeTypes: endToEndDemoFlow.writeTypes,
      commitIds: endToEndDemoFlow.commitIds
    }
  );
  assert(
    endToEndDemoFlow.locateEvidence?.latestAnchorCommitId === endToEndDemoFlow.commitIds.anchorEdit &&
      endToEndDemoFlow.locateEvidence?.focusedLayoutScenarioId === "scenario-shelf-vertical-storage" &&
      endToEndDemoFlow.locateEvidence?.coordinateFrameId === "bedroom-local-v1" &&
      endToEndDemoFlow.record.locateReadback?.status === "answered" &&
      endToEndDemoFlow.record.locateReadback?.itemId === "water-bottle",
    "end-to-end demo locate readback carries committed anchor and preview scenario context",
    endToEndDemoFlow.locateEvidence
  );
  assert(
    endToEndDemoFlow.privacyAndUnknownPolicy.privateRegionsSearchable === false &&
      endToEndDemoFlow.privacyAndUnknownPolicy.unknownDoesNotMeanEmpty === true &&
      endToEndDemoFlow.privacyAndUnknownPolicy.privateProposalIds.length > 0 &&
      endToEndDemoFlow.privacyAndUnknownPolicy.unknownObservationIds.length > 0,
    "end-to-end demo preserves private and unknown scan boundaries",
    endToEndDemoFlow.privacyAndUnknownPolicy
  );
  assert(
    endToEndDemoFlow.layoutRecord?.id === endToEndDemoFlow.record.id &&
      endToEndDemoFlow.backendRecord?.id === endToEndDemoFlow.record.id &&
      endToEndDemoFlow.layoutRecord.allReviewBoundariesPresent === endToEndDemoFlow.record.allReviewBoundariesPresent &&
      endToEndDemoFlow.backendRecord.allReviewBoundariesPresent === endToEndDemoFlow.record.allReviewBoundariesPresent,
    "end-to-end demo trace round-trips through backend and layout snapshot",
    endToEndDemoFlow
  );
  assert(
    layoutScenarioCompareFlow.readOnlyState.furnitureUnchangedAfterRecords &&
      layoutScenarioCompareFlow.readOnlyState.furnitureUnchangedAfterDom &&
      layoutScenarioCompareFlow.readOnlyState.placementsUnchangedAfterDom &&
      layoutScenarioCompareFlow.readOnlyState.commitCountAfter === layoutScenarioCompareFlow.readOnlyState.commitCountBefore &&
      layoutScenarioCompareFlow.readOnlyState.geometryOpsAfter === layoutScenarioCompareFlow.readOnlyState.geometryOpsBefore &&
      layoutScenarioCompareFlow.readOnlyState.placementOpsAfter === layoutScenarioCompareFlow.readOnlyState.placementOpsBefore,
    "layout scenario compare is preview-only and does not mutate furniture placement or write ops",
    layoutScenarioCompareFlow.readOnlyState
  );
  assert(
      layoutScenarioCompareFlow.backendRecords.length === layoutScenarioCompareFlow.records.length &&
      layoutScenarioCompareFlow.layoutRecords.length === layoutScenarioCompareFlow.records.length &&
      layoutScenarioCompareFlow.scenarioDom.rows.length === layoutScenarioCompareFlow.records.length &&
      layoutScenarioCompareFlow.scenarioDom.rows.every((row) => row.readOnly === "true" && row.commitReady === "false") &&
      layoutScenarioCompareFlow.scenarioDom.rows.every((row) => row.geometryDiffIds.length > 0 && row.predictedImpactCount >= 0) &&
      layoutScenarioCompareFlow.scenarioDom.rows.every((row) => row.supportImpactCount >= 0 && row.reasonCodes.length > 0 && row.recommendationStatus) &&
      layoutScenarioCompareFlow.scenarioDom.rows.every((row) => row.certaintyStatus && row.certaintyScore >= 0 && row.capturePromptCount >= 0) &&
      layoutScenarioCompareFlow.scenarioDom.rows.every((row) =>
        row.commitGateId &&
        row.commitGateStatus === "blocked" &&
        row.commitBlockerCount > 0 &&
        row.commitBlockerTypes.length > 0
      ) &&
      ["placement", "support_surface", "scan_quality", "reconstruction", "identity_or_coverage", "privacy"].every((type) =>
        layoutScenarioCompareFlow.scenarioDom.rows.some((row) => row.commitBlockerTypes.includes(type))
      ) &&
      layoutScenarioCompareFlow.backendRecords.some((record) => record.recommended || record.rank === 1),
    "layout scenario compare round-trips through DOM layout snapshot and backend preview",
    {
      records: layoutScenarioCompareFlow.records,
      layoutRecords: layoutScenarioCompareFlow.layoutRecords,
      backendRecords: layoutScenarioCompareFlow.backendRecords,
      dom: layoutScenarioCompareFlow.scenarioDom.rows
    }
  );
  assert(
    layoutScenarioCompareFlow.scenarioDom.ghosts.length >= 1 &&
      layoutScenarioCompareFlow.backendGhosts.length === layoutScenarioCompareFlow.scenarioDom.ghosts.length &&
      layoutScenarioCompareFlow.scenarioDom.ghosts.every((ghost) =>
        ghost.readOnly === "true" &&
        ghost.commitReady === "false" &&
        ghost.geometryDiffId &&
        layoutScenarioCompareFlow.backendGhosts.some((backendGhost) => backendGhost.geometryDiffId === ghost.geometryDiffId)
      ),
    "2D plan renders read-only layout scenario ghosts",
    {
      ghosts: layoutScenarioCompareFlow.scenarioDom.ghosts,
      backendGhosts: layoutScenarioCompareFlow.backendGhosts
    }
  );
  assert(afterLayout.scanSession.coverage >= 0.7, "scan session coverage is visible", afterLayout.scanSession);
  assert(afterLayout.proposals.every((proposal) => proposal.confidenceReason), "proposals expose confidence reasons", afterLayout.proposals);
  assert(scanPipelineSnapshot.options.length >= 4, "scan pipeline options include lightweight and reconstruction routes", scanPipelineSnapshot);
  assert(scanPipelineSnapshot.active.id === "feed-forward-3d", "scan pipeline can switch to feed-forward 3D", scanPipelineSnapshot.active);
  assert(
    scanPipelineSnapshot.keyframeCoverage.length >= 7 &&
      scanPipelineSnapshot.keyframeCoverage.every((record) =>
        record.id &&
        record.frameCount >= 0 &&
        Array.isArray(record.frameIds) &&
        ["covered", "partial"].includes(record.status) &&
        typeof record.needsCapture === "boolean"
      ) &&
      scanPipelineSnapshot.keyframeCoverage.some((record) => record.status === "partial") &&
      scanPipelineSnapshot.keyframeCoverage.some((record) => record.status === "covered"),
    "scan pipeline exposes keyframe coverage requirements",
    scanPipelineSnapshot.keyframeCoverage
  );
  assert(
    scanPipelineSnapshot.reconstructionJob?.pipelineId === scanPipelineSnapshot.active.id &&
      scanPipelineSnapshot.reconstructionJob.outputPolicy === "proposal_only" &&
      scanPipelineSnapshot.reconstructionJob.commitReady === false &&
      scanPipelineSnapshot.reconstructionJob.writesCanonical === false &&
      scanPipelineSnapshot.reconstructionJob.sourceFrameIds.length === scanPipelineSnapshot.reconstructionJob.selectedFrameCount &&
      scanPipelineSnapshot.reconstructionJob.cameraPath.length === scanPipelineSnapshot.reconstructionJob.selectedFrameCount &&
      scanPipelineSnapshot.reconstructionJob.roomEnvelope?.polygon?.length >= 4 &&
      scanPipelineSnapshot.reconstructionJob.furnitureCuboids.length >= mixedScanDraft.furniture.length &&
      scanPipelineSnapshot.reconstructionJob.furnitureCuboids.every((cuboid) =>
        cuboid.proposalOnly &&
        Array.isArray(cuboid.sourceFrameIds) &&
        cuboid.sourceFrameIds.length > 0 &&
        Number.isFinite(cuboid.anchorAlignedErrorCm)
      ),
    "scan pipeline exposes proposal-only reconstruction job contract",
    scanPipelineSnapshot.reconstructionJob
  );
  assert(
    backendContract.scanSession.reconstructionJob?.id === scanPipelineSnapshot.reconstructionJob.id &&
      backendContract.scanSession.keyframeCoverage.length === scanPipelineSnapshot.keyframeCoverage.length &&
      mixedScanDraft.reconstructionJob?.id === scanPipelineSnapshot.reconstructionJob.id &&
      mixedScanDraft.keyframeCoverage.length === scanPipelineSnapshot.keyframeCoverage.length,
    "backend and layout snapshots expose reconstruction job and keyframe coverage",
    {
      backend: backendContract.scanSession.reconstructionJob,
      layout: mixedScanDraft.reconstructionJob
    }
  );
  assert(
    reconstructionDom.job?.id === scanPipelineSnapshot.reconstructionJob.id &&
      reconstructionDom.job.route === scanPipelineSnapshot.reconstructionJob.route &&
      reconstructionDom.job.outputPolicy === "proposal_only" &&
      reconstructionDom.job.commitReady === "false" &&
      reconstructionDom.coverage?.totalCount === scanPipelineSnapshot.keyframeCoverage.length &&
      reconstructionDom.coverage.coveredCount === scanPipelineSnapshot.keyframeCoverage.filter((record) => record.status === "covered").length,
    "scan panel renders reconstruction job and keyframe coverage contract",
    reconstructionDom
  );
  assert(
    anchorEditFlow.draft?.id === "anchor-draft-anchor-desk-edge" &&
      anchorEditFlow.draft.anchorId === "anchor-desk-edge" &&
      anchorEditFlow.draft.status === "draft" &&
      anchorEditFlow.draft.commitReady === false &&
      anchorEditFlow.draft.writesCanonical === false &&
      anchorEditFlow.draft.changedFields.includes("x") &&
      anchorEditFlow.draft.changedFields.includes("errorCm") &&
      anchorEditFlow.draft.reconstructionJobStatusAfterEdit === "stale_until_recomputed",
    "anchor edit preview creates a draft without canonical writes",
    anchorEditFlow.draft
  );
  assert(
    anchorEditFlow.draft.staleGeometryRecords.length >= 2 &&
      anchorEditFlow.draft.staleGeometryRecords.every((record) =>
        record.anchorDraftId === anchorEditFlow.draft.id &&
        record.anchorId === "anchor-desk-edge" &&
        record.predictedStatus === "scan_geometry_stale" &&
        record.impactScope === "anchor_draft_only" &&
        record.wouldMutateCanonical === false &&
        record.reconstructionJobId
      ),
    "anchor edit marks scan-derived geometry stale in draft scope",
    anchorEditFlow.draft.staleGeometryRecords
  );
  assert(
    anchorEditFlow.backendDraft?.id === anchorEditFlow.draft.id &&
      anchorEditFlow.layoutDraft?.id === anchorEditFlow.draft.id &&
      anchorEditFlow.backendStaleGeometry.length === anchorEditFlow.draft.staleGeometryRecords.length &&
      anchorEditFlow.dom?.id === anchorEditFlow.draft.id &&
      anchorEditFlow.dom.commitReady === "false" &&
      anchorEditFlow.dom.writesCanonical === "false" &&
      anchorEditFlow.dom.staleGeometryCount === anchorEditFlow.draft.staleGeometryRecords.length,
    "anchor edit draft round-trips through panel backend and layout snapshot",
    anchorEditFlow
  );
  assert(
    anchorEditFlow.readOnlyState.anchorsUnchanged &&
      anchorEditFlow.readOnlyState.furnitureUnchanged &&
      anchorEditFlow.readOnlyState.commitCountAfter === anchorEditFlow.readOnlyState.commitCountBefore &&
      anchorEditFlow.readOnlyState.geometryOpsAfter === anchorEditFlow.readOnlyState.geometryOpsBefore,
    "anchor edit preview does not mutate anchors furniture or write ops",
    anchorEditFlow.readOnlyState
  );
  assert(
    anchorResolutionFlow.commit?.type === "anchor_edit" &&
      anchorResolutionFlow.anchorChanged &&
      anchorResolutionFlow.commitLedgerCountAfter === anchorResolutionFlow.commitLedgerCountBefore + 1 &&
      anchorResolutionFlow.commit.ops.some((op) => op.type === "commit_anchor_edit") &&
      anchorResolutionFlow.commit.ops.some((op) => op.type === "mark_scan_geometry_stale") &&
      anchorResolutionFlow.commit.reconstructionRefreshProposal?.outputPolicy === "proposal_only",
    "committing anchor edit appends anchor ledger entry and refresh proposal",
    anchorResolutionFlow.commit
  );
  assert(
    anchorResolutionFlow.historyAfterCommit.some((record) =>
      record.status === "committed" &&
      record.commitId === anchorResolutionFlow.commit.id &&
      record.reconstructionRefreshProposal?.id === anchorResolutionFlow.commit.reconstructionRefreshProposal.id
    ) &&
      anchorResolutionFlow.refreshProposalsAfterCommit.some((proposal) =>
        proposal.id === anchorResolutionFlow.commit.reconstructionRefreshProposal.id &&
        proposal.commitReady === false &&
        proposal.writesCanonical === false &&
        proposal.staleGeometryRecordIds.length > 0
      ) &&
      anchorResolutionFlow.layoutRefreshProposalsAfterCommit.some((proposal) => proposal.id === anchorResolutionFlow.commit.reconstructionRefreshProposal.id) &&
      anchorResolutionFlow.historyDomAfterCommit.some((row) => row.status === "committed" && row.refreshProposalId === anchorResolutionFlow.commit.reconstructionRefreshProposal.id),
    "committed anchor edit history exposes reconstruction refresh proposal across surfaces",
    anchorResolutionFlow
  );
  assert(
    anchorResolutionFlow.reject?.status === "rejected" &&
      anchorResolutionFlow.reject.rejectedReason === "needs better wall capture" &&
      anchorResolutionFlow.anchorsUnchangedAfterReject &&
      anchorResolutionFlow.historyAfterReject.some((record) =>
        record.status === "rejected" &&
        record.id === anchorResolutionFlow.reject.id &&
        !record.reconstructionRefreshProposal
      ) &&
      anchorResolutionFlow.historyDomAfterReject.some((row) => row.status === "rejected"),
    "rejecting anchor edit records rejection without changing anchors or refresh proposals",
    anchorResolutionFlow
  );
  assert(
    anchorResolutionFlow.committedAnchor.commitId === anchorResolutionFlow.commit.id &&
      anchorResolutionFlow.committedAnchor.verificationStatus === "anchor_adjusted_committed" &&
      anchorResolutionFlow.backendAnchorRecord?.commitId === anchorResolutionFlow.commit.id &&
      anchorResolutionFlow.backendAnchorRecord?.verificationStatus === "anchor_adjusted_committed",
    "committed anchor readback is exposed on coordinate and backend anchor records",
    {
      coordinate: anchorResolutionFlow.committedAnchor,
      backend: anchorResolutionFlow.backendAnchorRecord
    }
  );
  assert(
    anchorResolutionFlow.scenarioAfterCommit.length >= 3 &&
      anchorResolutionFlow.scenarioAfterCommit.every((scenario) =>
        scenario.certainty.latestAnchorCommitId === anchorResolutionFlow.commit.id &&
        scenario.certainty.anchorCommitIds.includes(anchorResolutionFlow.commit.id)
      ),
    "layout scenario certainty references latest committed anchor edit",
    anchorResolutionFlow.scenarioAfterCommit.map((scenario) => ({
      id: scenario.id,
      certainty: scenario.certainty
    }))
  );
  assert(
    anchorResolutionFlow.locateAfterCommit?.placementEvidence?.latestAnchorCommitId === anchorResolutionFlow.commit.id &&
      anchorResolutionFlow.locateAfterCommit.placementEvidence.coordinateFrameId === "bedroom-local-v1" &&
      anchorResolutionFlow.locateAfterCommit.placementEvidence.scanSessionId === "scan-bedroom-001",
    "locate answer readback carries committed anchor context",
    anchorResolutionFlow.locateAfterCommit
  );
  assert(
    scanPipelineSnapshot.identityProducer?.id === "scan-identity-producer-v1" &&
      scanPipelineSnapshot.identityProducer.stage === "observations" &&
      scanPipelineSnapshot.identityProducer.writePolicy === "observation_only" &&
      scanPipelineSnapshot.identityProducer.observationCount >= 5 &&
      ["item_candidate_seen", "container_contents_seen", "container_seen_empty", "container_region_unknown", "privacy_redacted_region"].every((type) =>
        scanPipelineSnapshot.identityProducer.observationTypes.includes(type)
      ),
    "scan pipeline exposes identity producer summary",
    scanPipelineSnapshot.identityProducer
  );
  assert(backendContract.observationInbox.stages.includes("commit"), "backend contract exposes capture-to-commit stages", backendContract.observationInbox);
  assert(backendContract.scanSession.pipeline === scanPipelineSnapshot.active.id, "backend scan session matches active pipeline", backendContract.scanSession);
  assert(
    scanIdentityObservations.length >= 5 &&
      ["item_candidate_seen", "container_contents_seen", "container_seen_empty", "container_region_unknown", "privacy_redacted_region"].every((type) => scanIdentityTypes.has(type)) &&
      scanIdentityObservations.every((observation) =>
        (observation.containerId || observation.containerHintId || observation.regionContainerRef) &&
        observation.regionId &&
        observation.candidateKind &&
        observation.visibilityState &&
        observation.privacyStatus &&
        observation.resolutionRequired &&
        Array.isArray(observation.priorItemIds)
      ),
    "backend observation inbox exposes item and container identity observations",
    scanIdentityObservations
  );
  assert(
    scanIdentityMutationRecords.length === scanIdentityObservations.length &&
      scanIdentityMutationRecords.some((record) => record.type === "container_seen_empty" && record.visibilityState === "seen-empty" && record.emptyEvidence === true) &&
      scanIdentityMutationRecords.some((record) => record.type === "privacy_redacted_region" && record.privacyStatus === "private") &&
      scanIdentityMutationRecords.some((record) => record.type === "container_region_unknown" && record.visibilityState === "occluded"),
    "mutation bundle carries identity observation records for unknown and private scan regions",
    scanIdentityMutationRecords
  );
  assert(
    scanIdentityObservations.every((observation) =>
      Array.isArray(observation.mapsTo) &&
      observation.mapsTo.length === 0 &&
      !observation.targetId &&
      !observation.placementId &&
      observation.status === "produced"
    ),
    "scan identity observations remain pre-truth and do not bind canonical records",
    scanIdentityObservations
  );
  assert(
    scanIdentityObservations.every((observation) =>
      observation.worldPoseCache === undefined &&
      observation.world === undefined &&
      observation.x === undefined &&
      observation.z === undefined
    ) &&
      scanIdentityObservations
        .filter((observation) => !observation.containerId)
        .every((observation) => observation.containerHintId && observation.regionContainerRef),
    "container-level identity observations do not invent room-level coordinates",
    scanIdentityObservations
  );
  assert(
    scanIdentityProposalRecords.length === scanIdentityObservations.length &&
      scanIdentityDraftProposals.length === scanIdentityProposalRecords.length &&
      scanIdentityCommitPreviewProposals.length === scanIdentityProposalRecords.length &&
      ["item_identity_match", "item_identity_merge", "container_seen_empty", "container_contents_unknown", "privacy_hold"].every((type) =>
        scanIdentityProposalTypes.has(type)
      ) &&
      scanIdentityProposalRecords.every((proposal) =>
        proposal.observationIds?.length === 1 &&
        scanIdentityObservations.some((observation) => observation.id === proposal.observationIds[0]) &&
        proposal.requiredResolution &&
        Array.isArray(proposal.allowedActions) &&
        proposal.allowedActions.length > 0 &&
        proposal.commitEffect &&
        proposal.commitReady === false &&
        proposal.readOnlyInV18 === true &&
        proposal.targetId === null
      ),
    "identity observations derive match create merge and coverage proposal contracts",
    scanIdentityProposalRecords
  );
  assert(
    backendContract.commitPreview.identityCommitOps.length === 0 &&
      scanIdentityProposalRecords.every((proposal) => proposal.status === "proposal_pending") &&
      !backendContract.mutationBundle.draftOps.geometryOps.some((op) => /^identity/.test(op.type ?? op.op ?? "")) &&
      !backendContract.mutationBundle.draftOps.placementOps.some((op) => /^identity/.test(op.type ?? op.op ?? "")),
    "identity proposal contracts stay read-only with no commit ops in V18",
    {
      identityCommitOps: backendContract.commitPreview.identityCommitOps,
      geometryOps: backendContract.mutationBundle.draftOps.geometryOps,
      placementOps: backendContract.mutationBundle.draftOps.placementOps
    }
  );
  assert(
    identityProposalDom.length === scanIdentityProposalRecords.length &&
      identityProposalDom.every((row) =>
        row.id &&
        row.observationId &&
        row.resolutionRequired &&
        row.visibilityState &&
        row.privacyStatus &&
        row.buttonLabels.includes("Review") &&
        !row.hasAccept &&
        !row.hasReject &&
        !row.hasCommit
      ),
    "scan diff renders identity proposal rows without accept reject or commit controls",
    identityProposalDom
  );
  assert(
    identityReviewFlow.reviewClicked &&
      identityReviewFlow.afterReview.selectedIdentityProposalId === identityReviewFlow.proposalId &&
      identityReviewFlow.afterReview.selectedIdentityObservationId === "identity-obs-desk-lamp-candidate" &&
      identityReviewFlow.afterReview.identityCommitOps.length === 0 &&
      identityReviewFlow.afterReview.resolutionDrafts.length === 0,
    "identity proposal review focuses selected observation without creating a resolution draft",
    identityReviewFlow.afterReview
  );
  assert(
    identityReviewFlow.actionClicked &&
      identityReviewFlow.afterAction.selectedIdentityProposalId === identityReviewFlow.proposalId &&
      identityReviewFlow.afterAction.resolutionDrafts.some((draft) =>
        draft.proposalId === identityReviewFlow.proposalId &&
        draft.action === "match_existing" &&
        draft.status === "drafted" &&
        draft.commitReady === false
      ) &&
      identityReviewFlow.afterAction.backendResolutionDrafts.some((draft) =>
        draft.proposalId === identityReviewFlow.proposalId &&
        draft.action === "match_existing"
      ) &&
      identityReviewFlow.afterAction.proposalRecord?.resolutionDraft?.action === "match_existing" &&
      identityReviewFlow.afterAction.identityCommitOps.length === 0 &&
      JSON.stringify(identityReviewFlow.geometryStatusesBefore) === JSON.stringify(identityReviewFlow.geometryStatusesAfter) &&
      identityReviewFlow.afterAction.activeRow?.active &&
      identityReviewFlow.afterAction.activeRow?.resolutionAction === "match_existing" &&
      !identityReviewFlow.afterAction.activeRow?.hasAccept &&
      !identityReviewFlow.afterAction.activeRow?.hasReject,
    "identity proposal action creates local resolution draft without canonical commit",
    identityReviewFlow
  );
  assert(
    identityReviewFlow.commitClicked &&
      identityReviewFlow.afterCommit.identityCommitOps.length === 1 &&
      identityReviewFlow.afterCommit.identityCommitOps.some((op) =>
        op.type === "commit_identity_resolution" &&
        op.proposalId === identityReviewFlow.proposalId &&
        op.observationId === "identity-obs-desk-lamp-candidate" &&
        op.action === "match_existing" &&
        op.status === "committed"
      ) &&
      identityReviewFlow.afterCommit.commitLedgerEntries.length === identityReviewFlow.ledgerCountBeforeCommit + 1 &&
      identityReviewFlow.afterCommit.commitLedgerEntries[0]?.type === "scan_identity_resolution" &&
      identityReviewFlow.afterCommit.commitLedgerEntries[0]?.proposalId === identityReviewFlow.proposalId &&
      identityReviewFlow.afterCommit.backendResolutionDrafts.some((draft) =>
        draft.proposalId === identityReviewFlow.proposalId &&
        draft.status === "committed" &&
        draft.commitId === identityReviewFlow.afterCommit.commitLedgerEntries[0]?.id
      ) &&
      identityReviewFlow.afterCommit.proposalRecord?.resolutionDraft?.status === "committed" &&
      !identityReviewFlow.afterCommit.geometryOps.some((op) => /^commit_identity|^commit_coverage/.test(op.type ?? op.op ?? "")) &&
      !identityReviewFlow.afterCommit.placementOps.some((op) => /^commit_identity|^commit_coverage/.test(op.type ?? op.op ?? "")) &&
      JSON.stringify(identityReviewFlow.geometryStatusesBefore) === JSON.stringify(identityReviewFlow.geometryStatusesAfterCommit),
    "identity resolution draft commits atomic identity ledger without geometry or placement writes",
    identityReviewFlow.afterCommit
  );
  assert(
    identityProducerDom?.producerId === "scan-identity-producer-v1" &&
      identityProducerDom.observationCount === scanPipelineSnapshot.identityProducer.observationCount &&
      identityProducerDom.observationTypes.includes("item_candidate_seen"),
    "scan panel surfaces identity producer count and types",
    identityProducerDom
  );
  assert(
    deskLampIdentityObservation?.priorItemIds?.includes(productItem?.id) &&
      deskLampIdentityObservation.priorMatches.some((match) => match.id === productItem?.id && /product prior/.test(match.reason)) &&
      productLayoutDeskLampObservation?.priorItemIds?.includes(productItem?.id),
    "product-created item priors participate in scan identity matching",
    {
      productItem,
      observation: deskLampIdentityObservation,
      layoutObservation: productLayoutDeskLampObservation
    }
  );
  assert(
    ["bottle_cylinder", "shoe_pair", "folded_cloth", "desk_lamp", "plug_charger", "card_slab", "book_stack", "soft_bag"].every((kind) =>
      productIdentityLayout.renderedItems.some((item) => item.meshArchetype?.resolved === kind)
    ),
    "3D item meshes resolve dimension-scaled object archetypes",
    productIdentityLayout.renderedItems.map((item) => ({
      id: item.id,
      label: item.label,
      type: item.type,
      archetype: item.meshArchetype?.resolved
    }))
  );
  assert(
    productIdentityLayout.renderedItems.every((item) =>
      item.silhouette?.scaledToFootprint &&
      item.silhouette?.helperExcluded &&
      item.silhouette?.fitsFootprint &&
      item.silhouette?.heightUsesEnvelope &&
      item.silhouette?.boundsErrorCm <= 8
    ),
    "3D object silhouettes scale to declared item footprint",
    productIdentityLayout.renderedItems.map((item) => ({
      id: item.id,
      archetype: item.meshArchetype?.resolved,
      silhouette: item.silhouette
    }))
  );
  assert(
    productIdentityLayout.renderedItems.some((item) =>
      item.id === productItem?.id &&
      item.meshArchetype?.resolved === "desk_lamp" &&
      item.silhouette?.partRoles?.includes("tilted shade") &&
      item.silhouette?.partRoles?.includes("slender stem")
    ) &&
      productIdentityLayout.renderedItems.some((item) =>
        item.id === "charger" &&
        item.meshArchetype?.resolved === "plug_charger" &&
        item.silhouette?.partRoles?.includes("left prong") &&
        item.silhouette?.partRoles?.includes("cable loop hint")
      ),
    "lamp and charger render specialized 3D silhouettes instead of generic cubes",
    productIdentityLayout.renderedItems.filter((item) => item.id === productItem?.id || item.id === "charger")
  );
  assert(
    manipulationAffordanceFlow?.selectedItem?.volumeOutline?.visible &&
      manipulationAffordanceFlow.selectedItem.volumeOutline.state?.reason === "selected" &&
      manipulationAffordanceFlow.selectedItem.manipulationHandles?.localAxes?.visible &&
      manipulationAffordanceFlow.selectedItem.manipulationHandles.localAxes.axes.includes("x") &&
      manipulationAffordanceFlow.selectedItem.manipulationHandles.localAxes.axes.includes("y") &&
      manipulationAffordanceFlow.selectedItem.manipulationHandles.localAxes.axes.includes("z") &&
      manipulationAffordanceFlow.selectedItem.manipulationHandles?.rotationHandle?.visible &&
      manipulationAffordanceFlow.selectedItem.manipulationHandles.rotationHandle.reason === "selected",
    "selected 3D object exposes local axes rotation handle and volume outline",
    manipulationAffordanceFlow?.selectedItem
  );
  assert(
    manipulationAffordanceFlow?.selectedItem?.containerFitReadout?.status === "fits" &&
      manipulationAffordanceFlow.selectedItem.containerFitReadout.containerId === "desk-right-side" &&
      manipulationAffordanceFlow.fitDetail?.status === "fits" &&
      manipulationAffordanceFlow.fitDetail?.target === "desk-right-side" &&
      manipulationAffordanceFlow.backendFit?.containerId === "desk-right-side" &&
      manipulationAffordanceFlow.backendFit?.status === "fits",
    "selected object exposes container fit readout in 3D detail and backend preview",
    manipulationAffordanceFlow
  );
  assert(
    manipulationAffordanceFlow?.ledgerCount === productIdentityBackend.commitPreview.commitLedgerEntries.length &&
      !manipulationAffordanceFlow.geometryOps.some((op) => /^commit_identity|^commit_coverage|^revert_identity/.test(op.type ?? op.op ?? "")) &&
      !manipulationAffordanceFlow.placementOps.some((op) => /^commit_identity|^commit_coverage|^revert_identity/.test(op.type ?? op.op ?? "")),
    "3D manipulation affordance readouts do not create write-model ops",
    manipulationAffordanceFlow
  );
  assert(
    productIdentityAnswerFlow?.draft?.targetItemId === productItem?.id &&
      productIdentityAnswerFlow.commit?.ops?.some((op) =>
        op.type === "commit_identity_resolution" &&
        op.targetItemId === productItem?.id &&
        op.candidateLabel === "lamp-shaped object on desk right side"
      ) &&
      productIdentityAnswerFlow.answer?.itemId === productItem?.id &&
      productIdentityAnswerFlow.answer?.answerSource === "scan_identity_commit" &&
      productIdentityAnswerFlow.answer?.identityEvidence?.identityCommitId === productIdentityAnswerFlow.commit?.id &&
      productIdentityAnswerFlow.answer?.identityEvidence?.observationId === "identity-obs-desk-lamp-candidate" &&
      productIdentityAnswerFlow.answer?.placementEvidence?.placementId === productAfterMove?.currentPlacement?.id &&
      productAfterMove?.currentPlacement?.commitId !== productIdentityAnswerFlow.commit?.id,
    "committed identity resolution becomes locate answer evidence without rewriting placement",
    productIdentityAnswerFlow
  );
  assert(
    productIdentityAnswerFlow?.afterCommitBackend.commitPreview.identityLineageRecords.some((record) =>
      record.commitId === productIdentityAnswerFlow.commit?.id &&
      record.status === "active" &&
      record.targetItemId === productItem?.id &&
      record.sourceChain?.proposalId === productIdentityAnswerFlow.proposalId &&
      record.sourceChain?.observationIds?.includes("identity-obs-desk-lamp-candidate") &&
      record.undoPolicy === "append_reversal_only"
    ) &&
      productIdentityAnswerFlow.dom?.answer?.source === "scan_identity_commit" &&
      productIdentityAnswerFlow.dom?.answer?.identityCommit === productIdentityAnswerFlow.commit?.id &&
      productIdentityAnswerFlow.dom?.answer?.placementId === productAfterMove?.currentPlacement?.id &&
      productIdentityAnswerFlow.dom?.row?.targetItemId === productItem?.id &&
      productIdentityAnswerFlow.dom?.row?.commitId === productIdentityAnswerFlow.commit?.id &&
      productIdentityAnswerFlow.dom?.lineageDetail?.commitId === productIdentityAnswerFlow.commit?.id &&
      productIdentityAnswerFlow.dom?.lineageDetail?.observationId === "identity-obs-desk-lamp-candidate" &&
      productIdentityAnswerFlow.dom?.rollbackClicked,
    "identity locate answer exposes source lineage in scan row and detail panel",
    productIdentityAnswerFlow?.dom
  );
  assert(
    productIdentityAnswerFlow?.afterRollbackBackend.commitPreview.commitLedgerEntries.length === productIdentityAnswerFlow.ledgerCountBeforeRollback + 1 &&
      productIdentityAnswerFlow.afterRollbackBackend.commitPreview.commitLedgerEntries[0]?.type === "scan_identity_reversal" &&
      productIdentityAnswerFlow.afterRollbackBackend.commitPreview.commitLedgerEntries[0]?.reversesCommitId === productIdentityAnswerFlow.commit?.id &&
      productIdentityAnswerFlow.afterRollbackBackend.commitPreview.commitLedgerEntries.some((entry) => entry.id === productIdentityAnswerFlow.commit?.id && entry.type === "scan_identity_resolution") &&
      productIdentityAnswerFlow.afterRollbackBackend.commitPreview.identityLineageRecords.some((record) =>
        record.commitId === productIdentityAnswerFlow.commit?.id &&
        record.status === "reverted" &&
        record.rollbackCommitId === productIdentityAnswerFlow.afterRollbackBackend.commitPreview.commitLedgerEntries[0]?.id
      ) &&
      !productIdentityAnswerFlow.afterRollbackBackend.mutationBundle.draftOps.geometryOps.some((op) => /^revert_identity|^commit_identity|^commit_coverage/.test(op.type ?? op.op ?? "")) &&
      !productIdentityAnswerFlow.afterRollbackBackend.mutationBundle.draftOps.placementOps.some((op) => /^revert_identity|^commit_identity|^commit_coverage/.test(op.type ?? op.op ?? "")) &&
      JSON.stringify(productIdentityAnswerFlow.geometryStatusesBefore) === JSON.stringify(productIdentityAnswerFlow.geometryStatusesAfter),
    "identity rollback is append-only lineage and does not leak into geometry or placement writes",
    productIdentityAnswerFlow?.afterRollbackBackend
  );
  assert(
    productIdentityAnswerFlow?.afterRollbackAnswer?.status === "needs_review" &&
      productIdentityAnswerFlow.afterRollbackAnswer.answerSource === "identity_needs_review" &&
      productIdentityAnswerFlow.afterRollbackAnswer.itemId === null &&
      productIdentityAnswerFlow.afterRollbackAnswer.reviewRequired === "latest_identity_commit_reverted" &&
      productIdentityAnswerFlow.afterRollbackAnswer.blockedOlderCommitIds?.length >= 1 &&
      productIdentityAnswerFlow.afterRollbackAnswer.suppressedIdentityEvidence?.[0]?.identityCommitId === productIdentityAnswerFlow.commit?.id &&
      productIdentityAnswerFlow.afterRollbackExplanation?.status === "needs_review" &&
      productIdentityAnswerFlow.afterRollbackExplanation?.decision === "hold_answer_latest_identity_reverted" &&
      productIdentityAnswerFlow.afterRollbackExplanation?.blockedOlderCommitIds?.length >= 1 &&
      productIdentityAnswerFlow.afterRollbackExplanation?.suppressedIdentityEvidence?.some((record) => record.identityCommitId === productIdentityAnswerFlow.commit?.id) &&
      productIdentityAnswerFlow.afterRollbackExplanation?.activeIdentityEvidence?.some((record) => record.identityCommitId !== productIdentityAnswerFlow.commit?.id) &&
      productIdentityAnswerFlow.afterNeedsReviewBackend.commitPreview.answerPreview?.status === "needs_review" &&
      productIdentityAnswerFlow.afterNeedsReviewBackend.commitPreview.answerPreview?.answerSource === "identity_needs_review" &&
      productIdentityAnswerFlow.afterNeedsReviewBackend.commitPreview.answerPreview?.blockedOlderCommitIds?.length >= 1 &&
      productIdentityAnswerFlow.afterNeedsReviewBackend.commitPreview.retrievalExplanation?.reviewRequired === "latest_identity_commit_reverted" &&
      productIdentityAnswerFlow.needsReviewDom?.status === "needs_review" &&
      productIdentityAnswerFlow.needsReviewDom?.answerStatus === "needs_review" &&
      productIdentityAnswerFlow.needsReviewDom?.reviewRequired === "latest_identity_commit_reverted" &&
      productIdentityAnswerFlow.needsReviewDom?.holdReason === "latest_identity_commit_reverted" &&
      productIdentityAnswerFlow.needsReviewDom?.latestIdentityCommit === productIdentityAnswerFlow.commit?.id &&
      productIdentityAnswerFlow.needsReviewDom?.blockedOlderIdentityCommits?.length > 0 &&
      productIdentityAnswerFlow.needsReviewDom?.latestIdentityStatus === "reverted" &&
      productIdentityAnswerFlow.needsReviewDom?.suppressedIdentityCount >= 1 &&
      productIdentityAnswerFlow.needsReviewDom?.suppressedRows?.some((row) => row.commitId === productIdentityAnswerFlow.commit?.id && row.reason === "latest_identity_commit_reverted") &&
      productIdentityAnswerFlow.needsReviewDom?.finalConfidence === 0,
    "reverted latest identity evidence suppresses older matches and asks for review",
    {
      answer: productIdentityAnswerFlow?.afterRollbackAnswer,
      explanation: productIdentityAnswerFlow?.afterRollbackExplanation,
      dom: productIdentityAnswerFlow?.needsReviewDom
    }
  );
  assert(
    productIdentityAnswerFlow?.notFoundAnswer?.status === "not_found" &&
      productIdentityAnswerFlow.notFoundAnswer.itemId === null &&
      productIdentityAnswerFlow.notFoundAnswer.answerSource === null &&
      productIdentityAnswerFlow.notFoundAnswer.suggestedReviewAction === "create_item" &&
      productIdentityAnswerFlow.notFoundExplanation?.status === "not_found" &&
      productIdentityAnswerFlow.afterNotFoundBackend.commitPreview.answerPreview?.status === "not_found" &&
      productIdentityAnswerFlow.afterNotFoundBackend.commitPreview.retrievalExplanation?.status === "not_found" &&
      productIdentityAnswerFlow.notFoundDom?.status === "not_found" &&
      productIdentityAnswerFlow.notFoundDom?.answerStatus === "not_found" &&
      productIdentityAnswerFlow.notFoundDom?.finalConfidence === 0,
    "not found retrieval returns stable answer preview and visible no-result state",
    {
      answer: productIdentityAnswerFlow?.notFoundAnswer,
      explanation: productIdentityAnswerFlow?.notFoundExplanation,
      dom: productIdentityAnswerFlow?.notFoundDom
    }
  );
  assert(
    productIdentityAnswerFlow?.answeredPlan?.overlay?.status === "answered" &&
      productIdentityAnswerFlow.answeredPlan.overlay.itemId === productItem?.id &&
      productIdentityAnswerFlow.answeredPlan.overlay.identityCommitId === productIdentityAnswerFlow.commit?.id &&
      productIdentityAnswerFlow.answeredPlan.overlay.placementId === productAfterMove?.currentPlacement?.id &&
      productIdentityAnswerFlow.answeredPlan.targetPin?.itemId === productItem?.id &&
      productIdentityAnswerFlow.answeredPlanBackend.commitPreview.planAnswerOverlay?.status === "answered" &&
      productIdentityAnswerFlow.answered3d?.overlay?.status === "answered" &&
      productIdentityAnswerFlow.answered3d.productItem?.status === "answered" &&
      productIdentityAnswerFlow.answered3d.productItem?.overlayKind === "item_answer" &&
      productIdentityAnswerFlow.answered3d.productItem?.haloVisible &&
      productIdentityAnswerFlow.answered3d.itemLabel?.source === "scan_identity_commit",
    "retrieval answered state projects into 2D plan and 3D item overlay",
    {
      plan: productIdentityAnswerFlow?.answeredPlan,
      threeD: productIdentityAnswerFlow?.answered3d
    }
  );
  assert(
    productIdentityAnswerFlow?.answered3d?.productItem?.status === "answered" &&
      productIdentityAnswerFlow.answered3d.itemOverlays.some((entry) =>
        entry.id === productItem?.id &&
        entry.retrievalOverlay?.haloVisible
      ) &&
      productIdentityAnswerFlow.answered3d.overlay?.itemId === productItem?.id,
    "retrieval answer keeps selected object spatial overlay tied to target item",
    productIdentityAnswerFlow?.answered3d
  );
  assert(
    productIdentityAnswerFlow?.answered3d?.productRenderedItem?.volumeOutline?.visible &&
      productIdentityAnswerFlow.answered3d.productRenderedItem.volumeOutline.state?.reason === "answer_target" &&
      productIdentityAnswerFlow.answered3d.productRenderedItem.volumeOutline.state?.colorRole === "teal" &&
      Math.abs(productIdentityAnswerFlow.answered3d.productRenderedItem.volumeOutline.bounds.width - productIdentityAnswerFlow.answered3d.productRenderedItem.footprint.width) <= 0.01 &&
      Math.abs(productIdentityAnswerFlow.answered3d.productRenderedItem.volumeOutline.bounds.depth - productIdentityAnswerFlow.answered3d.productRenderedItem.footprint.depth) <= 0.01,
    "3D selected answer renders item volume outline from footprint dimensions",
    productIdentityAnswerFlow?.answered3d?.productRenderedItem
  );
  assert(
    productIdentityAnswerFlow?.needsReviewPlan?.overlay?.status === "needs_review" &&
      productIdentityAnswerFlow.needsReviewPlan.overlay.reviewRequired === "latest_identity_commit_reverted" &&
      productIdentityAnswerFlow.needsReviewPlan.overlay.latestIdentityCommitId === productIdentityAnswerFlow.commit?.id &&
      !productIdentityAnswerFlow.needsReviewPlan.targetPin &&
      productIdentityAnswerFlow.needsReviewPlan.holdPin?.itemId === productItem?.id &&
      productIdentityAnswerFlow.needsReviewPlanBackend.commitPreview.planAnswerOverlay?.status === "needs_review" &&
      productIdentityAnswerFlow.needsReview3d?.overlay?.status === "needs_review" &&
      productIdentityAnswerFlow.needsReview3d.productItem?.overlayKind === "identity_hold" &&
      productIdentityAnswerFlow.needsReview3d.productItem?.reviewRequired === "latest_identity_commit_reverted" &&
      productIdentityAnswerFlow.needsReview3d.itemLabel?.kind === "identity_hold" &&
      productIdentityAnswerFlow.needsReview3d.itemLabel?.reviewRequired === "latest_identity_commit_reverted",
    "retrieval needs-review state projects as 2D hold and 3D identity hold",
    {
      plan: productIdentityAnswerFlow?.needsReviewPlan,
      threeD: productIdentityAnswerFlow?.needsReview3d
    }
  );
  assert(
    productIdentityAnswerFlow?.needsReview3d?.productRenderedItem?.volumeOutline?.visible &&
      productIdentityAnswerFlow.needsReview3d.productRenderedItem.volumeOutline.state?.reason === "identity_hold" &&
      productIdentityAnswerFlow.needsReview3d.productRenderedItem.volumeOutline.state?.colorRole === "gold",
    "3D needs-review hold keeps volume outline visible without answer promotion",
    productIdentityAnswerFlow?.needsReview3d?.productRenderedItem
  );
  assert(
    productIdentityAnswerFlow?.notFoundPlan?.overlay?.status === "not_found" &&
      productIdentityAnswerFlow.notFoundPlan.empty?.status === "not_found" &&
      !productIdentityAnswerFlow.notFoundPlan.targetPin &&
      !productIdentityAnswerFlow.notFoundPlan.holdPin &&
      productIdentityAnswerFlow.notFoundPlanBackend.commitPreview.planAnswerOverlay?.status === "not_found" &&
      productIdentityAnswerFlow.notFound3d?.overlay?.status === "not_found" &&
      productIdentityAnswerFlow.notFound3d.sceneLabel?.state === "not_found" &&
      productIdentityAnswerFlow.notFound3d.itemOverlays?.length === 0,
    "retrieval not-found state projects as plan empty state and 3D scene label",
    {
      plan: productIdentityAnswerFlow?.notFoundPlan,
      threeD: productIdentityAnswerFlow?.notFound3d
    }
  );
  assert(
    productIdentityAnswerFlow?.notFound3d?.visibleVolumeOutlines?.length === 0,
    "3D not-found retrieval clears item volume outlines",
    productIdentityAnswerFlow?.notFound3d?.visibleVolumeOutlines
  );
  assert(
    productIdentityAnswerFlow?.answeredPlan?.board?.density === "collapsed" &&
      productIdentityAnswerFlow.answeredPlan.board.labelPolicy === "secondary_collapsed" &&
      productIdentityAnswerFlow.answeredPlan.labelModes.some((entry) =>
        entry.itemId === productItem?.id &&
        entry.labelState === "visible" &&
        entry.revealReason === "answer_target" &&
        entry.answerTarget === "true" &&
        entry.labelPriority === "primary"
      ) &&
      productIdentityAnswerFlow.answeredPlan.labelModes.some((entry) =>
        entry.itemId !== productItem?.id &&
        entry.labelState === "collapsed" &&
        entry.revealReason === "density_collapsed"
      ),
    "2D plan collapses secondary labels while revealing answered target",
    productIdentityAnswerFlow?.answeredPlan?.labelModes
  );
  assert(
    productIdentityAnswerFlow?.needsReviewPlan?.board?.density === "collapsed" &&
      productIdentityAnswerFlow.needsReviewPlan.board.labelPolicy === "secondary_collapsed" &&
      productIdentityAnswerFlow.needsReviewPlan.labelModes.some((entry) =>
        entry.itemId === productItem?.id &&
        entry.labelState === "visible" &&
        entry.revealReason === "identity_hold" &&
        entry.answerHold === "true" &&
        entry.answerState === "needs_review"
      ) &&
      !productIdentityAnswerFlow.needsReviewPlan.labelModes.some((entry) => entry.answerTarget === "true"),
    "2D plan reveals needs-review hold anchor without promoting it to answer target",
    productIdentityAnswerFlow?.needsReviewPlan?.labelModes
  );
  assert(
    productIdentityAnswerFlow?.notFoundPlan?.board?.density === "collapsed" &&
      productIdentityAnswerFlow.notFoundPlan.labelModes.every((entry) =>
        entry.answerTarget !== "true" &&
        entry.answerHold !== "true" &&
        entry.labelState === "collapsed" &&
        entry.revealReason === "density_collapsed"
      ),
    "2D plan keeps all item labels collapsed for not-found retrieval",
    productIdentityAnswerFlow?.notFoundPlan?.labelModes
  );
  assert(
    productIdentityAnswerFlow?.labelReveal?.hoverSnapshot?.records?.some((entry) =>
      entry.itemId === "water-bottle" &&
      entry.state === "visible" &&
      entry.revealReason === "hover"
    ) &&
      productIdentityAnswerFlow.labelReveal.hoverPlan.labelModes.some((entry) =>
        entry.itemId === "water-bottle" &&
        entry.labelState === "visible" &&
        entry.revealReason === "hover"
      ) &&
      productIdentityAnswerFlow.labelReveal.clearAfterHoverSnapshot.records.some((entry) =>
        entry.itemId === "water-bottle" &&
        entry.state === "collapsed" &&
        entry.revealReason === "density_collapsed"
      ) &&
      productIdentityAnswerFlow.labelReveal.focusSnapshot.records.some((entry) =>
        entry.itemId === "water-bottle" &&
        entry.state === "visible" &&
        entry.revealReason === "focus"
      ) &&
      productIdentityAnswerFlow.labelReveal.focusPlan.labelModes.some((entry) =>
        entry.itemId === "water-bottle" &&
        entry.labelState === "visible" &&
        entry.revealReason === "focus"
      ) &&
      productIdentityAnswerFlow.labelReveal.clearAfterFocusSnapshot.records.some((entry) =>
        entry.itemId === "water-bottle" &&
        entry.state === "collapsed" &&
        entry.revealReason === "density_collapsed"
      ),
    "2D plan hover and focus reveal secondary labels without changing answer overlay",
    productIdentityAnswerFlow?.labelReveal
  );
  assert(
    productIdentityAnswerFlow?.labelReveal?.afterBackend?.commitPreview?.commitLedgerEntries?.length === productIdentityAnswerFlow.labelReveal.ledgerCountBefore &&
      !productIdentityAnswerFlow.labelReveal.afterBackend.mutationBundle.draftOps.geometryOps.some((op) => /^revert_identity|^commit_identity|^commit_coverage/.test(op.type ?? op.op ?? "")) &&
      !productIdentityAnswerFlow.labelReveal.afterBackend.mutationBundle.draftOps.placementOps.some((op) => /^revert_identity|^commit_identity|^commit_coverage/.test(op.type ?? op.op ?? "")),
    "2D label reveal policy is read-only and does not write geometry placement or identity commits",
    productIdentityAnswerFlow?.labelReveal?.afterBackend
  );
  assert(Array.isArray(backendContract.writeModelPreview.anchorRecords) && backendContract.writeModelPreview.anchorRecords.length === coordinateSnapshot.anchors.length, "backend contract exposes first-class anchor records", backendContract.writeModelPreview.anchorRecords);
  assert(Array.isArray(backendContract.writeModelPreview.geometryRecords) && backendContract.writeModelPreview.geometryRecords.length >= afterLayout.furniture.length - 1, "backend contract exposes geometry records", backendContract.writeModelPreview.geometryRecords);
  assert(Array.isArray(backendContract.writeModelPreview.placementRecords) && backendContract.writeModelPreview.placementRecords.length >= afterLayout.metrics.coordinateHealth.roomMappedCount, "backend contract exposes placement records", backendContract.writeModelPreview.placementRecords);
  assert(mixedScanDraft.selectedProposalId === "proposal-nightstand", "proposal selection is shared across review surfaces", mixedScanDraft);
  assert(mixedScanDraft.proposals.some((proposal) => proposal.status === "rejected"), "proposal state machine supports rejected draft", mixedScanDraft.proposals);
  assert(mixedScanDraft.scanPointCount > 150, "3D scan point cloud is rendered for review", mixedScanDraft.scanPointCount);
  assert(scanPlanOverlayCount >= 3, "2D plan renders scan proposal overlays before commit", { scanPlanOverlayCount });
  assert(scanPlanDom.anchors >= coordinateSnapshot.anchors.length, "2D plan renders coordinate anchor markers", scanPlanDom);
  assert(scanPlanDom.envelopes >= mixedScanDraft.interactionZones.length, "2D plan renders interaction envelopes", scanPlanDom);
  assert(scanPlanDom.envelopeLabels.every((label) => label && label !== "undefined"), "2D plan labels interaction envelopes semantically", scanPlanDom.envelopeLabels);
  assert(scanPlanDom.unknownRegions >= mixedScanDraft.scanRegions.length, "2D plan renders unknown or redacted scan regions", scanPlanDom);
  assert(scanPlanDom.furnitureBlocks >= mixedScanDraft.furniture.length, "2D plan renders all furniture blocks", scanPlanDom);
  assert(scanPlanDom.proposalLabels.every((label) => !["diff", "new", "undefined"].includes(label.toLowerCase())), "2D scan proposal overlays use semantic labels", scanPlanDom.proposalLabels);
  assert(scanDraftAfterCommit.renderedFurniture.some((item) => item.id === "bedside-block" && item.stateDriven), "3D furniture adds committed scan-created blocks", scanDraftAfterCommit.renderedFurniture);
  assert(afterLayout.renderedFurniture.length === afterLayout.furniture.length, "3D furniture count matches editable layout state", { rendered: afterLayout.renderedFurniture, furniture: afterLayout.furniture });
  const renderedDesk = afterLayout.renderedFurniture.find((item) => item.id === "desk");
  const layoutDesk = afterLayout.furniture.find((item) => item.id === "desk");
  assert(
    renderedDesk &&
      layoutDesk &&
      Math.abs(renderedDesk.x - layoutDesk.x) <= 0.01 &&
      Math.abs(renderedDesk.z - layoutDesk.z) <= 0.01 &&
      Math.abs(renderedDesk.width - layoutDesk.width) <= 0.01 &&
      Math.abs(renderedDesk.depth - layoutDesk.depth) <= 0.01,
    "3D furniture mesh follows editable desk state",
    { renderedDesk, layoutDesk }
  );
  assert(supportSurfaces.length >= 8 && supportSurfaces.some((surface) => surface.id === "surface-desk-top") && supportSurfaces.some((surface) => surface.id === "surface-desk-right-side-base"), "support surfaces are derived from furniture and containers", supportSurfaces);
  assert(
    hoverSupportSurface?.id === "surface-desk-top" &&
      hoverSnapshot.hoveredSurfaceId === "surface-desk-top" &&
      hoverSnapshot.selectedSurfaceId !== "surface-desk-top" &&
      hoverSnapshot.surfaceHover?.preview?.status === "allowed",
    "3D support surface hover is targetable before selection",
    { hoverSupportSurface, hoverSnapshot: hoverSnapshot.surfaceHover }
  );
  assert(
    hoverSnapshot.hoveredSurface?.parentFurnitureId === "desk" &&
      hoverSnapshot.hoveredSurface?.relation === "on" &&
      hoverSnapshot.hoveredSurface?.ownerRef === "furniture:desk" &&
      hoverSnapshot.surfaceHover?.preview?.itemId === "earphones" &&
      hoverSnapshot.surfaceHover?.preview?.reasonCode === "fits_clear" &&
      afterHoverEarphones.currentPlacement.id === beforeHoverEarphones.currentPlacement.id &&
      precheckCountAfterHover === precheckCountBeforeHover &&
      hoverSnapshot.surfaceHover?.preview?.persistedPrecheckId === null,
    "support surface hover exposes ownership without mutating prechecks",
    {
      beforePlacement: beforeHoverEarphones.currentPlacement,
      afterPlacement: afterHoverEarphones.currentPlacement,
      precheckCountBeforeHover,
      precheckCountAfterHover,
      hoveredSurface: hoverSnapshot.hoveredSurface,
      hoverPreview: hoverSnapshot.surfaceHover?.preview
    }
  );
  assert(
    hoverDom.chip?.visible &&
      hoverDom.chip.surfaceId === "surface-desk-top" &&
      hoverDom.chip.ownerId === "desk" &&
      hoverDom.chip.status === "allowed" &&
      hoverDom.chip.candidate === "earphones" &&
      hoverDom.stage?.hoverSurfaceId === "surface-desk-top" &&
      hoverDom.stage?.selectedSurfaceId === null &&
      /Desk top/.test(hoverDom.chip.text) &&
      /Earphones/.test(hoverDom.chip.text),
    "3D hover affordance renders target label owner and candidate before click",
    hoverDom
  );
  assert(
    hoverSnapshot.surfaceHover?.visual?.hovered &&
      hoverSnapshot.surfaceHover.visual.opacity > 0.2 &&
      hoverSnapshot.surfaceHover.visual.emissiveIntensity > 0,
    "hovered 3D support surface renders stronger affordance than idle surfaces",
    hoverSnapshot.surfaceHover?.visual
  );
  assert(
    clearedHover.hoveredSurfaceId === null &&
      clearedHover.surfaceHover?.hoveredSurfaceId === null &&
      !clearedHoverDom.chipVisible &&
      clearedHoverDom.stageHoverSurfaceId === null,
    "support surface hover clears without leaving a selected target",
    { clearedHover: clearedHover.surfaceHover, clearedHoverDom }
  );
  assert(selectedSupportSurface?.id === "surface-desk-top", "3D support surface can be selected as a placement target", selectedSupportSurface);
  assert(selectedSupportSurface?.parentFurnitureId === "desk" && selectedSupportSurface?.relation === "on" && !selectedSupportSurface?.containerId, "selected top support surface resolves to its owning furniture", selectedSupportSurface);
  assert(allowedSupportPrecheck?.status === "allowed" && allowedSupportPrecheck.reasonCode === "fits_clear", "support surface precheck can pass before confirmation", allowedSupportPrecheck);
  assert(supportReadyPrecheckDom.some((item) => item.status === "ready" && item.rawStatus === "allowed" && item.reason === "fits_clear" && item.uiSource === "precheck_recorded" && /Ready to place/.test(item.text)), "right panel maps allowed support precheck to ready copy", supportReadyPrecheckDom);
  assert(
    supportBackendAfterAllowedPrecheck.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.latestPrecheck?.copy?.uiStatus === "ready" &&
      record.latestPrecheck?.copy?.title === "Ready to place" &&
      record.latestPrecheck?.checkIds?.length === 3
    ),
    "backend support surface records preserve ready latest-precheck copy",
    supportBackendAfterAllowedPrecheck.writeModelPreview.supportSurfaceRecords
  );
  assert(
    supportReadyBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks.some((precheck) =>
      precheck.id === allowedSupportPrecheck.id &&
      precheck.copy?.title === "Ready to place" &&
      precheck.copy?.uiStatus === "ready" &&
      precheck.copy?.reasonText === "Footprint fits and no occupied area overlaps." &&
      precheck.suggestedAction === "confirm placement"
    ),
    "rendered backend preview preserves ready precheck copy",
    supportReadyBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks
  );
  assert(afterAllowedPrecheck.currentPlacement.surfaceId !== "surface-desk-top", "allowed support precheck does not mutate placement", afterAllowedPrecheck.currentPlacement);
  assert(supportBackendAfterAllowedPrecheck.mutationBundle.draftOps.placementOps.some((op) => op.type === "support_surface_placement" && op.status === "ready" && op.canCommit), "mutation bundle exposes ready support placement op before confirmation", supportBackendAfterAllowedPrecheck.mutationBundle.draftOps.placementOps);
  assert(
    supportBackendAfterAllowedPrecheck.mutationBundle.draftOps.placementOps.some((op) =>
      op.type === "support_surface_placement" &&
      op.status === "ready" &&
      op.checkIds?.length === 3 &&
      op.precheckId === allowedSupportPrecheck.id &&
      op.copy?.uiStatus === "ready"
    ),
    "support placement ops expose full check ids for ready prechecks",
    supportBackendAfterAllowedPrecheck.mutationBundle.draftOps.placementOps
  );
  assert(supportPlacement?.status === "confirmed" && supportPlacement?.precheck?.id === allowedSupportPrecheck.id && supportPlacement.placement.surfaceId === "surface-desk-top", "item can be confirmed on selected support surface after passing precheck", supportPlacement);
  assert(
    supportConfirmedPrecheckDom.some((item) =>
      item.id === allowedSupportPrecheck.id &&
      item.status === "confirmed" &&
      item.uiSource === "placement_confirmed" &&
      /Placement confirmed/.test(item.text)
    ),
    "right panel preserves confirmed support precheck copy",
    supportConfirmedPrecheckDom
  );
  assert(
    supportConfirmedBackendDom.commitPreview.supportPlacementOps.some((op) =>
      op.precheckId === allowedSupportPrecheck.id &&
      op.status === "confirmed" &&
      op.uiStatusSnapshot?.title === "Placement confirmed" &&
      op.uiStatusSnapshot?.resultStatus === "confirmed"
    ),
    "rendered backend preview preserves confirmed support placement copy",
    supportConfirmedBackendDom.commitPreview.supportPlacementOps
  );
  assert(afterSupportPlacement.currentPlacement.surfaceId === "surface-desk-top" && afterSupportPlacement.currentPlacement.precheckId === supportPlacement.precheck.id, "support surface placement keeps surface and precheck references", afterSupportPlacement.currentPlacement);
  assert(afterSupportPlacement.currentPlacement.supportPose?.occupiedPatch?.width > 0 && afterSupportPlacement.currentPlacement.supportPose.anchor === "center", "support surface placement stores support-local occupied patch", afterSupportPlacement.currentPlacement.supportPose);
  assert(
    readyDragPreview?.status === "ready" &&
      readyDragPreview.reasonCode === "fits_clear" &&
      readyDragPreview.canCommit &&
      readyDragPreview.supportPose?.poseSource === "auto_centered" &&
      readyDragSnapshot.stage.status === "ready" &&
      readyDragSnapshot.visual.visible &&
      readyDragSnapshot.visual.volume?.width > 0 &&
      readyDragSnapshot.visual.patch?.width > 0,
    "drag preview exposes ready support precheck before drop",
    { readyDragPreview, readyDragSnapshot }
  );
  assert(
    afterReadyDragEarphones.currentPlacement.id === beforeReadyDragEarphones.currentPlacement.id &&
      afterReadyDragEarphones.currentPlacement.surfaceId !== "surface-desk-top" &&
      readyDragBackend.mutationBundle.draftOps.surfacePlacementPrechecks.length === 0,
    "drag preview does not mutate placement before drop",
    {
      before: beforeReadyDragEarphones.currentPlacement,
      after: afterReadyDragEarphones.currentPlacement,
      persistedPrechecks: readyDragBackend.mutationBundle.draftOps.surfacePlacementPrechecks
    }
  );
  assert(
    planReadyDragPreview?.status === "ready" &&
      planReadyDragSnapshot.plan?.status === "ready" &&
      planReadyDragSnapshot.plan?.surfaceId === "surface-desk-top" &&
      planReadyDragSnapshot.plan?.itemId === "earphones",
    "2D plan renders drag drop preview before drop",
    { planReadyDragPreview, plan: planReadyDragSnapshot.plan }
  );
  assert(
    readyDragBackend.mutationBundle.draftOps.dragPlacementPreviews.some((op) =>
      op.type === "drag_placement_preview" &&
      op.itemId === "earphones" &&
      op.targetSurfaceId === "surface-desk-top" &&
      op.status === "ready" &&
      op.canDrop &&
      op.checkIds?.length === 3
    ),
    "backend contract exposes drag preview support placement op before drop",
    readyDragBackend.mutationBundle.draftOps.dragPlacementPreviews
  );
  assert(
    readyDragBackendDom.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.activeDragPreview?.copy?.title === "Ready to place" &&
      record.activeDragPreview?.copy?.uiStatus === "ready"
    ),
    "rendered backend preview preserves drag preview support copy before drop",
    readyDragBackendDom.writeModelPreview.supportSurfaceRecords
  );
  assert(
    snappedChargerPrecheck?.status === "allowed" &&
      snappedChargerPrecheck.reasonCode === "fits_clear_snapped" &&
      snappedChargerPrecheck.supportPose?.snapped &&
      snappedChargerPrecheck.supportPose.poseSource === "auto_snapped" &&
      snappedChargerPrecheck.collision.centerBlockerIds.includes("earphones"),
    "support surface precheck snaps away from occupied center when free patch exists",
    snappedChargerPrecheck
  );
  assert(
    supportSnapPrecheckDom.some((item) =>
      item.id === snappedChargerPrecheck.id &&
      item.status === "ready" &&
      item.reason === "fits_clear_snapped" &&
      item.poseSource === "auto_snapped" &&
      item.poseSnapped === "true" &&
      Math.abs(item.poseLocalX) + Math.abs(item.poseLocalZ) > 0 &&
      /Center was occupied; snapped/.test(item.text)
    ),
    "right panel explains snapped support precheck copy",
    supportSnapPrecheckDom
  );
  assert(
    afterSnapPrecheckCharger.currentPlacement.id === beforeCollisionCharger.currentPlacement.id &&
      afterSnapPrecheckCharger.currentPlacement.surfaceId !== "surface-desk-top",
    "snapped support precheck does not mutate placement before confirmation",
    { before: beforeCollisionCharger.currentPlacement, after: afterSnapPrecheckCharger.currentPlacement }
  );
  assert(
    manualChargerPreview?.status === "manual" &&
      manualChargerPreview.reasonCode === "fits_clear_manual" &&
      manualChargerPreview.supportPose?.manual &&
      manualChargerPreview.supportPose.poseSource === "manual_patch" &&
      Math.abs(manualChargerPreview.supportPose.local.x + 0.45) <= 0.01 &&
      manualChargerSnapshot.visual.status === "manual",
    "manual patch drag preview uses user chosen support-local coordinate",
    { manualChargerPreview, manualChargerSnapshot }
  );
  assert(
    afterManualChargerPreview.currentPlacement.id === beforeCollisionCharger.currentPlacement.id &&
      manualChargerBackend.mutationBundle.draftOps.surfacePlacementPrechecks.every((precheck) => precheck.itemId !== "charger"),
    "manual patch drag preview does not persist before drop",
    {
      before: beforeCollisionCharger.currentPlacement,
      after: afterManualChargerPreview.currentPlacement,
      persistedPrechecks: manualChargerBackend.mutationBundle.draftOps.surfacePlacementPrechecks
    }
  );
  assert(
    manualBlockedChargerPreview?.status === "blocked" &&
      manualBlockedChargerPreview.reasonCode === "manual_patch_occupied" &&
      manualBlockedChargerPreview.supportPose?.manual &&
      manualBlockedChargerPreview.collision.blockers.some((blocker) => blocker.itemId === "earphones"),
    "manual patch drag preview blocks an occupied user chosen patch",
    manualBlockedChargerPreview
  );
  assert(
    manualChargerBackend.mutationBundle.draftOps.dragPlacementPreviews.some((op) =>
      op.status === "manual" &&
      op.supportPose?.manual &&
      op.supportPose?.poseSource === "manual_patch" &&
      Math.abs(op.supportPose.local.x + 0.45) <= 0.01 &&
      op.copy?.reasonCode === "fits_clear_manual"
    ),
    "backend contract exposes manual patch drag preview before drop",
    manualChargerBackend.mutationBundle.draftOps.dragPlacementPreviews
  );
  assert(
    manualBlockedChargerBackend.commitPreview.dragPlacementGate.blockingCheckIds.length > 0 &&
      manualBlockedChargerBackend.writeModelPreview.collisionResults.supportSurfaceChecks.some((check) =>
        check.previewSessionId === manualBlockedChargerPreview.previewSessionId &&
        check.status === "blocked" &&
        check.candidatePatch?.x === 0
      ),
    "backend drag preview gate blocks occupied manual patch",
    {
      gate: manualBlockedChargerBackend.commitPreview.dragPlacementGate,
      checks: manualBlockedChargerBackend.writeModelPreview.collisionResults.supportSurfaceChecks
    }
  );
  assert(
    planManualChargerPreview?.status === "manual" &&
      planManualChargerSnapshot.plan?.status === "manual" &&
      planManualChargerSnapshot.plan?.surfaceId === "surface-desk-top" &&
      planManualChargerSnapshot.plan?.itemId === "charger",
    "2D plan renders manual patch drag preview",
    { planManualChargerPreview, plan: planManualChargerSnapshot.plan }
  );
  assert(
    planManualChargerSnapshot.plan?.patch?.visible &&
      planManualChargerSnapshot.plan?.volume?.visible &&
      planManualChargerSnapshot.plan?.handle?.visible &&
      planManualChargerSnapshot.plan.poseManual === "true" &&
      planManualChargerSnapshot.plan.poseSource === "manual_patch",
    "2D plan renders separate manual patch volume and handle layers",
    planManualChargerSnapshot.plan
  );
  assert(
    Math.abs(planManualChargerSnapshot.plan.patch.width - planManualChargerSnapshot.visual.patch.width) <= 0.01 &&
      Math.abs(planManualChargerSnapshot.plan.patch.depth - planManualChargerSnapshot.visual.patch.depth) <= 0.01 &&
      Math.abs(planManualChargerSnapshot.plan.volume.width - planManualChargerSnapshot.visual.volume.width) <= 0.01 &&
      Math.abs(planManualChargerSnapshot.plan.volume.depth - planManualChargerSnapshot.visual.volume.depth) <= 0.01,
    "2D plan preview geometry matches 3D patch and volume ghosts",
    {
      plan: planManualChargerSnapshot.plan,
      visual: planManualChargerSnapshot.visual
    }
  );
  assert(
    planPatchHandleDragSnapshot.plan?.mode === "patch-local" &&
      planPatchHandleDragSnapshot.plan?.phase === "preview_retained" &&
      planPatchHandleDragSnapshot.plan?.poseManual === "true" &&
      Math.abs(planPatchHandleDragSnapshot.plan.localX - patchHandleDragPoints.targetLocal.x) <= 0.02 &&
      Math.abs(planPatchHandleDragSnapshot.plan.localZ - patchHandleDragPoints.targetLocal.z) <= 0.02 &&
      Math.abs(planPatchHandleDragSnapshot.plan.localX - planManualChargerSnapshot.plan.localX) >= 0.05,
    "2D patch handle drag changes manual support-local preview",
    {
      before: planManualChargerSnapshot.plan,
      after: planPatchHandleDragSnapshot.plan,
      target: patchHandleDragPoints.targetLocal
    }
  );
  assert(
    afterPatchHandleCharger.currentPlacement.id === beforePatchHandleCharger.currentPlacement.id &&
      afterPatchHandlePrecheckCount === beforePatchHandlePrecheckCount &&
      planPatchHandleDragBackend.mutationBundle.draftOps.surfacePlacementPrechecks.length === beforePatchHandlePrecheckCount,
    "2D patch handle drag keeps placement and precheck state preview-only",
    {
      beforePlacement: beforePatchHandleCharger.currentPlacement,
      afterPlacement: afterPatchHandleCharger.currentPlacement,
      beforePatchHandlePrecheckCount,
      afterPatchHandlePrecheckCount,
      prechecks: planPatchHandleDragBackend.mutationBundle.draftOps.surfacePlacementPrechecks
    }
  );
  assert(
    planPatchHandleDragBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.activeDragPreview?.itemId === "charger" &&
      record.activeDragPreview?.status === "manual" &&
      record.activeDragPreview?.canDrop &&
      record.activeDragPreview?.blockedByCheckIds?.length === 0 &&
      Math.abs((record.activeDragPreview.supportPose?.local?.x ?? 99) - patchHandleDragPoints.targetLocal.x) <= 0.02 &&
      Math.abs((record.activeDragPreview.supportPose?.local?.z ?? 99) - patchHandleDragPoints.targetLocal.z) <= 0.02
    ),
    "backend contract updates active drag preview from 2D patch handle drag",
    planPatchHandleDragBackend.writeModelPreview.supportSurfaceRecords
  );
  assert(
    planVolumeResizeDuringSnapshot.plan?.mode === "volume-resize" &&
      planVolumeResizeDuringSnapshot.plan?.phase === "resize_drag_preview" &&
      planVolumeResizeDuringSnapshot.plan?.volumeHandle?.axis === "se" &&
      Math.abs(planVolumeResizeSnapshot.plan.volume.width - volumeResizeDragPoints.targetFootprint.width) <= 0.02 &&
      Math.abs(planVolumeResizeSnapshot.plan.volume.depth - volumeResizeDragPoints.targetFootprint.depth) <= 0.02 &&
      Math.abs(planVolumeResizeSnapshot.visual.volume.width - volumeResizeDragPoints.targetFootprint.width) <= 0.02 &&
      Math.abs(planVolumeResizeSnapshot.visual.volume.depth - volumeResizeDragPoints.targetFootprint.depth) <= 0.02,
    "2D volume resize handle changes candidate preview dimensions",
    {
      during: planVolumeResizeDuringSnapshot.plan,
      after: planVolumeResizeSnapshot.plan,
      visual: planVolumeResizeSnapshot.visual,
      target: volumeResizeDragPoints.targetFootprint
    }
  );
  assert(
    afterVolumeResizeCharger.currentPlacement.id === beforeVolumeResizeCharger.currentPlacement.id &&
      afterVolumeResizePrecheckCount === beforeVolumeResizePrecheckCount &&
      Math.abs(afterVolumeResizeCharger.footprint.width - beforeVolumeResizeCharger.footprint.width) <= 0.001 &&
      Math.abs(afterVolumeResizeCharger.footprint.depth - beforeVolumeResizeCharger.footprint.depth) <= 0.001,
    "2D volume resize preview keeps placement precheck and item footprint unchanged",
    {
      before: beforeVolumeResizeCharger,
      after: afterVolumeResizeCharger,
      beforeVolumeResizePrecheckCount,
      afterVolumeResizePrecheckCount
    }
  );
  assert(
    planVolumeResizeBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.activeDragPreview?.itemId === "charger" &&
      record.activeDragPreview?.status === "manual" &&
      Math.abs((record.activeDragPreview.fit?.itemSize?.width ?? 99) - volumeResizeDragPoints.targetFootprint.width) <= 0.02 &&
      Math.abs((record.activeDragPreview.fit?.itemSize?.depth ?? 99) - volumeResizeDragPoints.targetFootprint.depth) <= 0.02 &&
      Math.abs((record.activeDragPreview.supportPose?.occupiedPatch?.width ?? 99) - volumeResizeDragPoints.targetFootprint.width) <= 0.02 &&
      Math.abs((record.activeDragPreview.supportPose?.occupiedPatch?.depth ?? 99) - volumeResizeDragPoints.targetFootprint.depth) <= 0.02
    ) &&
      planVolumeResizeDuringBackend.mutationBundle.draftOps.surfacePlacementPrechecks.length === beforeVolumeResizePrecheckCount,
    "backend contract exposes resized active drag preview before commit",
    {
      duringBackend: planVolumeResizeDuringBackend.writeModelPreview.supportSurfaceRecords,
      backend: planVolumeResizeBackend.writeModelPreview.supportSurfaceRecords
    }
  );
  assert(
    resizeCommitPreview?.status === "manual" &&
      resizeCommitPreviewSnapshot.plan?.phase === "resize_confirm_pending" &&
      resizeCommitPreviewSnapshot.plan?.geometryDirty === "true" &&
      Math.abs(resizeCommitPreviewSnapshot.plan.originalWidth - beforeResizeCommitItem.footprint.width) <= 0.001 &&
      Math.abs(resizeCommitPreviewSnapshot.plan.candidateWidth - resizeCommitDragPoints.targetFootprint.width) <= 0.02 &&
      resizeCommitUiDraft.preview?.phase === "resize_confirm_pending" &&
      resizeCommitUiDraft.preview?.dirty === "true" &&
      resizeCommitUiDraft.draft?.itemId === resizeCommitItem.id &&
      resizeCommitUiDraft.confirm?.mode === "geometry+placement" &&
      resizeCommitUiDraft.confirm?.text === "Confirm Size + Placement" &&
      resizeCommitUiDraft.confirm?.disabled === false &&
      resizeCommitUiDraft.discard?.text === "Discard Resize",
    "resized volume preview exposes explicit size draft confirm UI",
    {
      preview: resizeCommitPreviewSnapshot.plan,
      ui: resizeCommitUiDraft,
      target: resizeCommitDragPoints.targetFootprint
    }
  );
  assert(
    resizeCommitPlacement?.status === "confirmed" &&
      resizeCommitPlacement.commit?.geometryChanged === true &&
      Math.abs(afterResizeCommitItem.footprint.width - resizeCommitDragPoints.targetFootprint.width) <= 0.02 &&
      Math.abs(afterResizeCommitItem.footprint.depth - resizeCommitDragPoints.targetFootprint.depth) <= 0.02 &&
      Math.abs(beforeResizeCommitItem.footprint.width - 0.06) <= 0.001 &&
      Math.abs(beforeResizeCommitItem.footprint.depth - 0.06) <= 0.001 &&
      Math.abs((resizeCommitRenderedItem?.footprintShadow?.width ?? 99) - resizeCommitDragPoints.targetFootprint.width) <= 0.02 &&
      Math.abs((resizeCommitRenderedItem?.footprintShadow?.depth ?? 99) - resizeCommitDragPoints.targetFootprint.depth) <= 0.02,
    "resized volume commit updates item footprint and 3D item mesh",
    {
      before: beforeResizeCommitItem.footprint,
      after: afterResizeCommitItem.footprint,
      rendered: resizeCommitRenderedItem,
      commit: resizeCommitPlacement?.commit
    }
  );
  assert(
    resizeCommitRenderedItem?.silhouette?.scaledToFootprint &&
      Math.abs((resizeCommitRenderedItem.silhouette.bounds.width ?? 99) - resizeCommitDragPoints.targetFootprint.width) <= 0.08 &&
      Math.abs((resizeCommitRenderedItem.silhouette.bounds.depth ?? 99) - resizeCommitDragPoints.targetFootprint.depth) <= 0.08 &&
      Math.abs((resizeCommitRenderedItem.silhouette.bounds.height ?? 99) - afterResizeCommitItem.footprint.height) <= 0.08,
    "resized volume commit updates 3D silhouette bounds not only footprint shadow",
    {
      rendered: resizeCommitRenderedItem?.silhouette,
      target: resizeCommitDragPoints.targetFootprint
    }
  );
  assert(
    resizeCommitLedgerEntry?.geometryChanged === true &&
      resizeCommitGeometryOp &&
      resizeCommitPlacementOp &&
      resizeCommitPlacementOp.causedByGeometryOpId === resizeCommitGeometryOp.id &&
      resizeCommitGeometryOp.beforeFootprint?.width === beforeResizeCommitItem.footprint.width &&
      Math.abs(resizeCommitGeometryOp.afterFootprint?.width - resizeCommitDragPoints.targetFootprint.width) <= 0.02 &&
      resizeCommitPlacement.commit?.geometryOpId === resizeCommitGeometryOp.id &&
      resizeCommitPlacement.precheck?.result?.geometryOpId === resizeCommitGeometryOp.id,
    "resized volume commit appends item geometry and support placement ops",
    {
      returnedCommit: resizeCommitPlacement?.commit,
      ledger: resizeCommitLedgerEntry
    }
  );
  assert(
    resizeCommitGeometryRecord?.op === "update_item_geometry_record" &&
      resizeCommitGeometryRecord.commitId === resizeCommitPlacement.commit?.id &&
      resizeCommitPreviewGeometryRecord?.op === "update_item_geometry_record" &&
      resizeCommitPreviewGeometryRecord.commitId === resizeCommitPlacement.commit?.id &&
      !resizeCommitBackend.mutationBundle.draftOps.placementOps.some((op) =>
        op.type === "commit_item_geometry_update" &&
        op.itemId === resizeCommitItem.id
      ) &&
      resizeCommitPlacementRecord?.geometryOpId === resizeCommitGeometryOp?.id &&
      resizeCommitPlacementRecord?.commitId === resizeCommitPlacement.commit?.id &&
      Math.abs((resizeCommitPlacementRecord?.footprint?.width ?? 99) - resizeCommitDragPoints.targetFootprint.width) <= 0.02 &&
      Math.abs((resizeCommitPlacementRecord?.supportPose?.local?.x ?? 99) - resizeCommitPreview.supportPose.local.x) <= 0.02 &&
      resizeCommitFinalBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
        record.id === "surface-desk-top" &&
        record.activeDragPreview === null &&
        record.occupancy.some((entry) => entry.itemId === resizeCommitItem.id && entry.geometryOpId === resizeCommitGeometryOp?.id)
      ) &&
      resizeCommitBackendDom.writeModelPreview.placementRecords.some((record) =>
        record.subjectRef === `item:${resizeCommitItem.id}` &&
        record.geometryOpId === resizeCommitGeometryOp?.id
      ),
    "backend contract exposes committed resized geometry op and placement record footprint",
    {
      geometryRecord: resizeCommitGeometryRecord,
      commitPreviewGeometryRecord: resizeCommitPreviewGeometryRecord,
      placementRecord: resizeCommitPlacementRecord,
      placementOps: resizeCommitBackend.mutationBundle.draftOps.placementOps,
      surfaceRecords: resizeCommitFinalBackend.writeModelPreview.supportSurfaceRecords
    }
  );
  assert(
    snappedDragPreview?.status === "snapped" &&
      snappedDragPreview.reasonCode === "fits_clear_snapped" &&
      snappedDragPreview.supportPose?.snapped &&
      snappedDragPreview.supportPose.poseSource === "auto_snapped" &&
      snappedDragPreview.collision.centerBlockerIds.includes("earphones") &&
      snappedDragSnapshot.visual.status === "snapped" &&
      afterSnappedDragCharger.currentPlacement.id === beforeCollisionCharger.currentPlacement.id,
    "drag preview exposes snapped support pose before drop",
    { snappedDragPreview, snappedDragSnapshot, afterSnappedDragCharger: afterSnappedDragCharger.currentPlacement }
  );
  assert(
    snappedChargerPlacement?.status === "confirmed" &&
      afterSnappedChargerPlacement.currentPlacement.surfaceId === "surface-desk-top" &&
      afterSnappedChargerPlacement.currentPlacement.supportPose?.snapped &&
      Math.abs(afterSnappedChargerPlacement.currentPlacement.supportPose.local.x) + Math.abs(afterSnappedChargerPlacement.currentPlacement.supportPose.local.z) > 0,
    "item can be confirmed on shared support surface after snapped precheck",
    { snappedChargerPlacement, afterSnappedChargerPlacement }
  );
  assert(
    manualCommitPreview?.status === "manual" &&
      manualCommitPlacement?.status === "confirmed" &&
      manualCommitPlacement.precheck?.reasonCode === "fits_clear_manual" &&
      manualCommitPlacement.precheck?.result?.status === "confirmed" &&
      matchesManualCommitLocal(manualCommitPlacement.precheck?.supportPose),
    "manual patch commit creates a confirmed support precheck",
    { manualCommitPreview, manualCommitPlacement }
  );
  assert(
    manualCommitBackend.mutationBundle.draftOps.placementOps.some((op) =>
      op.type === "support_surface_placement" &&
      op.itemId === manualCommitItem.id &&
      op.status === "confirmed" &&
      op.precheckId === manualCommitPlacement.precheck?.id &&
      matchesManualCommitLocal(op.candidatePose?.supportPose)
    ),
    "manual patch commit preserves user chosen support-local coordinate in support placement op",
    manualCommitBackend.mutationBundle.draftOps.placementOps
  );
  assert(
    afterManualCommitPlacement.currentPlacement.surfaceId === "surface-desk-top" &&
      afterManualCommitPlacement.currentPlacement.precheckId === manualCommitPlacement.precheck?.id &&
      matchesManualCommitLocal(afterManualCommitPlacement.currentPlacement.supportPose) &&
      manualCommitBackend.writeModelPreview.placementRecords.some((record) =>
        record.subjectRef === `item:${manualCommitItem.id}` &&
        record.surfaceId === "surface-desk-top" &&
        record.precheckId === manualCommitPlacement.precheck?.id &&
        matchesManualCommitLocal(record.supportPose)
      ),
    "manual patch commit preserves user chosen support-local coordinate in placement record",
    {
      placement: afterManualCommitPlacement.currentPlacement,
      records: manualCommitBackend.writeModelPreview.placementRecords
    }
  );
  assert(
    manualCommitBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.occupancy.some((entry) =>
        entry.itemId === manualCommitItem.id &&
        matchesManualCommitLocal(entry.supportPose) &&
        Math.abs((entry.occupiedPatch?.x ?? 99) - manualCommitLocal.x) <= 0.01 &&
        Math.abs((entry.occupiedPatch?.z ?? 99) - manualCommitLocal.z) <= 0.01
      )
    ),
    "backend support surface records preserve committed manual occupied patch",
    manualCommitBackend.writeModelPreview.supportSurfaceRecords
  );
  assert(
    manualCommitBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks.some((precheck) =>
      precheck.itemId === manualCommitItem.id &&
      precheck.id === manualCommitPlacement.precheck?.id &&
      precheck.result?.status === "confirmed" &&
      precheck.copy?.uiStatus === "confirmed" &&
      matchesManualCommitLocal(precheck.supportPose)
    ),
    "rendered backend preview preserves committed manual precheck copy",
    manualCommitBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks
  );
  assert(
    manualCommitBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.activeDragPreview?.itemId === manualCommitItem.id &&
      record.activeDragPreview?.persistedPrecheckId === manualCommitPlacement.precheck?.id &&
      matchesManualCommitLocal(record.activeDragPreview?.supportPose)
    ),
    "manual drag preview links to persisted precheck after commit",
    manualCommitBackend.writeModelPreview.supportSurfaceRecords
  );
  assert(
    manualCommitBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.latestPrecheck?.itemId === manualCommitItem.id &&
      record.latestPrecheck?.itemLabel === "Manual patch marker" &&
      record.latestPrecheck?.resultPlacementId === afterManualCommitPlacement.currentPlacement.id &&
      record.latestPrecheck?.result?.status === "confirmed" &&
      record.latestPrecheck?.copy?.uiStatus === "confirmed" &&
      matchesManualCommitLocal(record.latestPrecheck?.supportPose)
    ),
    "backend support surface latest precheck preserves committed manual patch",
    manualCommitBackend.writeModelPreview.supportSurfaceRecords
  );
  assert(
    manualCommitPlacement.commit?.type === "support_surface_placement" &&
      manualCommitPlacement.commit.precheckId === manualCommitPlacement.precheck?.id &&
      manualCommitPlacement.commit.placementId === afterManualCommitPlacement.currentPlacement.id &&
      manualCommitFinalBackend.commitPreview.commitLedgerEntries.some((entry) =>
        entry.id === manualCommitPlacement.commit.id &&
        entry.type === "support_surface_placement" &&
        entry.ops.some((op) =>
          op.type === "commit_support_surface_placement" &&
          op.precheckId === manualCommitPlacement.precheck?.id &&
          op.persistedPrecheckId === manualCommitPlacement.precheck?.id &&
          matchesManualCommitLocal(op.supportPose)
        )
      ),
    "manual patch commit appends support placement commit ledger entry",
    {
      returnedCommit: manualCommitPlacement.commit,
      ledger: manualCommitFinalBackend.commitPreview.commitLedgerEntries
    }
  );
  assert(
    afterManualCommitPlacement.currentPlacement.commitId === manualCommitPlacement.commit?.id &&
      afterManualCommitPlacement.currentPlacement.supportPlacementCommitId === manualCommitPlacement.commit?.id &&
      manualCommitFinalBackend.writeModelPreview.placementRecords.some((record) =>
        record.subjectRef === `item:${manualCommitItem.id}` &&
        record.commitId === manualCommitPlacement.commit?.id &&
        record.supportPlacementCommitId === manualCommitPlacement.commit?.id &&
        record.precheckId === manualCommitPlacement.precheck?.id &&
        matchesManualCommitLocal(record.supportPose)
      ),
    "manual patch placement record carries support placement commit id",
    {
      placement: afterManualCommitPlacement.currentPlacement,
      records: manualCommitFinalBackend.writeModelPreview.placementRecords
    }
  );
  assert(
    manualCommitFinalBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.activeDragPreview === null
    ) &&
      manualCommitFinalBackendDom.writeModelPreview.supportSurfaceRecords.some((record) =>
        record.id === "surface-desk-top" &&
        record.activeDragPreview === null
      ),
    "manual patch final readback clears active drag preview after commit",
    {
      snapshot: manualCommitFinalBackend.writeModelPreview.supportSurfaceRecords,
      dom: manualCommitFinalBackendDom.writeModelPreview.supportSurfaceRecords
    }
  );
  assert(
    blockedDragPreview?.status === "blocked" &&
      blockedDragPreview.reasonCode === "surface_occupied" &&
      !blockedDragPreview.canCommit &&
      blockedDragPreview.blockedByCheckIds?.length >= 1 &&
      blockedDragPreview.collision.blockers.some((blocker) => blocker.itemId === "earphones" || blocker.itemId === "charger"),
    "drag preview exposes blocked support collision before drop",
    blockedDragPreview
  );
  assert(
    afterBlockedDragCandidate.currentPlacement.id === beforeBlockedDragCandidate.currentPlacement.id &&
      afterBlockedDragCandidate.currentPlacement.surfaceId !== "surface-desk-top",
    "blocked drag preview preserves placement before drop",
    { before: beforeBlockedDragCandidate.currentPlacement, after: afterBlockedDragCandidate.currentPlacement }
  );
  assert(
    blockedDragBackend.commitPreview.dragPlacementGate.blockingCheckIds.length > 0 &&
      JSON.stringify([...blockedDragBackend.commitPreview.dragPlacementGate.blockingCheckIds].sort()) ===
        JSON.stringify([...blockedDragBackend.mutationBundle.draftOps.dragPlacementPreviews[0].blockedByCheckIds].sort()),
    "commit preview gate reuses drag preview blocking check ids",
    {
      gate: blockedDragBackend.commitPreview.dragPlacementGate,
      previews: blockedDragBackend.mutationBundle.draftOps.dragPlacementPreviews
    }
  );
  assert(
    blockedDragBackend.writeModelPreview.collisionResults.supportSurfaceChecks.some((check) =>
      check.previewSessionId === blockedDragPreview.previewSessionId &&
      check.causedByDragPreviewOpId === blockedDragPreview.previewOpId &&
      check.status === "blocked" &&
      check.uiStatusSnapshot?.uiStatus === "blocked"
    ),
    "drag preview support checks carry preview causal ids",
    blockedDragBackend.writeModelPreview.collisionResults.supportSurfaceChecks
  );
  assert(saturatedCollisionPrecheck?.status === "blocked" && saturatedCollisionPrecheck.reasonCode === "surface_occupied" && saturatedCollisionPrecheck.collision.blockers.some((blocker) => blocker.itemId === "earphones" || blocker.itemId === "charger"), "support collision gate only blocks when no free support patch exists", saturatedCollisionPrecheck);
  assert(saturatedCollisionPrecheck?.supportPose?.occupiedPatch?.width > 0 && saturatedCollisionPrecheck.collision.blockers.some((blocker) => blocker.occupiedPatch?.width > 0), "support collision precheck records candidate and blocker occupied patches", saturatedCollisionPrecheck);
  assert(afterSaturatedCandidate.currentPlacement.surfaceId !== "surface-desk-top" && afterSaturatedCandidate.currentPlacement.id === saturatedCandidate.currentPlacement.id, "blocked saturated support attempt preserves prior placement", { before: saturatedCandidate.currentPlacement, after: afterSaturatedCandidate.currentPlacement });
  assert(blockedFitPrecheck?.status === "blocked" && blockedFitPrecheck.reasonCode === "does_not_fit_surface", "oversized item fails support surface fit precheck", blockedFitPrecheck);
  assert(blockedFitPrecheck?.parentFurnitureId === "desk" && blockedFitPrecheck?.containerId === "desk-right-side", "container support surface resolves to both container and owning furniture", blockedFitPrecheck);
  assert(afterFitLaundry.currentPlacement.id === beforeFitLaundry.currentPlacement.id && afterFitLaundry.currentPlacement.surfaceId !== "surface-desk-right-side-base", "blocked fit attempt preserves prior placement", { before: beforeFitLaundry.currentPlacement, after: afterFitLaundry.currentPlacement });
  assert(supportPrecheckDom.some((item) => item.status === "blocked" && item.reason === "does_not_fit_surface"), "right panel renders blocked support surface precheck", supportPrecheckDom);
  assert(
    supportBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-right-side-base" &&
      record.latestPrecheck?.copy?.uiStatus === "blocked" &&
      record.latestPrecheck?.copy?.title === "Can't place here" &&
      record.latestPrecheck?.blockedByCheckIds?.length >= 1
    ),
    "backend support surface records preserve blocked latest-precheck copy",
    supportBackend.writeModelPreview.supportSurfaceRecords
  );
  assert(
    supportBlockedBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks.some((precheck) =>
      precheck.id === blockedFitPrecheck.id &&
      precheck.copy?.uiStatus === "blocked" &&
      precheck.copy?.title === "Can't place here" &&
      /too tall by 38cm/.test(precheck.copy?.reasonText ?? "") &&
      precheck.suggestedAction === "choose a larger surface or rotate/use different container"
    ),
    "rendered backend preview preserves blocked precheck copy",
    supportBlockedBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks
  );
  assert(supportBackend.writeModelPreview.supportSurfaceRecords.some((record) => record.id === "surface-desk-right-side-base"), "backend contract exposes support surface records", supportBackend.writeModelPreview.supportSurfaceRecords);
  assert(
    supportBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-right-side-base" &&
      record.ownerRef === "furniture:desk" &&
      record.placeRef === "container:desk-right-side" &&
      record.usableFootprint?.width > 0 &&
      record.clearanceHeight > record.renderThickness &&
      Number.isFinite(record.accuracyCm)
    ),
    "backend support surface records distinguish usable footprint clearance and owner",
    supportBackend.writeModelPreview.supportSurfaceRecords
  );
  assert(
    supportBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.occupancy.some((entry) => entry.itemId === "earphones" && entry.occupiedPatch?.width > 0)
    ),
    "backend support surface records expose occupied patches",
    supportBackend.writeModelPreview.supportSurfaceRecords
  );
  assert(
    supportBackend.writeModelPreview.placementRecords.some((record) =>
      record.subjectRef === "item:earphones" &&
      record.surfaceId === "surface-desk-top" &&
      record.supportPose?.occupiedPatch?.width > 0
    ),
    "backend placement records preserve support-local pose",
    supportBackend.writeModelPreview.placementRecords
  );
  assert(
    supportBackend.writeModelPreview.placementRecords.some((record) =>
      record.subjectRef === `item:${manualCommitItem.id}` &&
      record.surfaceId === "surface-desk-top" &&
      record.commitId === manualCommitPlacement.commit?.id &&
      record.supportPlacementCommitId === manualCommitPlacement.commit?.id &&
      matchesManualCommitLocal(record.supportPose)
    ) &&
      supportBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
        record.id === "surface-desk-top" &&
        record.occupancy.some((entry) =>
          entry.itemId === manualCommitItem.id &&
          entry.commitId === manualCommitPlacement.commit?.id &&
          entry.supportPlacementCommitId === manualCommitPlacement.commit?.id &&
          matchesManualCommitLocal(entry.supportPose)
        )
      ),
    "manual patch commit survives later surface precheck via placement record and occupancy readback",
    {
      placementRecords: supportBackend.writeModelPreview.placementRecords,
      supportSurfaceRecords: supportBackend.writeModelPreview.supportSurfaceRecords
    }
  );
  assert(supportBackend.mutationBundle.draftOps.placementOps.some((op) => op.type === "support_surface_placement" && op.status === "confirmed" && !op.canCommit), "mutation bundle exposes confirmed support placement op", supportBackend.mutationBundle.draftOps.placementOps);
  assert(supportBackend.mutationBundle.draftOps.placementOps.some((op) => op.type === "support_surface_placement" && op.status === "blocked" && op.blockedByCheckIds.length), "mutation bundle exposes blocked support placement op", supportBackend.mutationBundle.draftOps.placementOps);
  assert(
    supportBackend.mutationBundle.draftOps.placementOps.some((op) =>
      op.type === "support_surface_placement" &&
      op.status === "blocked" &&
      op.checkIds?.length === 3 &&
      op.blockedByCheckIds.length &&
      op.copy?.uiStatus === "blocked"
    ),
    "support placement ops expose full check ids for blocked prechecks",
    supportBackend.mutationBundle.draftOps.placementOps
  );
  assert(supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.some((check) => check.checkType === "support_collision" && check.status === "blocked" && check.conflictingPlacementId), "collision results expose structured support collision checks", supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks);
  assert(supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.some((check) => check.checkType === "surface_fit" && check.status === "blocked"), "collision results expose structured support fit checks", supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks);
  assert(
    supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.every((check) =>
      check.precheckResultId &&
      check.causedByPrecheckId &&
      check.causedByPrecheckOpId &&
      check.causedByPlacementOpId &&
      check.checkBatchId &&
      check.uiStatusSnapshot?.uiStatus
    ),
    "support surface checks carry causal ids and ui snapshots",
    supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks
  );
  assert(
    supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.some((check) =>
      check.checkType === "support_collision" &&
      check.status === "blocked" &&
      check.causedByPrecheckId === saturatedCollisionPrecheck.id &&
      check.causedByPlacementOpId === `op-support-placement-${saturatedCollisionPrecheck.id}`
    ),
    "support collision checks expose causal precheck and placement op ids",
    supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks
  );
  assert(
    supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.some((check) =>
      check.checkType === "support_collision" &&
      check.status === "blocked" &&
      check.candidatePatch?.width > 0 &&
      check.blockerPatch?.width > 0
    ),
    "support collision checks expose candidate and blocker patches",
    supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks
  );
  assert(
    supportBackend.mutationBundle.draftOps.placementOps.some((op) =>
      op.precheckId === snappedChargerPrecheck.id &&
      op.status === "confirmed" &&
      op.candidatePose?.supportPose?.snapped &&
      op.candidatePose.x === snappedChargerPrecheck.supportPose.worldCenter.x &&
      op.candidatePose.z === snappedChargerPrecheck.supportPose.worldCenter.z
    ),
    "support placement op candidate pose matches snapped support world center",
    supportBackend.mutationBundle.draftOps.placementOps
  );
  assert(
    supportBackend.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.id === "surface-desk-top" &&
      record.occupancy.filter((entry) => entry.occupiedPatch?.width > 0).length >= 2
    ),
    "backend support surface records preserve multiple occupied patches on one surface",
    supportBackend.writeModelPreview.supportSurfaceRecords
  );
  assert(
    afterLayout.supportOccupancyVisuals?.some((entry) => entry.itemId === "earphones" && entry.surfaceId === "surface-desk-top") &&
      afterLayout.supportOccupancyVisuals?.some((entry) => entry.itemId === "charger" && entry.surfaceId === "surface-desk-top"),
    "3D renders support-local occupancy patches for shared surface",
    afterLayout.supportOccupancyVisuals
  );
  assert(
    afterLayout.containerOccupancySilhouettes?.some((entry) =>
      entry.kind === "container_occupancy_silhouette" &&
      entry.itemId === "earphones" &&
      entry.surfaceId === "surface-desk-top" &&
      entry.itemArchetype === "cable_loop" &&
      entry.occupiedPatch?.width > 0 &&
      entry.visible
    ) &&
      afterLayout.containerOccupancySilhouettes?.some((entry) =>
        entry.itemId === "charger" &&
        entry.surfaceId === "surface-desk-top" &&
        entry.itemArchetype === "plug_charger" &&
        entry.worldCenter?.x !== undefined
      ) &&
      supportBackend.commitPreview.containerOccupancySilhouettes?.some((entry) =>
        entry.itemId === "charger" &&
        entry.supportPlacementCommitId
      ),
    "container occupancy silhouettes expose item archetype patch and world pose",
    {
      layout: afterLayout.containerOccupancySilhouettes,
      backend: supportBackend.commitPreview.containerOccupancySilhouettes
    }
  );
  assert(supportBackend.commitPreview.supportPlacementGate.canCommit === false && supportBackend.commitPreview.supportPlacementGate.blockingCheckIds.length >= 2, "commit preview blocks invalid support placements", supportBackend.commitPreview.supportPlacementGate);
  assert(
    (() => {
      const checkIds = new Set(supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.map((check) => check.id));
      const blockedOps = supportBackend.mutationBundle.draftOps.placementOps.filter((op) => op.type === "support_surface_placement" && op.status === "blocked");
      return blockedOps.length > 0 && blockedOps.every((op) => op.blockedByCheckIds.every((id) => checkIds.has(id)));
    })(),
    "blocked support placement ops reference concrete support check ids",
    {
      ops: supportBackend.mutationBundle.draftOps.placementOps,
      checks: supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks
    }
  );
  assert(
    (() => {
      const fromOps = [...new Set(supportBackend.mutationBundle.draftOps.placementOps
        .filter((op) => op.type === "support_surface_placement" && op.status === "blocked")
        .flatMap((op) => op.blockedByCheckIds))].sort();
      const fromGate = [...supportBackend.commitPreview.supportPlacementGate.blockingCheckIds].sort();
      return fromOps.length > 0 && JSON.stringify(fromOps) === JSON.stringify(fromGate);
    })(),
    "commit preview gate reuses blocked support check ids",
    supportBackend.commitPreview.supportPlacementGate
  );
  assert(
    supportBackend.commitPreview.supportPlacementGate.blockingChecks.every((check) =>
      check.id &&
      check.causedByPrecheckOpId &&
      check.causedByPlacementOpId &&
      check.uiStatus
    ),
    "commit preview exposes causal blocking support checks",
    supportBackend.commitPreview.supportPlacementGate.blockingChecks
  );
  assert(afterLayout.affectedPlacements.length > 0, "furniture edits create child placement review records", afterLayout.affectedPlacements);
  assert(afterLayout.placementPrechecks.some((precheck) => precheck.status === "stale" && precheck.parentFurnitureId === "desk"), "parent furniture edits invalidate support surface prechecks", afterLayout.placementPrechecks);
  assert(
    staleConfirmedPrecheckDom.some((item) =>
      item.id === allowedSupportPrecheck.id &&
      item.status === "stale" &&
      item.previousStatus === "ready" &&
      item.uiSource === "geometry_invalidated" &&
      /Needs recheck/.test(item.text) &&
      /Placed item needs review/.test(item.text)
    ),
    "right panel preserves confirmed-to-stale support precheck copy",
    staleConfirmedPrecheckDom
  );
  assert(
    staleConfirmedBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks.some((precheck) =>
      precheck.id === allowedSupportPrecheck.id &&
      precheck.status === "stale" &&
      precheck.previousStatus === "allowed" &&
      precheck.result?.status === "confirmed" &&
      precheck.copy?.uiStatus === "stale" &&
      precheck.copy?.previousStatus === "ready" &&
      precheck.copy?.resultStatus === "confirmed"
    ),
    "rendered backend preview preserves confirmed-to-stale precheck copy",
    staleConfirmedBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks
  );
  assert(
    staleDragPreview?.status === "stale" &&
      staleDragPreview.copy?.uiStatus === "stale" &&
      staleDragPreview.previousStatus === "allowed" &&
      staleDragPreview.causedByGeometryOpId &&
      staleDragSnapshot.visual.status === "stale",
    "drag preview exposes stale support precheck before drop",
    { staleDragPreview, staleDragSnapshot }
  );
  assert(
    afterStaleDragEarphones.currentPlacement.id === beforeStaleDragEarphones.currentPlacement.id &&
      staleDragBackend.mutationBundle.draftOps.dragPlacementPreviews.some((op) =>
        op.status === "stale" &&
        op.blockedByCheckIds.length &&
        op.copy?.uiStatus === "stale"
      ),
    "stale drag preview preserves placement before drop",
    {
      before: beforeStaleDragEarphones.currentPlacement,
      after: afterStaleDragEarphones.currentPlacement,
      previews: staleDragBackend.mutationBundle.draftOps.dragPlacementPreviews
    }
  );
  assert(staleSupportPrecheckDom.some((item) => item.status === "stale" && item.previousStatus && item.uiSource === "geometry_invalidated" && /Needs recheck/.test(item.text)), "right panel renders stale support precheck with previous status", staleSupportPrecheckDom);
  assert(
    staleSupportPrecheckDom.some((item) =>
      item.id === blockedFitPrecheck.id &&
      item.status === "stale" &&
      item.previousStatus === "blocked" &&
      /Previous block may no longer apply/.test(item.text)
    ),
    "right panel preserves blocked-to-stale support precheck copy",
    staleSupportPrecheckDom
  );
  assert(
    staleBlockedBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks.some((precheck) =>
      precheck.id === blockedFitPrecheck.id &&
      precheck.status === "stale" &&
      precheck.previousStatus === "blocked" &&
      precheck.copy?.uiStatus === "stale" &&
      precheck.copy?.previousStatus === "blocked" &&
      /Previous block may no longer apply/.test(precheck.copy?.reasonText ?? "")
    ),
    "rendered backend preview preserves blocked-to-stale precheck copy",
    staleBlockedBackendDom.mutationBundle.draftOps.surfacePlacementPrechecks
  );
  assert(backendContractAfterLayout.mutationBundle.draftOps.placementOps.some((op) => op.type === "support_surface_placement" && op.status === "stale" && !op.canCommit), "mutation bundle exposes stale support placement op after parent edit", backendContractAfterLayout.mutationBundle.draftOps.placementOps);
  assert(
    backendContractAfterLayout.writeModelPreview.supportSurfaceRecords.some((record) =>
      record.parentFurnitureId === "desk" &&
      record.latestPrecheck?.copy?.uiStatus === "stale" &&
      record.latestPrecheck?.causedByGeometryOpId &&
      record.latestPrecheck?.blockedByCheckIds?.length >= 1
    ),
    "backend support surface records preserve stale latest-precheck copy after parent edit",
    backendContractAfterLayout.writeModelPreview.supportSurfaceRecords
  );
  assert(
    (() => {
      const staleChecks = backendContractAfterLayout.writeModelPreview.collisionResults.supportSurfaceChecks.filter((check) => check.status === "stale");
      const staleCheckIds = new Set(staleChecks.map((check) => check.id));
      const staleOps = backendContractAfterLayout.mutationBundle.draftOps.placementOps.filter((op) => op.type === "support_surface_placement" && op.status === "stale");
      return staleOps.length > 0 &&
        staleChecks.every((check) => check.causedByGeometryOpId && check.uiStatusSnapshot?.uiStatus === "stale") &&
        staleOps.every((op) =>
          op.causedByGeometryOpId &&
          op.copy?.uiStatus === "stale" &&
          op.checkIds?.length === 3 &&
          op.blockedByCheckIds.every((id) => staleCheckIds.has(id))
        );
    })(),
    "stale support placement ops preserve causal support check ids after parent edit",
    {
      ops: backendContractAfterLayout.mutationBundle.draftOps.placementOps,
      checks: backendContractAfterLayout.writeModelPreview.collisionResults.supportSurfaceChecks
    }
  );
  assert(
    backendContractAfterLayout.mutationBundle.draftOps.geometryOps.some((op) => op.id?.startsWith("op-manual-geometry-desk-")),
    "mutation bundle exposes manual geometry ops causing stale support checks",
    backendContractAfterLayout.mutationBundle.draftOps.geometryOps
  );
  assert(backendContractAfterLayout.commitPreview.stalePlacementOps.length === afterLayout.affectedPlacements.length, "backend contract exposes stale placement ops after furniture edits", backendContractAfterLayout.commitPreview.stalePlacementOps);
  assert(backendContractAfterLayout.commitPreview.stalePlacementOps.every((op) => op.causedByGeometryOpId), "stale placement ops preserve geometry causality", backendContractAfterLayout.commitPreview.stalePlacementOps);
  assert(visibleAffectedPlacements.length === backendContractAfterLayout.commitPreview.stalePlacementOps.length && visibleAffectedPlacements.every((item) => item.itemLabel && item.parentLabel), "right panel names affected stale placements", visibleAffectedPlacements);
  assert(backendContractAfterLayout.writeModelPreview.placementRecords.some((record) => record.status === "needs_review"), "placement records expose needs-review status", backendContractAfterLayout.writeModelPreview.placementRecords);
  assert(
    backendContractAfterLayout.writeModelPreview.placementRecords.some((record) =>
      record.subjectRef === `item:${manualCommitItem.id}` &&
      record.status === "needs_review" &&
      record.surfaceId === "surface-desk-top" &&
      record.precheckId === manualCommitPlacement.precheck?.id &&
      record.commitId === manualCommitPlacement.commit?.id &&
      record.supportPlacementCommitId === manualCommitPlacement.commit?.id &&
      matchesManualCommitLocal(record.supportPose)
    ) &&
      backendContractAfterLayout.writeModelPreview.supportSurfaceRecords.some((record) =>
        record.id === "surface-desk-top" &&
        record.occupancy.some((entry) =>
          entry.itemId === manualCommitItem.id &&
          entry.precheckId === manualCommitPlacement.precheck?.id &&
          entry.commitId === manualCommitPlacement.commit?.id &&
          entry.supportPlacementCommitId === manualCommitPlacement.commit?.id &&
          matchesManualCommitLocal(entry.supportPose)
        )
      ),
    "manual patch support-local pose survives parent geometry invalidation",
    {
      placementRecords: backendContractAfterLayout.writeModelPreview.placementRecords,
      supportSurfaceRecords: backendContractAfterLayout.writeModelPreview.supportSurfaceRecords
    }
  );
  assert(productAfterMove?.productInfo?.defaultPlace === "Desk, right side", "product default place survives current-place move", productAfterMove);
  assert(productAfterMove?.location !== productItem?.location, "product current location changes after move", { before: productItem?.location, after: productAfterMove?.location });
  assert(
    screenshotStats["room-recall-orbit-check.png"]?.canvas?.pixelHash !== screenshotStats["room-recall-desktop.png"]?.canvas?.pixelHash,
    "3D orbit interaction changes rendered scene pixels",
    {
      before: screenshotStats["room-recall-desktop.png"]?.canvas,
      after: screenshotStats["room-recall-orbit-check.png"]?.canvas
    }
  );
  assert(planAudit.snapshot.projectionMode === "plan2d", "2D plan projection mode is active after plan switch", planAudit.snapshot);
  assert(scan3dAudit.snapshot.projectionMode === "cutaway3d", "3D scan projection mode is active after scan switch", scan3dAudit.snapshot);
  assert(!mobileAudit.horizontalOverflow, "mobile viewport has no horizontal overflow", mobileAudit);
  const assertionFailures = assertions.filter((item) => !item.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    url: rootUrl,
    audits: [desktopBefore, desktopAfterOrbit, searchAudit, kitAudit, planAudit, scan3dAudit, layoutAudit, mobileAudit],
    screenshotStats,
    assertions,
    interaction: {
      movedWaterBottle: {
        before: beforeMove,
        after: afterMove,
        notThereDraft,
        contradictedPlacement: contradictedWaterBottle.currentPlacement,
        correctionDraft: correctedSnapshot,
        commitLedgerEntryId: correctionCommit?.id ?? null,
        futureAnswerImproved: futureLocateWaterBottle.currentPlacement.commitId === correctionCommit?.id &&
          futureLocateWaterBottle.currentPlacement.source === "corrected placement",
        changed: Math.abs(beforeMove.x - afterMove.x) > 0.1 || Math.abs(beforeMove.z - afterMove.z) > 0.1
      },
      orbitChangedPixels:
        screenshotStats["room-recall-orbit-check.png"].canvas.pixelHash !==
        screenshotStats["room-recall-desktop.png"].canvas.pixelHash,
      searchSelectedWaterBottle: searchAudit.snapshot.selectedId === "water-bottle",
      fitnessKitCount: kitAudit.snapshot.activeIds.length,
      planMode: planAudit.snapshot.projectionMode,
      layoutPlanner: {
        reviewedVisionDraft: afterLayout.visionDraftReviewed,
        scan3dMode: scan3dAudit.snapshot.projectionMode,
        scan3dTool: scan3dAudit.snapshot.tool,
        proposalCount: scanDraftBeforeCommit.proposals.length,
        mixedProposalStatuses: mixedScanDraft.proposals.map((proposal) => ({ id: proposal.id, status: proposal.status })),
        selectedProposalId: mixedScanDraft.selectedProposalId,
        scanPipeline: scanPipelineSnapshot.active.id,
        backendStages: backendContract.observationInbox.stages,
        panelSections,
        writeModelRecordCounts: {
          anchors: backendContract.writeModelPreview.anchorRecords.length,
          geometry: backendContract.writeModelPreview.geometryRecords.length,
          placements: backendContract.writeModelPreview.placementRecords.length
        },
        mutationBundleShape: {
          hasObservationRecords: Array.isArray(committedBackend.mutationBundle?.observationRecords),
          hasDraftOps: Boolean(committedBackend.mutationBundle?.draftOps),
          hasResultingRecords: Boolean(committedBackend.mutationBundle?.resultingRecords),
          placementOps: committedBackend.mutationBundle?.draftOps?.placementOps?.length ?? 0,
          evidenceRecords: committedBackend.mutationBundle?.evidenceRecords?.length ?? 0
        },
        renderedFurnitureCount: afterLayout.renderedFurniture.length,
        renderedFurnitureIds: afterLayout.renderedFurniture.map((item) => item.id),
        supportSurfaceCount: supportSurfaces.length,
        selectedSupportSurfaceId: selectedSupportSurface?.id ?? null,
        supportPrecheckStats: {
          hoverTargetable: hoverSnapshot.hoveredSurfaceId === "surface-desk-top",
          hoverMutatedPrechecks: precheckCountAfterHover !== precheckCountBeforeHover,
          hoverDomVisible: Boolean(hoverDom.chip?.visible),
          allowedBeforeConfirm: allowedSupportPrecheck?.status === "allowed",
          snappedReady: snappedChargerPrecheck?.reasonCode === "fits_clear_snapped",
          snappedConfirmed: snappedChargerPlacement?.status === "confirmed",
          snapReason: snappedChargerPrecheck?.supportPose?.snapReason ?? null,
          snapLocal: snappedChargerPrecheck?.supportPose?.local ?? null,
          centerBlockerIds: snappedChargerPrecheck?.collision?.centerBlockerIds ?? [],
          saturatedBlocked: saturatedCollisionPrecheck?.reasonCode === "surface_occupied",
          collisionBlocked: saturatedCollisionPrecheck?.reasonCode === "surface_occupied",
          fitBlocked: blockedFitPrecheck?.reasonCode === "does_not_fit_surface",
          staleAfterParentEdit: afterLayout.placementPrechecks.some((precheck) => precheck.status === "stale" && precheck.parentFurnitureId === "desk")
        },
        supportCheckCausality: {
          checkCount: supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.length,
          blockedOpsResolveCheckIds: (() => {
            const checkIds = new Set(supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.map((check) => check.id));
            return supportBackend.mutationBundle.draftOps.placementOps
              .filter((op) => op.type === "support_surface_placement" && op.status === "blocked")
              .every((op) => op.blockedByCheckIds.every((id) => checkIds.has(id)));
          })(),
          gateMatchesBlockedOps: (() => {
            const fromOps = [...new Set(supportBackend.mutationBundle.draftOps.placementOps
              .filter((op) => op.type === "support_surface_placement" && op.status === "blocked")
              .flatMap((op) => op.blockedByCheckIds))].sort();
            const fromGate = [...supportBackend.commitPreview.supportPlacementGate.blockingCheckIds].sort();
            return JSON.stringify(fromOps) === JSON.stringify(fromGate);
          })(),
          supportCollisionCheckId: supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.find((check) => check.checkType === "support_collision" && check.status === "blocked")?.id ?? null,
          snappedPrecheckId: snappedChargerPrecheck?.id ?? null,
          snappedCollisionCheckId: supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.find((check) =>
            check.checkType === "support_collision" &&
            check.causedByPrecheckId === snappedChargerPrecheck.id
          )?.id ?? null,
          snappedCandidatePatch: supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.find((check) =>
            check.checkType === "support_collision" &&
            check.causedByPrecheckId === snappedChargerPrecheck.id
          )?.candidatePatch ?? null,
          snappedCenterBlockerIds: supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.find((check) =>
            check.checkType === "support_collision" &&
            check.causedByPrecheckId === snappedChargerPrecheck.id
          )?.centerBlockerIds ?? [],
          saturatedCollisionCheckId: supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.find((check) =>
            check.checkType === "support_collision" &&
            check.status === "blocked" &&
            check.causedByPrecheckId === saturatedCollisionPrecheck.id
          )?.id ?? null,
          fitCheckIds: supportBackend.writeModelPreview.collisionResults.supportSurfaceChecks.filter((check) => check.checkType !== "support_collision" && check.status === "blocked").map((check) => check.id),
          staleOpsWithGeometryCause: backendContractAfterLayout.mutationBundle.draftOps.placementOps.filter((op) => op.type === "support_surface_placement" && op.status === "stale" && op.causedByGeometryOpId).length,
          staleChecksWithGeometryCause: backendContractAfterLayout.writeModelPreview.collisionResults.supportSurfaceChecks.filter((check) => check.status === "stale" && check.causedByGeometryOpId).length,
          manualGeometryOps: backendContractAfterLayout.mutationBundle.draftOps.geometryOps.filter((op) => op.id?.startsWith("op-manual-geometry-")).map((op) => op.id),
          supportPoseRecorded: Boolean(afterSupportPlacement.currentPlacement.supportPose?.occupiedPatch?.width),
          snappedSupportPoseRecorded: Boolean(snappedChargerPrecheck.supportPose?.snapped),
          readyCopyPreserved: supportBackendAfterAllowedPrecheck.writeModelPreview.supportSurfaceRecords.some((record) => record.latestPrecheck?.copy?.uiStatus === "ready"),
          blockedCopyPreserved: supportBackend.writeModelPreview.supportSurfaceRecords.some((record) => record.latestPrecheck?.copy?.uiStatus === "blocked"),
          staleCopyPreserved: backendContractAfterLayout.writeModelPreview.supportSurfaceRecords.some((record) => record.latestPrecheck?.copy?.uiStatus === "stale")
        },
        supportPoseSnapping: {
          snappedChargerPrecheck: snappedChargerPrecheck
            ? {
                id: snappedChargerPrecheck.id,
                status: snappedChargerPrecheck.status,
                reasonCode: snappedChargerPrecheck.reasonCode,
                poseSource: snappedChargerPrecheck.supportPose?.poseSource ?? null,
                snapped: Boolean(snappedChargerPrecheck.supportPose?.snapped),
                local: snappedChargerPrecheck.supportPose?.local ?? null,
                centerBlockerIds: snappedChargerPrecheck.collision?.centerBlockerIds ?? []
              }
            : null,
          snappedChargerPlacement: snappedChargerPlacement
            ? {
                status: snappedChargerPlacement.status,
                surfaceId: snappedChargerPlacement.placement?.surfaceId ?? null,
                local: snappedChargerPlacement.placement?.supportPose?.local ?? null,
                snapped: Boolean(snappedChargerPlacement.placement?.supportPose?.snapped)
              }
            : null,
          saturatedCollisionPrecheck: saturatedCollisionPrecheck
            ? {
                id: saturatedCollisionPrecheck.id,
                status: saturatedCollisionPrecheck.status,
                reasonCode: saturatedCollisionPrecheck.reasonCode,
                blockerIds: saturatedCollisionPrecheck.collision?.blockers?.map((blocker) => blocker.itemId) ?? []
              }
            : null,
          supportSnapPrecheckDom,
          occupancyVisualCount: afterLayout.supportOccupancyVisuals?.length ?? 0,
          sharedDeskPatchCount: supportBackend.writeModelPreview.supportSurfaceRecords
            .find((record) => record.id === "surface-desk-top")
            ?.occupancy
            ?.filter((entry) => entry.occupiedPatch?.width > 0)
            .length ?? 0
        },
        supportDragPreview: {
          readyPreview: readyDragPreview
            ? {
                previewOpId: readyDragPreview.previewOpId,
                status: readyDragPreview.status,
                reasonCode: readyDragPreview.reasonCode,
                checkIds: readyDragPreview.checkIds,
                blockedByCheckIds: readyDragPreview.blockedByCheckIds,
                supportPose: readyDragPreview.supportPose,
                copy: readyDragPreview.copy
              }
            : null,
          snappedPreview: snappedDragPreview
            ? {
                previewOpId: snappedDragPreview.previewOpId,
                status: snappedDragPreview.status,
                reasonCode: snappedDragPreview.reasonCode,
                checkIds: snappedDragPreview.checkIds,
                blockedByCheckIds: snappedDragPreview.blockedByCheckIds,
                supportPose: snappedDragPreview.supportPose,
                centerBlockerIds: snappedDragPreview.collision?.centerBlockerIds ?? [],
                copy: snappedDragPreview.copy
              }
            : null,
          blockedPreview: blockedDragPreview
            ? {
                previewOpId: blockedDragPreview.previewOpId,
                status: blockedDragPreview.status,
                reasonCode: blockedDragPreview.reasonCode,
                checkIds: blockedDragPreview.checkIds,
                blockedByCheckIds: blockedDragPreview.blockedByCheckIds,
                supportPose: blockedDragPreview.supportPose,
                blockerIds: blockedDragPreview.collision?.blockers?.map((blocker) => blocker.itemId) ?? [],
                copy: blockedDragPreview.copy
              }
            : null,
          stalePreview: staleDragPreview
            ? {
                previewOpId: staleDragPreview.previewOpId,
                status: staleDragPreview.status,
                reasonCode: staleDragPreview.reasonCode,
                checkIds: staleDragPreview.checkIds,
                blockedByCheckIds: staleDragPreview.blockedByCheckIds,
                supportPose: staleDragPreview.supportPose,
                previousStatus: staleDragPreview.previousStatus,
                causedByGeometryOpId: staleDragPreview.causedByGeometryOpId,
                copy: staleDragPreview.copy
              }
            : null,
          planPreview: planReadyDragSnapshot.plan,
          placementUnchangedBeforeDrop: afterReadyDragEarphones.currentPlacement.id === beforeReadyDragEarphones.currentPlacement.id &&
            afterSnappedDragCharger.currentPlacement.id === beforeCollisionCharger.currentPlacement.id &&
            afterBlockedDragCandidate.currentPlacement.id === beforeBlockedDragCandidate.currentPlacement.id &&
            afterStaleDragEarphones.currentPlacement.id === beforeStaleDragEarphones.currentPlacement.id,
          gateMatchesBlockingCheckIds: JSON.stringify([...blockedDragBackend.commitPreview.dragPlacementGate.blockingCheckIds].sort()) ===
            JSON.stringify([...blockedDragBackend.mutationBundle.draftOps.dragPlacementPreviews[0].blockedByCheckIds].sort()),
          visualStates: {
            ready: readyDragSnapshot.visual,
            snapped: snappedDragSnapshot.visual,
            blocked: blockedDragSnapshot.visual,
            stale: staleDragSnapshot.visual
          }
        },
        supportManualPatch: {
          clearPreview: manualChargerPreview
            ? {
                previewOpId: manualChargerPreview.previewOpId,
                status: manualChargerPreview.status,
                reasonCode: manualChargerPreview.reasonCode,
                local: manualChargerPreview.supportPose?.local,
                supportPose: manualChargerPreview.supportPose,
                copy: manualChargerPreview.copy
              }
            : null,
          blockedPreview: manualBlockedChargerPreview
            ? {
                previewOpId: manualBlockedChargerPreview.previewOpId,
                status: manualBlockedChargerPreview.status,
                reasonCode: manualBlockedChargerPreview.reasonCode,
                local: manualBlockedChargerPreview.supportPose?.local,
                blockerIds: manualBlockedChargerPreview.collision?.blockers?.map((blocker) => blocker.itemId) ?? [],
                copy: manualBlockedChargerPreview.copy
              }
            : null,
          planPreview: planManualChargerSnapshot.plan,
          planLayers: {
            hasPatch: Boolean(planManualChargerSnapshot.plan?.patch?.visible),
            hasVolume: Boolean(planManualChargerSnapshot.plan?.volume?.visible),
            hasHandle: Boolean(planManualChargerSnapshot.plan?.handle?.visible),
            patchMatches3d: Math.abs((planManualChargerSnapshot.plan?.patch?.width ?? 0) - (planManualChargerSnapshot.visual?.patch?.width ?? 0)) <= 0.01 &&
              Math.abs((planManualChargerSnapshot.plan?.patch?.depth ?? 0) - (planManualChargerSnapshot.visual?.patch?.depth ?? 0)) <= 0.01,
            volumeMatches3d: Math.abs((planManualChargerSnapshot.plan?.volume?.width ?? 0) - (planManualChargerSnapshot.visual?.volume?.width ?? 0)) <= 0.01 &&
              Math.abs((planManualChargerSnapshot.plan?.volume?.depth ?? 0) - (planManualChargerSnapshot.visual?.volume?.depth ?? 0)) <= 0.01
          },
          handleDrag: {
            beforeLocal: {
              x: planManualChargerSnapshot.plan?.localX ?? null,
              z: planManualChargerSnapshot.plan?.localZ ?? null
            },
            afterLocal: {
              x: planPatchHandleDragSnapshot.plan?.localX ?? null,
              z: planPatchHandleDragSnapshot.plan?.localZ ?? null
            },
            phase: planPatchHandleDragSnapshot.plan?.phase ?? null,
            mode: planPatchHandleDragSnapshot.plan?.mode ?? null,
            placementUnchanged: afterPatchHandleCharger.currentPlacement.id === beforePatchHandleCharger.currentPlacement.id,
            precheckCountUnchanged: afterPatchHandlePrecheckCount === beforePatchHandlePrecheckCount,
            backendPreview: planPatchHandleDragBackend.writeModelPreview.supportSurfaceRecords
              .find((record) => record.id === "surface-desk-top")
              ?.activeDragPreview ?? null
          },
          volumeResize: {
            duringPhase: planVolumeResizeDuringSnapshot.plan?.phase ?? null,
            retainedPhase: planVolumeResizeSnapshot.plan?.phase ?? null,
            axis: planVolumeResizeDuringSnapshot.plan?.volumeHandle?.axis ?? null,
            beforeFootprint: beforeVolumeResizeCharger.footprint,
            candidate: {
              width: planVolumeResizeSnapshot.plan?.volume?.width ?? null,
              depth: planVolumeResizeSnapshot.plan?.volume?.depth ?? null
            },
            visual: planVolumeResizeSnapshot.visual?.volume ?? null,
            placementUnchanged: afterVolumeResizeCharger.currentPlacement.id === beforeVolumeResizeCharger.currentPlacement.id,
            precheckCountUnchanged: afterVolumeResizePrecheckCount === beforeVolumeResizePrecheckCount,
            itemFootprintUnchanged: Math.abs(afterVolumeResizeCharger.footprint.width - beforeVolumeResizeCharger.footprint.width) <= 0.001 &&
              Math.abs(afterVolumeResizeCharger.footprint.depth - beforeVolumeResizeCharger.footprint.depth) <= 0.001,
            backendPreview: planVolumeResizeBackend.writeModelPreview.supportSurfaceRecords
              .find((record) => record.id === "surface-desk-top")
              ?.activeDragPreview ?? null
          },
          resizedCommit: {
            itemId: resizeCommitItem.id,
            status: resizeCommitPlacement?.status ?? null,
            commitId: resizeCommitPlacement?.commit?.id ?? null,
            geometryOpId: resizeCommitGeometryOp?.id ?? null,
            beforeFootprint: beforeResizeCommitItem.footprint,
            afterFootprint: afterResizeCommitItem.footprint,
            renderedFootprint: resizeCommitRenderedItem?.footprintShadow ?? null,
            previewPhase: resizeCommitPreviewSnapshot.plan?.phase ?? null,
            uiDraft: resizeCommitUiDraft,
            commitOps: resizeCommitLedgerEntry?.ops ?? [],
            geometryRecord: resizeCommitGeometryRecord ?? null,
            commitPreviewGeometryRecord: resizeCommitPreviewGeometryRecord ?? null,
            placementRecord: resizeCommitPlacementRecord ?? null,
            finalActiveDragPreviewCleared: resizeCommitFinalBackend.writeModelPreview.supportSurfaceRecords
              .find((record) => record.id === "surface-desk-top")
              ?.activeDragPreview === null
          },
          placementUnchangedBeforeDrop: afterManualChargerPreview.currentPlacement.id === beforeCollisionCharger.currentPlacement.id,
          backendPreviewOp: manualChargerBackend.mutationBundle.draftOps.dragPlacementPreviews[0] ?? null,
          blockedGate: manualBlockedChargerBackend.commitPreview.dragPlacementGate,
          committed: {
            itemId: manualCommitItem.id,
            precheckId: manualCommitPlacement.precheck?.id ?? null,
            commitId: manualCommitPlacement.commit?.id ?? null,
            status: manualCommitPlacement.status,
            local: manualCommitPlacement.precheck?.supportPose?.local ?? null,
            supportPose: manualCommitPlacement.precheck?.supportPose ?? null,
            persistedPrecheckId: manualCommitBackend.writeModelPreview.supportSurfaceRecords
              .find((record) => record.id === "surface-desk-top")
              ?.activeDragPreview
              ?.persistedPrecheckId ?? null,
            finalActiveDragPreviewCleared: manualCommitFinalBackend.writeModelPreview.supportSurfaceRecords
              .find((record) => record.id === "surface-desk-top")
              ?.activeDragPreview === null,
            laterPrecheckReadback: {
              placementRecord: supportBackend.writeModelPreview.placementRecords.find((record) => record.subjectRef === `item:${manualCommitItem.id}`) ?? null,
              occupancy: supportBackend.writeModelPreview.supportSurfaceRecords
                .find((record) => record.id === "surface-desk-top")
                ?.occupancy
                ?.find((entry) => entry.itemId === manualCommitItem.id) ?? null
            },
            afterGeometryInvalidation: {
              placementRecord: backendContractAfterLayout.writeModelPreview.placementRecords.find((record) => record.subjectRef === `item:${manualCommitItem.id}`) ?? null,
              occupancy: backendContractAfterLayout.writeModelPreview.supportSurfaceRecords
                .find((record) => record.id === "surface-desk-top")
                ?.occupancy
                ?.find((entry) => entry.itemId === manualCommitItem.id) ?? null
            },
            placementRecord: manualCommitBackend.writeModelPreview.placementRecords.find((record) => record.subjectRef === `item:${manualCommitItem.id}`) ?? null,
            supportSurfaceRecord: manualCommitBackend.writeModelPreview.supportSurfaceRecords.find((record) => record.id === "surface-desk-top") ?? null
          }
        },
        supportHover: {
          target: hoverSnapshot.surfaceHover,
          hoveredSurface: hoverSnapshot.hoveredSurface,
          dom: hoverDom,
          cleared: clearedHover.surfaceHover,
          clearedDom: clearedHoverDom,
          beforePlacement: beforeHoverEarphones.currentPlacement,
          afterPlacement: afterHoverEarphones.currentPlacement,
          precheckCountBeforeHover,
          precheckCountAfterHover
        },
        supportSurfacePlacement: supportPlacement?.placement ?? null,
        supportSurfacePrechecks: afterLayout.placementPrechecks,
        supportReadyPrecheckDom,
        supportBlockedPrecheckDom: supportPrecheckDom,
        staleSupportPrecheckDom,
        supportSurfaceRecordStats: {
          hasSemanticFootprint: supportBackend.writeModelPreview.supportSurfaceRecords.some((record) => record.usableFootprint && record.clearanceHeight > record.renderThickness),
          deskRightSideOwnerRef: supportBackend.writeModelPreview.supportSurfaceRecords.find((record) => record.id === "surface-desk-right-side-base")?.ownerRef ?? null,
          hasOccupiedPatch: supportBackend.writeModelPreview.supportSurfaceRecords.some((record) => record.occupancy.some((entry) => entry.occupiedPatch?.width > 0))
        },
        visibleAffectedPlacements,
        identityProducer: {
          summary: scanPipelineSnapshot.identityProducer,
          dom: identityProducerDom,
          reconstruction: {
            snapshot: scanPipelineSnapshot.reconstructionJob,
            keyframeCoverage: scanPipelineSnapshot.keyframeCoverage,
            dom: reconstructionDom
          },
          anchorEdit: anchorEditFlow,
          anchorResolution: anchorResolutionFlow,
          observations: scanIdentityObservations,
          mutationRecords: scanIdentityMutationRecords,
          proposalContract: {
            records: scanIdentityProposalRecords,
            domRows: identityProposalDom,
            commitOps: backendContract.commitPreview.identityCommitOps,
            reviewFlow: identityReviewFlow
          },
          productPrior: {
            productItemId: productItem?.id ?? null,
            observation: deskLampIdentityObservation ?? null,
            layoutObservation: productLayoutDeskLampObservation ?? null
          },
          manipulationAffordance: manipulationAffordanceFlow,
          answerEvidenceFlow: productIdentityAnswerFlow
        },
        layoutScenarioCompare: layoutScenarioCompareFlow,
        layoutScenarioDecision: layoutScenarioDecisionFlow,
        layoutScenarioFocus: layoutScenarioFocusFlow,
        layoutScenarioReplay: layoutScenarioReplayFlow,
        endToEndDemo: endToEndDemoFlow,
        scanPointCount: mixedScanDraft.scanPointCount,
        planProposalOverlayCount: scanPlanOverlayCount,
        planDom: scanPlanDom,
        proposalsCommitted: scanDraftAfterCommit.proposals.filter((proposal) => proposal.status === "committed").length,
        createdBedsideBlock: Boolean(scanDraftAfterCommit.furniture.find((item) => item.id === "bedside-block")),
        selectedFurniture: afterLayout.selectedFurnitureId,
        resizedDesk:
          Math.abs(afterLayout.furniture.find((item) => item.id === "desk").width - beforeLayout.width) > 0.1,
        collisionDetected: afterLayout.furniture.find((item) => item.id === "desk").collisions.length > 0,
        health: afterLayout.metrics.health,
        coordinateFrame: coordinateSnapshot.frame.id,
        coordinateAnchorCount: coordinateSnapshot.anchors.length,
        containerFrameCount: coordinateSnapshot.containerFrames.length,
        coordinateRoundTripError: coordinateRoundTrip.error,
        coordinateHealth: afterLayout.metrics.coordinateHealth,
        interactionZoneCount: afterLayout.interactionZones.length,
        mainRouteCount: coordinateSnapshot.mainRoutes.length,
        keepOutZoneCount: afterLayout.keepOutZones.length,
        mainPathClearance: afterLayout.metrics.mainPathClearance,
        usableStorageVolume: afterLayout.metrics.usableStorageVolume,
        scanCoverage: afterLayout.scanSession.coverage,
        affectedPlacementCount: afterLayout.affectedPlacements.length
      },
      rotatedWaterBottle: Math.abs(afterRotate.rotation - beforeRotate.rotation) > 0.1,
      planDragMovedWaterBottle:
        Math.abs(afterPlanDrag.x - beforePlanDrag.x) > 0.1 ||
        Math.abs(afterPlanDrag.z - beforePlanDrag.z) > 0.1,
      productIntake: {
        created: Boolean(productItem),
        widthMeters: productItem?.footprint?.width,
        defaultPlace: productItem?.productInfo?.defaultPlace,
        movedDefaultPreserved: productAfterMove?.productInfo?.defaultPlace === productItem?.productInfo?.defaultPlace,
        hasTags: productItem?.kits?.includes("daily")
      }
    }
  };
  await writeFile(new URL("./renders/verification-report.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (assertionFailures.length) {
    throw new Error(`Verification assertions failed: ${assertionFailures.map((item) => item.name).join(", ")}`);
  }
  await cdp.close();
} finally {
  if (!closed) {
    chrome.kill("SIGTERM");
    await waitForChromeClose();
  }
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
}

async function waitForWebSocketUrl() {
  const deadline = Date.now() + 12000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const data = await response.json();
        const page = data.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError ?? new Error("Chrome debugging endpoint did not appear");
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method) {
      if (["Runtime.exceptionThrown", "Runtime.consoleAPICalled", "Log.entryAdded"].includes(message.method)) {
        browserEvents.push({ method: message.method, params: message.params });
        if (browserEvents.length > 40) browserEvents.shift();
      }
      return;
    }
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
        },
        close() {
          ws.close();
        }
      });
    });
    ws.addEventListener("error", reject);
  });
}

async function waitForLoad(cdp) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evalPage(cdp, `document.readyState`);
    if (ready === "complete") return;
    await sleep(150);
  }
  throw new Error("Page did not finish loading");
}

async function waitForDemo(cdp) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = await evalPage(cdp, `Boolean(window.roomRecallDemo?.snapshot)`);
    if (ready) return;
    await sleep(200);
  }
  throw new Error(`RoomRecall demo did not initialize: ${JSON.stringify(browserEvents.slice(-8), null, 2)}`);
}

async function evalPage(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails.exception;
    const description = exception?.description || exception?.value || result.exceptionDetails.text || "Evaluation failed";
    throw new Error(description);
  }
  return result.result.value;
}

async function pageAudit(cdp, label) {
  const text = await evalPage(cdp, `(() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const canvas = document.querySelector("canvas");
        const tmp = document.createElement("canvas");
        tmp.width = 120;
        tmp.height = 80;
        const ctx = tmp.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
        const pixels = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
        let nonWhite = 0;
        let unique = new Set();
        let hash = 2166136261;
        for (let i = 0; i < pixels.length; i += 16) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];
          if (a > 0 && (r < 238 || g < 238 || b < 238)) nonWhite += 1;
          unique.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
          hash ^= r + (g << 8) + (b << 16);
          hash = Math.imul(hash, 16777619);
        }
        const snapshot = window.roomRecallDemo?.snapshot?.() ?? null;
        const rect = canvas.getBoundingClientRect();
        const labels = [...document.querySelectorAll(".item-label")].filter((label) => {
          const r = label.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left < innerWidth && r.right > 0 && r.top < innerHeight && r.bottom > 0;
        }).length;
        resolve(JSON.stringify({
          label: ${JSON.stringify(label)},
          canvas: { width: rect.width, height: rect.height },
          viewport: { width: innerWidth, height: innerHeight },
          nonWhiteSamples: nonWhite,
          uniqueColorBuckets: unique.size,
          pixelHash: String(hash >>> 0),
          labels,
          snapshot,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2
        }));
      });
    });
  }))`);
  return typeof text === "string" ? JSON.parse(text) : text;
}

async function auditedPage(cdp, label) {
  const audit = await pageAudit(cdp, label);
  audit.snapshot = await evalPage(cdp, `window.roomRecallDemo.snapshot()`);
  return audit;
}

async function saveScreenshot(cdp, filename) {
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true
  });
  await writeFile(new URL(`./renders/${filename}`, import.meta.url), Buffer.from(result.data, "base64"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChromeClose() {
  if (closed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1600);
    chrome.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function analyzeScreenshots() {
  const files = [
    "room-recall-desktop.png",
    "room-recall-orbit-check.png",
    "room-recall-search-water-bottle.png",
    "room-recall-moved-water-bottle.png",
    "room-recall-fitness-kit.png",
    "room-recall-plan-2d.png",
    "room-recall-scan-3d.png",
    "room-recall-layout-planner.png",
    "room-recall-plan-dragged.png",
    "room-recall-rotated-water-bottle.png",
    "room-recall-mobile.png"
  ];
  const result = {};
  for (const file of files) {
    const png = await decodePng(new URL(`./renders/${file}`, import.meta.url));
    const canvasRegion = file === "room-recall-mobile.png"
      ? { x: 0, y: 0, width: png.width, height: Math.round(png.height * 0.58) }
      : { x: 0, y: 0, width: Math.max(1, png.width - 360), height: png.height };
    result[file] = {
      full: samplePixels(png, { x: 0, y: 0, width: png.width, height: png.height }),
      canvas: samplePixels(png, canvasRegion)
    };
  }
  return result;
}

async function decodePng(url) {
  const buffer = await readFile(url);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error(`Not a PNG: ${url.pathname}`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    unfilter(row, previous, bytesPerPixel, filter);
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      pixels[dst] = row[src];
      pixels[dst + 1] = row[src + 1];
      pixels[dst + 2] = row[src + 2];
      pixels[dst + 3] = channels === 4 ? row[src + 3] : 255;
    }
    previous = row;
  }
  return { width, height, pixels };
}

function unfilter(row, previous, bytesPerPixel, filter) {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
    if (filter === 1) row[i] = (row[i] + left) & 255;
    else if (filter === 2) row[i] = (row[i] + up) & 255;
    else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) row[i] = (row[i] + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
  }
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function samplePixels(png, region) {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(png.width, Math.floor(region.x + region.width));
  const y1 = Math.min(png.height, Math.floor(region.y + region.height));
  const stepX = Math.max(1, Math.floor((x1 - x0) / 96));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 72));
  let samples = 0;
  let nonBlank = 0;
  let hash = 2166136261;
  const buckets = new Set();
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const offset = (y * png.width + x) * 4;
      const r = png.pixels[offset];
      const g = png.pixels[offset + 1];
      const b = png.pixels[offset + 2];
      const a = png.pixels[offset + 3];
      samples += 1;
      if (a > 0 && (r < 238 || g < 238 || b < 238)) nonBlank += 1;
      buckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      hash ^= r + (g << 8) + (b << 16) + (a << 24);
      hash = Math.imul(hash, 16777619);
    }
  }
  return {
    width: x1 - x0,
    height: y1 - y0,
    samples,
    nonBlank,
    nonBlankRatio: Number((nonBlank / Math.max(1, samples)).toFixed(4)),
    uniqueColorBuckets: buckets.size,
    pixelHash: String(hash >>> 0)
  };
}
