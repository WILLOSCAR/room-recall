import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";

const reportUrl = new URL("./renders/verification-report.json", import.meta.url);
const stateUrl = new URL("./renders/self-loop-state.json", import.meta.url);
const markdownUrl = new URL("./renders/self-loop-report.md", import.meta.url);

const sources = [
  ["product-requirements.md", new URL("../docs/product-requirements.md", import.meta.url)],
  ["requirements-discovery.md", new URL("../docs/requirements-discovery.md", import.meta.url)],
  ["self-loop-operating-system.md", new URL("../docs/self-loop-operating-system.md", import.meta.url)],
  ["index.html", new URL("./index.html", import.meta.url)],
  ["verify.mjs", new URL("./verify.mjs", import.meta.url)],
  ["self-loop.mjs", new URL("./self-loop.mjs", import.meta.url)]
];

if (!existsSync(reportUrl)) {
  throw new Error("Missing renders/verification-report.json. Run `node prototype/verify.mjs` before `node prototype/self-loop.mjs`.");
}

const reportText = await readFile(reportUrl, "utf8");
const report = JSON.parse(reportText);
const previousState = existsSync(stateUrl)
  ? JSON.parse(await readFile(stateUrl, "utf8"))
  : null;
const sourceEntries = await Promise.all(
  sources.map(async ([name, url]) => [name, await readFile(url, "utf8")])
);
const sourceHashes = Object.fromEntries(
  sourceEntries.map(([name, text]) => [name, hash(text)])
);
sourceHashes["verification-report.json"] = hash(reportText);

const reportStat = await stat(reportUrl);
const assertions = report.assertions ?? [];
const assertionFailures = assertions.filter((assertion) => !assertion.pass);
const assertionByName = new Map(assertions.map((assertion) => [assertion.name, assertion]));
const layout = report.interaction?.layoutPlanner ?? {};
const product = report.interaction?.productIntake ?? {};
const movedWaterBottle = report.interaction?.movedWaterBottle ?? {};
const panelSections = layout.panelSections ?? [];
const previousProbeMap = new Map((previousState?.probes ?? []).map((probe) => [probe.id, probe.pass]));

const correctionBehaviorPass =
  movedWaterBottle.notThereDraft?.status === "needs_corrected_place" &&
  movedWaterBottle.contradictedPlacement?.status === "contradicted" &&
  movedWaterBottle.correctionDraft?.status === "corrected" &&
  movedWaterBottle.after?.currentPlacement?.source === "corrected placement" &&
  passedAssertion("backend contract exposes corrected placement op");

const renderedFurnitureIds = new Set(layout.renderedFurnitureIds ?? []);
const affectedRecords = assertionDetails("furniture edits create child placement review records") ?? [];
const scanProposalLabels = assertionDetails("2D scan proposal overlays use semantic labels") ?? [];
const envelopeLabels = assertionDetails("2D plan labels interaction envelopes semantically") ?? [];

const probes = [
  {
    id: "killer-loop-correction-behavior",
    lane: "semantic",
    question: "Does the prototype prove locate -> Not there -> corrected placement with behavior evidence?",
    pass: correctionBehaviorPass,
    evidence: correctionBehaviorPass
      ? `negative=${movedWaterBottle.notThereDraft?.negativeEvidenceId}, corrected source=${movedWaterBottle.after?.currentPlacement?.source}`
      : "Behavior evidence is incomplete in the verification report.",
    next: "Keep this as a regression guard while strengthening the commit ledger."
  },
  {
    id: "killer-loop-ledgered-answer",
    lane: "verification",
    question: "Does the correction become an append-only commit and improve the next locate answer?",
    pass: Boolean(movedWaterBottle.futureAnswerImproved && movedWaterBottle.commitLedgerEntryId),
    evidence: movedWaterBottle.futureAnswerImproved
      ? `commit=${movedWaterBottle.commitLedgerEntryId}`
      : "Current report proves corrected placement preview, but not commit ledger or future answer improvement.",
    next: "Add a commitPlacementCorrection path with a CommitLedgerEntry and assert locate('water bottle') returns the corrected source afterward."
  },
  {
    id: "mutation-bundle-shape",
    lane: "verification",
    question: "Is the backend preview shaped as observation/evidence/draftOps/commit/resultingRecords?",
    pass: Boolean(layout.mutationBundleShape?.hasObservationRecords && layout.mutationBundleShape?.hasDraftOps && layout.mutationBundleShape?.hasResultingRecords),
    evidence: layout.mutationBundleShape
      ? JSON.stringify(layout.mutationBundleShape)
      : "writeModelPreview is record-shaped, but not yet a mutation bundle with causal op ids.",
    next: "Introduce a mutationBundle preview: observationRecords, evidenceRecords, draftOps, commitPreview, resultingRecords."
  },
  {
    id: "placement-invalidation",
    lane: "spatial",
    question: "Do parent furniture edits emit stale child placement review records?",
    pass: Number(layout.affectedPlacementCount ?? 0) > 0 &&
      passedAssertion("backend contract exposes stale placement ops after furniture edits"),
    evidence: `${layout.affectedPlacementCount ?? 0} affected placements; stale ops assertion=${passedAssertion("backend contract exposes stale placement ops after furniture edits")}.`,
    next: "Promote stale placements from current-state mutation into explicit placementReviewOps with causedByGeometryOpId."
  },
  {
    id: "affected-placement-visibility",
    lane: "interface",
    question: "Can the right panel name the affected items and parent containers before commit?",
    pass: Array.isArray(layout.visibleAffectedPlacements) &&
      layout.visibleAffectedPlacements.length === Number(layout.affectedPlacementCount ?? 0) &&
      layout.visibleAffectedPlacements.every((item) => item.itemLabel && item.parentLabel),
    evidence: Array.isArray(layout.visibleAffectedPlacements)
      ? `${layout.visibleAffectedPlacements.length} named affected placements visible.`
      : `${affectedRecords.length} affected records exist, but panel visibility is not verified.`,
    next: "Render affected item names and parent furniture/container in Layout Health, then assert DOM parity with stalePlacementOps."
  },
  {
    id: "backend-write-model-records",
    lane: "verification",
    question: "Does the backend preview expose first-class records and structured collision results?",
    pass: (layout.writeModelRecordCounts?.anchors ?? 0) > 0 &&
      (layout.writeModelRecordCounts?.geometry ?? 0) > 0 &&
      (layout.writeModelRecordCounts?.placements ?? 0) > 0 &&
      passedAssertion("backend contract exposes first-class anchor records") &&
      passedAssertion("backend contract exposes geometry records") &&
      passedAssertion("backend contract exposes placement records"),
    evidence: `anchors=${layout.writeModelRecordCounts?.anchors ?? 0}, geometry=${layout.writeModelRecordCounts?.geometry ?? 0}, placements=${layout.writeModelRecordCounts?.placements ?? 0}.`,
    next: "Add ids and causal fields to collisionResults so layout health can be committed as records."
  },
  {
    id: "3d-state-driven-furniture",
    lane: "interface",
    question: "Does 3D render editable furniture and scan-created blocks from the same layout state?",
    pass: passedAssertion("3D furniture count matches editable layout state") &&
      passedAssertion("3D furniture mesh follows editable desk state") &&
      passedAssertion("3D furniture adds committed scan-created blocks") &&
      passedAssertion("3D support surface can be selected as a placement target") &&
      passedAssertion("item can be confirmed on selected support surface after passing precheck") &&
      passedAssertion("backend contract exposes support surface records"),
    evidence: `${layout.renderedFurnitureCount ?? 0} furniture groups; ${layout.supportSurfaceCount ?? 0} support surfaces; ids=${[...renderedFurnitureIds].join(", ")}.`,
    next: "Add hover affordance and surface-ownership tests for targetable 3D support surfaces."
  },
  {
    id: "support-surface-precheck-gate",
    lane: "spatial",
    question: "Does support-surface placement run fit/collision/stale gates before confirmation?",
    pass: passedAssertion("support surface precheck can pass before confirmation") &&
      passedAssertion("allowed support precheck does not mutate placement") &&
      passedAssertion("mutation bundle exposes ready support placement op before confirmation") &&
      passedAssertion("item can be confirmed on selected support surface after passing precheck") &&
      passedAssertion("support collision gate only blocks when no free support patch exists") &&
      passedAssertion("oversized item fails support surface fit precheck") &&
      passedAssertion("right panel renders blocked support surface precheck") &&
      passedAssertion("collision results expose structured support collision checks") &&
      passedAssertion("collision results expose structured support fit checks") &&
      passedAssertion("commit preview blocks invalid support placements") &&
      passedAssertion("parent furniture edits invalidate support surface prechecks"),
    evidence: layout.supportPrecheckStats
      ? JSON.stringify(layout.supportPrecheckStats)
      : "No support precheck stats were recorded in verification report.",
    next: "Use direct drag preview evidence to add editable patch handles and object-volume resize controls."
  },
  {
    id: "support-drag-preview-gate",
    lane: "spatial",
    question: "Does direct drag preview expose fit/collision/snapped/stale support checks before drop without mutating placement?",
    pass: passedAssertion("drag preview exposes ready support precheck before drop") &&
      passedAssertion("drag preview does not mutate placement before drop") &&
      passedAssertion("2D plan renders drag drop preview before drop") &&
      passedAssertion("drag preview exposes snapped support pose before drop") &&
      passedAssertion("drag preview exposes blocked support collision before drop") &&
      passedAssertion("blocked drag preview preserves placement before drop") &&
      passedAssertion("drag preview exposes stale support precheck before drop") &&
      passedAssertion("stale drag preview preserves placement before drop") &&
      passedAssertion("backend contract exposes drag preview support placement op before drop") &&
      passedAssertion("commit preview gate reuses drag preview blocking check ids") &&
      passedAssertion("rendered backend preview preserves drag preview support copy before drop") &&
      passedAssertion("drag preview support checks carry preview causal ids"),
    evidence: layout.supportDragPreview
      ? JSON.stringify({
          ready: layout.supportDragPreview.readyPreview?.status,
          snapped: layout.supportDragPreview.snappedPreview?.status,
          blocked: layout.supportDragPreview.blockedPreview?.reasonCode,
          stale: layout.supportDragPreview.stalePreview?.status,
          placementUnchanged: layout.supportDragPreview.placementUnchangedBeforeDrop,
          gateMatches: layout.supportDragPreview.gateMatchesBlockingCheckIds,
          planPreview: layout.supportDragPreview.planPreview?.status
        })
      : "No support drag preview evidence recorded.",
    next: "Turn preview patches into editable 2D/3D handles with user-controlled local placement instead of auto-nearest packing."
  },
  {
    id: "support-manual-patch-preview",
    lane: "spatial",
    question: "Can the user choose a support-local patch coordinate and get clear or blocked feedback before drop?",
    pass: passedAssertion("manual patch drag preview uses user chosen support-local coordinate") &&
      passedAssertion("manual patch drag preview does not persist before drop") &&
      passedAssertion("manual patch drag preview blocks an occupied user chosen patch") &&
      passedAssertion("backend contract exposes manual patch drag preview before drop") &&
      passedAssertion("backend drag preview gate blocks occupied manual patch") &&
      passedAssertion("2D plan renders manual patch drag preview"),
    evidence: layout.supportManualPatch
      ? JSON.stringify({
          clear: layout.supportManualPatch.clearPreview?.status,
          local: layout.supportManualPatch.clearPreview?.local,
          blocked: layout.supportManualPatch.blockedPreview?.reasonCode,
          blockers: layout.supportManualPatch.blockedPreview?.blockerIds,
          plan: layout.supportManualPatch.planPreview?.status,
          placementUnchanged: layout.supportManualPatch.placementUnchangedBeforeDrop
        })
      : "No manual patch evidence recorded.",
    next: "Expose manual patch movement as visible 2D/3D handles instead of script-only local coordinates."
  },
  {
    id: "support-manual-patch-commit",
    lane: "verification",
    question: "Does a committed manual support-local patch preserve the same coordinate across backend precheck, placement, occupancy, and latest-surface readback?",
    pass: passedAssertion("manual patch commit creates a confirmed support precheck") &&
      passedAssertion("manual patch commit preserves user chosen support-local coordinate in support placement op") &&
      passedAssertion("manual patch commit preserves user chosen support-local coordinate in placement record") &&
      passedAssertion("backend support surface records preserve committed manual occupied patch") &&
      passedAssertion("rendered backend preview preserves committed manual precheck copy") &&
      passedAssertion("manual drag preview links to persisted precheck after commit") &&
      passedAssertion("backend support surface latest precheck preserves committed manual patch") &&
      passedAssertion("manual patch commit appends support placement commit ledger entry") &&
      passedAssertion("manual patch placement record carries support placement commit id") &&
      passedAssertion("manual patch final readback clears active drag preview after commit") &&
      passedAssertion("manual patch commit survives later surface precheck via placement record and occupancy readback") &&
      passedAssertion("manual patch support-local pose survives parent geometry invalidation"),
    evidence: layout.supportManualPatch?.committed
      ? JSON.stringify({
          itemId: layout.supportManualPatch.committed.itemId,
          status: layout.supportManualPatch.committed.status,
          local: layout.supportManualPatch.committed.local,
          precheckId: layout.supportManualPatch.committed.precheckId,
          commitId: layout.supportManualPatch.committed.commitId,
          finalPreviewCleared: layout.supportManualPatch.committed.finalActiveDragPreviewCleared,
          survivesGeometryInvalidation: Boolean(layout.supportManualPatch.committed.afterGeometryInvalidation?.placementRecord?.supportPose)
        })
      : "No committed manual patch evidence recorded.",
    next: "Make the 2D plan patch handle pointer-draggable while reusing this commit-readback contract."
  },
  {
    id: "plan-patch-handle-layers",
    lane: "interface",
    question: "Does the 2D plan expose separate patch, volume, and handle layers that match the 3D drag preview geometry?",
    pass: passedAssertion("2D plan renders separate manual patch volume and handle layers") &&
      passedAssertion("2D plan preview geometry matches 3D patch and volume ghosts"),
    evidence: layout.supportManualPatch?.planLayers
      ? JSON.stringify(layout.supportManualPatch.planLayers)
      : "No 2D patch handle layer evidence recorded.",
    next: "Make the 2D handle pointer-draggable and add volume resize handles with min/max collision checks."
  },
  {
    id: "plan-patch-handle-drag",
    lane: "interface",
    question: "Can the 2D plan patch handle change the support-local preview without committing placement or precheck state?",
    pass: passedAssertion("2D patch handle drag changes manual support-local preview") &&
      passedAssertion("2D patch handle drag keeps placement and precheck state preview-only") &&
      passedAssertion("backend contract updates active drag preview from 2D patch handle drag"),
    evidence: layout.supportManualPatch?.handleDrag
      ? JSON.stringify({
          before: layout.supportManualPatch.handleDrag.beforeLocal,
          after: layout.supportManualPatch.handleDrag.afterLocal,
          phase: layout.supportManualPatch.handleDrag.phase,
          placementUnchanged: layout.supportManualPatch.handleDrag.placementUnchanged,
          precheckCountUnchanged: layout.supportManualPatch.handleDrag.precheckCountUnchanged
        })
      : "No 2D patch handle drag evidence recorded.",
    next: "Add preview-only volume resize handles that reuse the same fit/collision and commit-readback contracts."
  },
  {
    id: "plan-volume-resize-preview",
    lane: "interface",
    question: "Can the 2D plan volume handle resize candidate dimensions while keeping placement, precheck, and item footprint unchanged before commit?",
    pass: passedAssertion("2D volume resize handle changes candidate preview dimensions") &&
      passedAssertion("2D volume resize preview keeps placement precheck and item footprint unchanged") &&
      passedAssertion("backend contract exposes resized active drag preview before commit"),
    evidence: layout.supportManualPatch?.volumeResize
      ? JSON.stringify({
          candidate: layout.supportManualPatch.volumeResize.candidate,
          duringPhase: layout.supportManualPatch.volumeResize.duringPhase,
          retainedPhase: layout.supportManualPatch.volumeResize.retainedPhase,
          placementUnchanged: layout.supportManualPatch.volumeResize.placementUnchanged,
          itemFootprintUnchanged: layout.supportManualPatch.volumeResize.itemFootprintUnchanged
        })
      : "No volume resize preview evidence recorded.",
    next: "Add explicit confirmation for resized dimensions as separate geometry plus placement commit records."
  },
  {
    id: "plan-volume-resize-commit",
    lane: "verification",
    question: "Does a released resize draft require explicit confirmation and then append separate geometry plus placement commit records?",
    pass: passedAssertion("resized volume preview exposes explicit size draft confirm UI") &&
      passedAssertion("resized volume commit updates item footprint and 3D item mesh") &&
      passedAssertion("resized volume commit appends item geometry and support placement ops") &&
      passedAssertion("backend contract exposes committed resized geometry op and placement record footprint"),
    evidence: layout.supportManualPatch?.resizedCommit
      ? JSON.stringify({
          itemId: layout.supportManualPatch.resizedCommit.itemId,
          status: layout.supportManualPatch.resizedCommit.status,
          commitId: layout.supportManualPatch.resizedCommit.commitId,
          geometryOpId: layout.supportManualPatch.resizedCommit.geometryOpId,
          previewPhase: layout.supportManualPatch.resizedCommit.previewPhase,
          afterFootprint: layout.supportManualPatch.resizedCommit.afterFootprint,
          renderedFootprint: layout.supportManualPatch.resizedCommit.renderedFootprint,
          finalPreviewCleared: layout.supportManualPatch.resizedCommit.finalActiveDragPreviewCleared
        })
      : "No resized commit evidence recorded.",
    next: "Move the same explicit producer-review-commit boundary into scan identity observations and match/create/merge proposals."
  },
  {
    id: "support-check-causal-ids",
    lane: "verification",
    question: "Do support-surface checks round-trip concrete causal ids, support patches, and backend-visible copy snapshots?",
    pass: passedAssertion("support surface checks carry causal ids and ui snapshots") &&
      passedAssertion("support collision checks expose causal precheck and placement op ids") &&
      passedAssertion("blocked support placement ops reference concrete support check ids") &&
      passedAssertion("commit preview gate reuses blocked support check ids") &&
      passedAssertion("stale support placement ops preserve causal support check ids after parent edit") &&
      passedAssertion("rendered backend preview preserves ready precheck copy") &&
      passedAssertion("rendered backend preview preserves confirmed support placement copy") &&
      passedAssertion("rendered backend preview preserves confirmed-to-stale precheck copy") &&
      passedAssertion("rendered backend preview preserves blocked-to-stale precheck copy") &&
      passedAssertion("support surface placement stores support-local occupied patch"),
    evidence: layout.supportCheckCausality
      ? JSON.stringify({
          collision: layout.supportCheckCausality.supportCollisionCheckId,
          snappedCheck: layout.supportCheckCausality.snappedCollisionCheckId,
          snappedPatch: layout.supportCheckCausality.snappedCandidatePatch,
          centerBlockers: layout.supportCheckCausality.snappedCenterBlockerIds,
          saturatedCheck: layout.supportCheckCausality.saturatedCollisionCheckId,
          fit: layout.supportCheckCausality.fitCheckIds,
          staleOps: layout.supportCheckCausality.staleOpsWithGeometryCause,
          manualGeometryOps: layout.supportCheckCausality.manualGeometryOps,
          supportPoseRecorded: layout.supportCheckCausality.supportPoseRecorded,
          snappedSupportPoseRecorded: layout.supportCheckCausality.snappedSupportPoseRecorded
        })
      : "No support check causality evidence recorded.",
    next: "Make support-local patches editable with visible handles, labels, and object volume outlines."
  },
  {
    id: "support-pose-snapping",
    lane: "spatial",
    question: "Can one support surface hold multiple local occupied patches instead of acting as one centered slot?",
    pass: passedAssertion("support surface precheck snaps away from occupied center when free patch exists") &&
      passedAssertion("right panel explains snapped support precheck copy") &&
      passedAssertion("item can be confirmed on shared support surface after snapped precheck") &&
      passedAssertion("support placement op candidate pose matches snapped support world center") &&
      passedAssertion("backend support surface records preserve multiple occupied patches on one surface") &&
      passedAssertion("support collision gate only blocks when no free support patch exists") &&
      passedAssertion("3D renders support-local occupancy patches for shared surface"),
    evidence: layout.supportPoseSnapping
      ? JSON.stringify({
          snapped: layout.supportPoseSnapping.snappedChargerPrecheck?.snapped,
          centerBlockerIds: layout.supportPoseSnapping.snappedChargerPrecheck?.centerBlockerIds,
          sharedDeskPatchCount: layout.supportPoseSnapping.sharedDeskPatchCount,
          occupancyVisualCount: layout.supportPoseSnapping.occupancyVisualCount,
          saturatedReason: layout.supportPoseSnapping.saturatedCollisionPrecheck?.reasonCode
        })
      : "No support pose snapping evidence recorded.",
    next: "Promote support-local patch snapping into draggable 2D/3D handles and translucent object volume outlines."
  },
  {
    id: "support-surface-hover-affordance",
    lane: "interface",
    question: "Can 3D hover reveal a targetable support surface, owner, candidate, and readiness before selection?",
    pass: passedAssertion("3D support surface hover is targetable before selection") &&
      passedAssertion("support surface hover exposes ownership without mutating prechecks") &&
      passedAssertion("3D hover affordance renders target label owner and candidate before click") &&
      passedAssertion("hovered 3D support surface renders stronger affordance than idle surfaces") &&
      passedAssertion("support surface hover clears without leaving a selected target") &&
      passedAssertion("backend support surface records distinguish usable footprint clearance and owner"),
    evidence: layout.supportHover
      ? JSON.stringify({
          surfaceId: layout.supportHover.target?.hoveredSurfaceId,
          status: layout.supportHover.target?.preview?.status,
          owner: layout.supportHover.hoveredSurface?.ownerRef,
          domVisible: layout.supportHover.dom?.chip?.visible,
          mutatedPrechecks: layout.supportPrecheckStats?.hoverMutatedPrechecks
        })
      : "No support hover evidence recorded.",
    next: "Wire pointermove screenshots into a non-flaky smoke check while keeping the API hover probe as the main gate."
  },
  {
    id: "2d-semantic-overlays",
    lane: "interface",
    question: "Does the 2D plan label interaction envelopes and scan proposals semantically?",
    pass: passedAssertion("2D plan labels interaction envelopes semantically") &&
      passedAssertion("2D scan proposal overlays use semantic labels"),
    evidence: `envelopes=${envelopeLabels.join(", ")}; proposals=${scanProposalLabels.join(", ")}.`,
    next: "Collapse secondary labels until selected/hovered so dense plan zones stay readable."
  },
  {
    id: "right-panel-scope",
    lane: "interface",
    question: "Is the right panel split into stable product scopes from the actual DOM?",
    pass: sameSequencePrefix(panelSections, ["Selection", "Retrieval Plan", "Spatial Frame", "Layout Health", "Scan Diff", "Contract"]),
    evidence: `sections=${panelSections.join(" -> ")}.`,
    next: "Add ownership checks so each section proves it owns the right controls and data."
  },
  {
    id: "scan-proposal-loop",
    lane: "spatial",
    question: "Does scan review move through proposal selection, accept/reject, and commit?",
    pass: layout.proposalCount >= 3 &&
      layout.proposalsCommitted >= 1 &&
      passedAssertion("proposal selection is shared across review surfaces"),
    evidence: `${layout.proposalCount ?? 0} proposals, ${layout.proposalsCommitted ?? 0} committed.`,
    next: "Add a scan identity producer that emits item/container observations before match, create, or merge review."
  },
  {
    id: "scan-identity-producer",
    lane: "semantic",
    question: "Does the scan pipeline emit typed item/container identity observations before match/create/merge truth writes?",
    pass: passedAssertion("scan pipeline exposes identity producer summary") &&
      passedAssertion("backend observation inbox exposes item and container identity observations") &&
      passedAssertion("mutation bundle carries identity observation records for unknown and private scan regions") &&
      passedAssertion("scan identity observations remain pre-truth and do not bind canonical records") &&
      passedAssertion("container-level identity observations do not invent room-level coordinates") &&
      passedAssertion("scan panel surfaces identity producer count and types") &&
      passedAssertion("product-created item priors participate in scan identity matching"),
    evidence: layout.identityProducer
      ? JSON.stringify({
          summary: layout.identityProducer.summary,
          dom: layout.identityProducer.dom,
          observationTypes: layout.identityProducer.observations?.map((observation) => observation.type),
          productPriorIds: layout.identityProducer.productPrior?.observation?.priorItemIds
        })
      : "No scan identity producer evidence recorded.",
    next: "Promote these identity observations into match/create/merge proposals with required resolution fields."
  },
  {
    id: "scan-identity-proposal-contract",
    lane: "semantic",
    question: "Do identity observations derive read-only match/create/merge and coverage proposal contracts without adding commit actions?",
    pass: passedAssertion("identity observations derive match create merge and coverage proposal contracts") &&
      passedAssertion("identity proposal contracts stay read-only with no commit ops in V18") &&
      passedAssertion("scan diff renders identity proposal rows without accept reject or commit controls"),
    evidence: layout.identityProducer?.proposalContract
      ? JSON.stringify({
          count: layout.identityProducer.proposalContract.records?.length,
          types: layout.identityProducer.proposalContract.records?.map((proposal) => proposal.type),
          domRows: layout.identityProducer.proposalContract.domRows?.length,
          commitOps: layout.identityProducer.proposalContract.commitOps?.length
        })
      : "No scan identity proposal contract evidence recorded.",
    next: "Turn read-only identity proposal rows into a shared review surface with selected observation focus and match/create/merge decisions."
  },
  {
    id: "scan-identity-review-loop",
    lane: "interface",
    question: "Can identity proposal rows focus a selected observation and capture a local resolution decision without writing canonical commits?",
    pass: passedAssertion("identity proposal review focuses selected observation without creating a resolution draft") &&
      passedAssertion("identity proposal action creates local resolution draft without canonical commit"),
    evidence: layout.identityProducer?.proposalContract?.reviewFlow
      ? JSON.stringify({
          selected: layout.identityProducer.proposalContract.reviewFlow.afterAction?.selectedIdentityProposalId,
          action: layout.identityProducer.proposalContract.reviewFlow.afterAction?.proposalRecord?.resolutionDraft?.action,
          draftCount: layout.identityProducer.proposalContract.reviewFlow.afterAction?.resolutionDrafts?.length,
          identityCommitOps: layout.identityProducer.proposalContract.reviewFlow.afterAction?.identityCommitOps?.length,
          geometryStatusesStable: JSON.stringify(layout.identityProducer.proposalContract.reviewFlow.geometryStatusesBefore) ===
            JSON.stringify(layout.identityProducer.proposalContract.reviewFlow.geometryStatusesAfter)
        })
      : "No scan identity review flow evidence recorded.",
    next: "Promote reviewed identity resolution drafts into an atomic scan identity commit ledger with undo/source lineage."
  },
  {
    id: "scan-identity-commit-ledger",
    lane: "verification",
    question: "Can a reviewed identity resolution draft become an atomic commit ledger entry without geometry or placement writes?",
    pass: passedAssertion("identity resolution draft commits atomic identity ledger without geometry or placement writes"),
    evidence: layout.identityProducer?.proposalContract?.reviewFlow?.afterCommit
      ? JSON.stringify({
          commitId: layout.identityProducer.proposalContract.reviewFlow.afterCommit.commitLedgerEntries?.[0]?.id,
          opTypes: layout.identityProducer.proposalContract.reviewFlow.afterCommit.identityCommitOps?.map((op) => op.type),
          draftStatus: layout.identityProducer.proposalContract.reviewFlow.afterCommit.proposalRecord?.resolutionDraft?.status,
          geometryOps: layout.identityProducer.proposalContract.reviewFlow.afterCommit.geometryOps?.length,
          placementOps: layout.identityProducer.proposalContract.reviewFlow.afterCommit.placementOps?.length
        })
      : "No scan identity commit evidence recorded.",
    next: "Use the committed identity resolution as answer evidence, then add undo/lineage inspection for identity commits."
  },
  {
    id: "scan-identity-answer-lineage",
    lane: "semantic",
    question: "Does a committed identity resolution become locate answer evidence with inspectable append-only lineage?",
    pass: passedAssertion("committed identity resolution becomes locate answer evidence without rewriting placement") &&
      passedAssertion("identity locate answer exposes source lineage in scan row and detail panel") &&
      passedAssertion("identity rollback is append-only lineage and does not leak into geometry or placement writes"),
    evidence: layout.identityProducer?.answerEvidenceFlow
      ? JSON.stringify({
          answerItem: layout.identityProducer.answerEvidenceFlow.answer?.itemId,
          source: layout.identityProducer.answerEvidenceFlow.answer?.answerSource,
          commitId: layout.identityProducer.answerEvidenceFlow.commit?.id,
          rowStatus: layout.identityProducer.answerEvidenceFlow.dom?.row?.lineageStatus,
          rollbackType: layout.identityProducer.answerEvidenceFlow.afterRollbackBackend?.commitPreview?.commitLedgerEntries?.[0]?.type
        })
      : "No committed identity answer evidence flow recorded.",
    next: "Use answer lineage as the retrieval-agent explanation surface, including confidence and stale/reverted identity handling."
  },
  {
    id: "retrieval-agent-explanation-surface",
    lane: "semantic",
    question: "Does the retrieval read model explain answered, needs-review, and not-found outcomes without falling back to stale identity evidence?",
    pass: passedAssertion("committed identity resolution becomes locate answer evidence without rewriting placement") &&
      passedAssertion("reverted latest identity evidence suppresses older matches and asks for review") &&
      passedAssertion("not found retrieval returns stable answer preview and visible no-result state"),
    evidence: layout.identityProducer?.answerEvidenceFlow
      ? JSON.stringify({
          answered: layout.identityProducer.answerEvidenceFlow.answer?.status,
          needsReview: layout.identityProducer.answerEvidenceFlow.afterRollbackAnswer?.reviewRequired,
          blockedOlder: layout.identityProducer.answerEvidenceFlow.afterRollbackAnswer?.blockedOlderCommitIds?.length,
          notFound: layout.identityProducer.answerEvidenceFlow.notFoundAnswer?.status
        })
      : "No retrieval-agent explanation flow recorded.",
    next: "Carry retrieval explanation into 2D/3D overlays so answer confidence, holds, and suppressed evidence are visible in spatial context."
  },
  {
    id: "retrieval-spatial-overlay-surface",
    lane: "interface",
    question: "Do retrieval answer states project into 2D and 3D spatial overlays instead of living only in the side panel?",
    pass: passedAssertion("retrieval answered state projects into 2D plan and 3D item overlay") &&
      passedAssertion("retrieval needs-review state projects as 2D hold and 3D identity hold") &&
      passedAssertion("retrieval not-found state projects as plan empty state and 3D scene label"),
    evidence: layout.identityProducer?.answerEvidenceFlow
      ? JSON.stringify({
          answeredPlan: layout.identityProducer.answerEvidenceFlow.answeredPlan?.overlay?.status,
          answered3d: layout.identityProducer.answerEvidenceFlow.answered3d?.productItem?.overlayKind,
          needsReviewPlan: layout.identityProducer.answerEvidenceFlow.needsReviewPlan?.overlay?.status,
          notFound3d: layout.identityProducer.answerEvidenceFlow.notFound3d?.sceneLabel?.state
        })
      : "No retrieval spatial overlay flow recorded.",
    next: "Use the spatial retrieval overlay to reduce dense 2D labels and reveal answer evidence on hover/selection."
  },
  {
    id: "plan-density-answer-reveal",
    lane: "interface",
    question: "Does the 2D plan collapse secondary labels while preserving answer and hold evidence?",
    pass: passedAssertion("2D plan collapses secondary labels while revealing answered target") &&
      passedAssertion("2D plan reveals needs-review hold anchor without promoting it to answer target") &&
      passedAssertion("2D plan keeps all item labels collapsed for not-found retrieval") &&
      passedAssertion("2D plan hover and focus reveal secondary labels without changing answer overlay") &&
      passedAssertion("2D label reveal policy is read-only and does not write geometry placement or identity commits"),
    evidence: layout.identityProducer?.answerEvidenceFlow
      ? JSON.stringify({
          answeredDensity: layout.identityProducer.answerEvidenceFlow.answeredPlan?.board?.density,
          needsReviewDensity: layout.identityProducer.answerEvidenceFlow.needsReviewPlan?.board?.density,
          notFoundDensity: layout.identityProducer.answerEvidenceFlow.notFoundPlan?.board?.density
        })
      : "No plan density answer reveal flow recorded.",
    next: "Promote 3D object refinement: dimension-scaled archetypes and clearer object silhouettes."
  },
  {
    id: "3d-object-archetype-refinement",
    lane: "interface",
    question: "Do 3D item meshes resolve specialized archetypes and scale their real silhouette to item dimensions?",
    pass: passedAssertion("3D item meshes resolve dimension-scaled object archetypes") &&
      passedAssertion("3D object silhouettes scale to declared item footprint") &&
      passedAssertion("lamp and charger render specialized 3D silhouettes instead of generic cubes") &&
      passedAssertion("resized volume commit updates 3D silhouette bounds not only footprint shadow"),
    evidence: layout.identityProducer?.productPrior?.productItemId
      ? JSON.stringify({
          productItemId: layout.identityProducer.productPrior.productItemId,
          archetypes: [...new Set((layout.renderedItems ?? []).map((item) => item.meshArchetype?.resolved).filter(Boolean))]
        })
      : "No rendered object archetype evidence recorded.",
    next: "Add selected-object 3D volume outlines and container occupancy silhouettes for dense storage surfaces."
  },
  {
    id: "3d-volume-and-occupancy-silhouettes",
    lane: "interface",
    question: "Do selected/retrieval objects show 3D volume outlines and do dense support surfaces expose occupancy silhouettes?",
    pass: passedAssertion("3D selected answer renders item volume outline from footprint dimensions") &&
      passedAssertion("3D needs-review hold keeps volume outline visible without answer promotion") &&
      passedAssertion("3D not-found retrieval clears item volume outlines") &&
      passedAssertion("container occupancy silhouettes expose item archetype patch and world pose"),
    evidence: layout.identityProducer?.answerEvidenceFlow
      ? JSON.stringify({
          answerOutline: layout.identityProducer.answerEvidenceFlow.answered3d?.productRenderedItem?.volumeOutline?.state?.reason,
          holdOutline: layout.identityProducer.answerEvidenceFlow.needsReview3d?.productRenderedItem?.volumeOutline?.state?.reason,
          occupancySilhouettes: layout.containerOccupancySilhouettes?.length ?? 0
        })
      : "No 3D volume or occupancy silhouette evidence recorded.",
    next: "Add selected-object local axes, rotation handles, and container fit readouts for 3D manipulation."
  },
  {
    id: "3d-manipulation-affordance-readouts",
    lane: "interface",
    question: "Does a selected 3D object expose local axes, rotation affordance, volume outline, and container fit readout without writes?",
    pass: passedAssertion("selected 3D object exposes local axes rotation handle and volume outline") &&
      passedAssertion("selected object exposes container fit readout in 3D detail and backend preview") &&
      passedAssertion("3D manipulation affordance readouts do not create write-model ops"),
    evidence: layout.identityProducer?.manipulationAffordance
      ? JSON.stringify({
          itemId: layout.identityProducer.manipulationAffordance.selectedItem?.id,
          fit: layout.identityProducer.manipulationAffordance.selectedItem?.containerFitReadout?.status,
          axes: layout.identityProducer.manipulationAffordance.selectedItem?.manipulationHandles?.localAxes?.axes,
          rotationVisible: layout.identityProducer.manipulationAffordance.selectedItem?.manipulationHandles?.rotationHandle?.visible
        })
      : "No 3D manipulation affordance evidence recorded.",
    next: "Add layout-planning scenario compare: current vs proposed furniture placement and storage gain/loss."
  },
  {
    id: "layout-scenario-compare",
    lane: "spatial",
    question: "Can the layout planner compare current vs proposed furniture scenarios without mutating canonical layout or write ops?",
    pass: passedAssertion("layout scenario compare exposes current proposed metrics and storage delta") &&
      passedAssertion("layout scenario compare is preview-only and does not mutate furniture placement or write ops") &&
      passedAssertion("layout scenario compare round-trips through DOM layout snapshot and backend preview") &&
      passedAssertion("2D plan renders read-only layout scenario ghosts"),
    evidence: layout.layoutScenarioCompare
      ? JSON.stringify({
          scenarios: layout.layoutScenarioCompare.records?.length ?? 0,
          ghosts: layout.layoutScenarioCompare.scenarioDom?.ghosts?.length ?? 0,
          unchanged: layout.layoutScenarioCompare.readOnlyState?.furnitureUnchangedAfterDom,
          backendRecords: layout.layoutScenarioCompare.backendRecords?.length ?? 0
        })
      : "No layout scenario compare evidence recorded.",
    next: "Promote layout scenarios into explicit geometry-diff ids and predicted placement impact records."
  },
  {
    id: "layout-scenario-geometry-impact",
    lane: "verification",
    question: "Do layout scenarios expose stable geometry diff ids and predicted placement impacts before any commit?",
    pass: passedAssertion("layout scenarios preserve stable geometry diff ids with before after deltas") &&
      passedAssertion("layout scenarios expose predicted placement impacts without canonical stale writes"),
    evidence: layout.layoutScenarioCompare
      ? JSON.stringify({
          geometryDiffs: (layout.layoutScenarioCompare.records ?? []).reduce((sum, record) => sum + (record.geometryDiffs?.length ?? 0), 0),
          impacts: (layout.layoutScenarioCompare.records ?? []).reduce((sum, record) => sum + (record.predictedPlacementImpactCount ?? 0), 0),
          placementsUnchanged: layout.layoutScenarioCompare.readOnlyState?.placementsUnchangedAfterDom
        })
      : "No layout scenario geometry-impact evidence recorded.",
    next: "Carry scenario impact into support-surface impacts and recommendation reason codes."
  },
  {
    id: "layout-scenario-support-reasons",
    lane: "semantic",
    question: "Do layout scenarios explain support-surface impacts and recommendation tradeoffs with evidence refs?",
    pass: passedAssertion("layout scenarios expose predicted support surface impacts with geometry refs") &&
      passedAssertion("layout recommendation exposes reason codes evidence refs and tradeoffs"),
    evidence: layout.layoutScenarioCompare
      ? JSON.stringify({
          supportImpacts: (layout.layoutScenarioCompare.records ?? []).reduce((sum, record) => sum + (record.predictedSupportSurfaceImpactCount ?? 0), 0),
          reasonCodes: [...new Set((layout.layoutScenarioCompare.records ?? []).flatMap((record) => record.recommendationReasonCodes ?? []))].join(","),
          domReasons: layout.layoutScenarioCompare.scenarioDom?.rows?.every((row) => row.reasonCodes?.length > 0)
        })
      : "No layout scenario support-reason evidence recorded.",
    next: "Connect scenario recommendation reasons to scan quality, certainty, and guided capture prompts."
  },
  {
    id: "layout-scenario-scan-certainty",
    lane: "semantic",
    question: "Do scenario recommendations expose scan certainty checks and guided capture prompts before commit?",
    pass: passedAssertion("layout scenarios expose scan certainty checks and guided capture prompts") &&
      passedAssertion("layout recommendation reasons reference scan quality capture prompts"),
    evidence: layout.layoutScenarioCompare
      ? JSON.stringify({
          statuses: [...new Set((layout.layoutScenarioCompare.records ?? []).map((record) => record.certainty?.status).filter(Boolean))].join(","),
          prompts: (layout.layoutScenarioCompare.records ?? []).reduce((sum, record) => sum + (record.guidedCapturePrompts?.length ?? 0), 0),
          promptReasons: (layout.layoutScenarioCompare.records ?? []).filter((record) => (record.recommendationReasonCodes ?? []).includes("scan_quality_capture_needed")).length
        })
      : "No layout scenario scan-certainty evidence recorded.",
    next: "Turn scan certainty into editable anchors, keyframe coverage, and reconstruction job contracts."
  },
  {
    id: "scan-reconstruction-job-contract",
    lane: "semantic",
    question: "Does scanning expose keyframe coverage and a proposal-only reconstruction job contract?",
    pass: passedAssertion("scan pipeline exposes keyframe coverage requirements") &&
      passedAssertion("scan pipeline exposes proposal-only reconstruction job contract") &&
      passedAssertion("backend and layout snapshots expose reconstruction job and keyframe coverage") &&
      passedAssertion("scan panel renders reconstruction job and keyframe coverage contract"),
    evidence: layout.identityProducer?.reconstruction
      ? JSON.stringify({
          job: layout.identityProducer.reconstruction.snapshot?.id,
          route: layout.identityProducer.reconstruction.snapshot?.route,
          frames: layout.identityProducer.reconstruction.snapshot?.selectedFrameCount,
          coverage: `${layout.identityProducer.reconstruction.keyframeCoverage?.filter((record) => record.status === "covered").length}/${layout.identityProducer.reconstruction.keyframeCoverage?.length}`,
          outputPolicy: layout.identityProducer.reconstruction.snapshot?.outputPolicy
        })
      : "No reconstruction job evidence recorded.",
    next: "Make anchors editable and turn anchor changes into stale scan-derived geometry."
  },
  {
    id: "anchor-edit-stale-geometry",
    lane: "verification",
    question: "Can an anchor edit preview mark scan-derived geometry stale without mutating canonical anchors or furniture?",
    pass: passedAssertion("anchor edit preview creates a draft without canonical writes") &&
      passedAssertion("anchor edit marks scan-derived geometry stale in draft scope") &&
      passedAssertion("anchor edit draft round-trips through panel backend and layout snapshot") &&
      passedAssertion("anchor edit preview does not mutate anchors furniture or write ops"),
    evidence: layout.identityProducer?.anchorEdit
      ? JSON.stringify({
          draft: layout.identityProducer.anchorEdit.draft?.id,
          staleGeometry: layout.identityProducer.anchorEdit.draft?.staleGeometryRecords?.length ?? 0,
          anchorsUnchanged: layout.identityProducer.anchorEdit.readOnlyState?.anchorsUnchanged,
          dom: layout.identityProducer.anchorEdit.dom?.id
        })
      : "No anchor edit evidence recorded.",
    next: "Promote anchor edits into explicit commit/reject boundaries with reconstruction refresh proposals."
  },
  {
    id: "anchor-edit-resolution-boundary",
    lane: "verification",
    question: "Can anchor edits be committed or rejected with append-only lineage and reconstruction refresh proposals?",
    pass: passedAssertion("committing anchor edit appends anchor ledger entry and refresh proposal") &&
      passedAssertion("committed anchor edit history exposes reconstruction refresh proposal across surfaces") &&
      passedAssertion("rejecting anchor edit records rejection without changing anchors or refresh proposals"),
    evidence: layout.identityProducer?.anchorResolution
      ? JSON.stringify({
          commit: layout.identityProducer.anchorResolution.commit?.id,
          refresh: layout.identityProducer.anchorResolution.commit?.reconstructionRefreshProposal?.id,
          rejected: layout.identityProducer.anchorResolution.reject?.id,
          history: layout.identityProducer.anchorResolution.historyAfterReject?.length ?? 0
        })
      : "No anchor edit resolution evidence recorded.",
    next: "Carry committed anchor changes into scenario certainty and locate/layout readbacks."
  },
  {
    id: "anchor-commit-readback",
    lane: "verification",
    question: "Do committed anchor edits propagate into backend anchor records, scenario certainty, and locate answers?",
    pass: passedAssertion("committed anchor readback is exposed on coordinate and backend anchor records") &&
      passedAssertion("layout scenario certainty references latest committed anchor edit") &&
      passedAssertion("locate answer readback carries committed anchor context"),
    evidence: layout.identityProducer?.anchorResolution
      ? JSON.stringify({
          commit: layout.identityProducer.anchorResolution.commit?.id,
          backendAnchor: layout.identityProducer.anchorResolution.backendAnchorRecord?.commitId,
          locateAnchor: layout.identityProducer.anchorResolution.locateAfterCommit?.placementEvidence?.latestAnchorCommitId
        })
      : "No anchor commit readback evidence recorded.",
    next: "Add scenario commit gate that merges anchor, reconstruction, support, identity, and placement blockers."
  },
  {
    id: "layout-scenario-commit-gate",
    lane: "verification",
    question: "Does each layout scenario expose a unified commit gate with all blocking domains?",
    pass: passedAssertion("layout scenario commit gate merges placement support scan reconstruction identity and privacy blockers"),
    evidence: layout.layoutScenarioCompare
      ? JSON.stringify({
          gates: (layout.layoutScenarioCompare.records ?? []).map((record) => ({
            id: record.id,
            status: record.commitGate?.status,
            blockers: record.commitGate?.blockerCount,
            types: record.commitGate?.blockerTypes
          }))
        })
      : "No layout scenario commit gate evidence recorded.",
    next: "Add scenario apply/reject drafts that can consume the commit gate when blockers are cleared."
  },
  {
    id: "layout-scenario-decision-drafts",
    lane: "verification",
    question: "Do layout scenario apply/reject decisions have explicit draft and history boundaries without writes?",
    pass: passedAssertion("requesting scenario apply creates blocked decision draft from commit gate") &&
      passedAssertion("layout scenario apply draft round-trips through panel backend and layout snapshot") &&
      passedAssertion("rejecting layout scenario records decision history without applying geometry") &&
      passedAssertion("layout scenario decisions do not mutate furniture ledger or geometry ops while blocked"),
    evidence: layout.layoutScenarioDecision
      ? JSON.stringify({
          apply: layout.layoutScenarioDecision.applyDraft?.id,
          applyStatus: layout.layoutScenarioDecision.applyDraft?.status,
          rejected: layout.layoutScenarioDecision.rejectRecord?.id,
          furnitureUnchanged: layout.layoutScenarioDecision.readOnlyState?.furnitureUnchanged
        })
      : "No layout scenario decision evidence recorded.",
    next: "Add scenario focus/readback parity across panel, 2D plan, backend, and locate context."
  },
  {
    id: "layout-scenario-focus-parity",
    lane: "interface",
    question: "Does scenario focus stay consistent across panel, 2D plan, backend, layout snapshot, and locate context?",
    pass: passedAssertion("layout scenario focus round-trips through backend and layout snapshot") &&
      passedAssertion("layout scenario focus is visible in panel row and focus summary") &&
      passedAssertion("2D plan scenario ghosts follow focused scenario") &&
      passedAssertion("locate answer carries focused layout scenario context"),
    evidence: layout.layoutScenarioFocus
      ? JSON.stringify({
          focus: layout.layoutScenarioFocus.focus?.scenarioId,
          backend: layout.layoutScenarioFocus.backendFocus?.scenarioId,
          ghosts: layout.layoutScenarioFocus.ghosts?.map((ghost) => ghost.scenarioId).join(","),
          locate: layout.layoutScenarioFocus.locate?.placementEvidence?.focusedLayoutScenarioId
        })
      : "No layout scenario focus evidence recorded.",
    next: "Freeze deterministic scenario fixtures and add replay verification."
  },
  {
    id: "layout-scenario-fixture-replay",
    lane: "verification",
    question: "Can scenario recommendations be frozen as deterministic fixtures and replayed without drift?",
    pass: passedAssertion("layout scenario deterministic fixtures freeze decision-critical fields") &&
      passedAssertion("layout scenario fixture replay is deterministic for focused scenario") &&
      passedAssertion("layout scenario fixture can replay by fixture id") &&
      passedAssertion("layout scenario fixtures and replay round-trip through backend and layout snapshot") &&
      passedAssertion("layout scenario fixture replay does not mutate canonical furniture placement or write ops"),
    evidence: layout.layoutScenarioReplay
      ? JSON.stringify({
          fixtures: layout.layoutScenarioReplay.fixtures?.length ?? 0,
          replay: layout.layoutScenarioReplay.replay?.status,
          scenario: layout.layoutScenarioReplay.replay?.scenarioId,
          backendReplay: layout.layoutScenarioReplay.backendReplay?.status,
          readOnly: layout.layoutScenarioReplay.readOnlyState?.furnitureUnchanged
        })
      : "No layout scenario replay evidence recorded.",
    next: "Add an end-to-end demo trace from scan capture through reconstruction, scenario gate, human decision, anchor commit, and locate readback."
  },
  {
    id: "roomrecall-end-to-end-demo",
    lane: "verification",
    question: "Does the prototype expose one auditable chain from scan capture to locate readback?",
    pass: passedAssertion("end-to-end demo trace exposes ordered proposal-first stages") &&
      passedAssertion("end-to-end demo keeps scan reconstruction and scenario application behind review gates") &&
      passedAssertion("end-to-end demo trace names committed Place Graph write types") &&
      passedAssertion("end-to-end demo locate readback carries committed anchor and preview scenario context") &&
      passedAssertion("end-to-end demo preserves private and unknown scan boundaries") &&
      passedAssertion("end-to-end demo trace round-trips through backend and layout snapshot"),
    evidence: layout.endToEndDemo
      ? JSON.stringify({
          stages: layout.endToEndDemo.stageOrder,
          policy: layout.endToEndDemo.record?.reviewCommitPolicy,
          writes: layout.endToEndDemo.writeTypes,
          anchor: layout.endToEndDemo.commitIds?.anchorEdit,
          reviewBoundaries: layout.endToEndDemo.record?.allReviewBoundariesPresent
        })
      : "No end-to-end demo evidence recorded.",
    next: "Promote the strongest prototype paths into a product PRD and decide which V1 surface should become real."
  },
  {
    id: "product-intake-fit",
    lane: "spatial",
    question: "Does product intake create dimensional objects without losing default home?",
    pass: Boolean(product.created && product.movedDefaultPreserved),
    evidence: `created=${Boolean(product.created)}, movedDefaultPreserved=${Boolean(product.movedDefaultPreserved)}, width=${product.widthMeters ?? "n/a"}m.`,
    next: "Run target-container fit precheck before committing a product-created item to a container."
  },
  {
    id: "privacy-and-unknown-regions",
    lane: "semantic",
    question: "Does scanning distinguish unknown/private geometry from empty space?",
    pass: passedAssertion("2D plan renders unknown or redacted scan regions") &&
      Number(layout.scanCoverage ?? 0) >= 0.7,
    evidence: `scanCoverage=${layout.scanCoverage ?? 0}; unknown/redacted DOM assertion=${passedAssertion("2D plan renders unknown or redacted scan regions")}.`,
    next: "Connect unknown, empty, occluded, and private scan regions to reviewable coverage records instead of silent emptiness."
  }
];

for (const probe of probes) {
  const previous = previousProbeMap.get(probe.id);
  probe.delta = previous === undefined ? "new" : previous === probe.pass ? "unchanged" : probe.pass ? "improved" : "regressed";
}

const passed = probes.filter((probe) => probe.pass);
const failed = probes.filter((probe) => !probe.pass);
const priorityOrder = ["killer-loop-ledgered-answer", "mutation-bundle-shape", "affected-placement-visibility"];
const priorityFailed = priorityOrder
  .map((id) => failed.find((probe) => probe.id === id))
  .filter(Boolean);
const stretchQueue = [
  "roomrecall-end-to-end-demo",
  "layout-scenario-fixture-replay",
  "layout-scenario-focus-parity",
  "layout-scenario-decision-drafts",
  "layout-scenario-commit-gate",
  "anchor-commit-readback",
  "anchor-edit-resolution-boundary",
  "anchor-edit-stale-geometry",
  "scan-reconstruction-job-contract",
  "layout-scenario-scan-certainty",
  "layout-scenario-support-reasons",
  "layout-scenario-geometry-impact",
  "layout-scenario-compare",
  "3d-manipulation-affordance-readouts",
  "3d-volume-and-occupancy-silhouettes",
  "3d-object-archetype-refinement",
  "plan-density-answer-reveal",
  "retrieval-spatial-overlay-surface",
  "retrieval-agent-explanation-surface",
  "scan-identity-answer-lineage",
  "scan-identity-commit-ledger",
  "scan-identity-review-loop",
  "scan-identity-proposal-contract",
  "scan-identity-producer",
  "scan-proposal-loop",
  "privacy-and-unknown-regions",
  "plan-volume-resize-commit",
  "product-intake-fit",
  "support-surface-precheck-gate",
  "support-drag-preview-gate",
  "support-manual-patch-preview",
  "plan-patch-handle-layers",
  "plan-patch-handle-drag",
  "plan-volume-resize-preview",
  "support-check-causal-ids",
  "support-pose-snapping",
  "3d-state-driven-furniture",
  "backend-write-model-records",
  "2d-semantic-overlays"
]
  .map((id) => probes.find((probe) => probe.id === id))
  .filter(Boolean);
const nextQueue = (failed.length
  ? [...priorityFailed, ...failed.filter((probe) => !priorityOrder.includes(probe.id))]
  : stretchQueue
).slice(0, 4);
const dominantLane = mostCommon(nextQueue.map((probe) => probe.lane));
const changedSources = changedSourceNames(previousState?.sourceHashes, sourceHashes);
const countableChangeType = classifyChange(changedSources);
const fingerprint = hash(JSON.stringify({ sourceHashes, assertionFailures: assertionFailures.map((item) => item.name), probePasses: probes.map((probe) => [probe.id, probe.pass]) }));
const iterationId = `rr-${fingerprint.slice(0, 12)}`;
const parentIterationId = previousState?.iterationId && previousState.iterationId !== iterationId
  ? previousState.iterationId
  : previousState?.parentIterationId ?? null;

const iterationState = {
  generatedAt: new Date().toISOString(),
  iterationId,
  parentIterationId,
  sourceHashes,
  verificationGeneratedAt: report.generatedAt ?? reportStat.mtime.toISOString(),
  countableChangeType,
  changedSources,
  verification: {
    assertionCount: assertions.length,
    assertionFailures: assertionFailures.map((assertion) => assertion.name),
    url: report.url
  },
  loopScore: {
    passed: passed.length,
    failed: failed.length,
    total: probes.length,
    ratio: Number((passed.length / probes.length).toFixed(2))
  },
  dominantLane,
  probes,
  probeDelta: probes.map((probe) => ({
    id: probe.id,
    delta: probe.delta,
    pass: probe.pass
  })),
  nextQueue: nextQueue.map((probe, index) => ({
    order: index + 1,
    id: probe.id,
    lane: probe.lane,
    question: probe.question,
    next: probe.next
  })),
  recommendedNextPatch: nextQueue[0]?.next ?? "Keep verifying the existing loop before adding scope."
};

await writeFile(stateUrl, JSON.stringify(iterationState, null, 2));
await writeFile(markdownUrl, renderMarkdown(iterationState));
console.log(renderConsole(iterationState));

function passedAssertion(name) {
  return assertionByName.get(name)?.pass === true;
}

function assertionDetails(name) {
  return assertionByName.get(name)?.details ?? null;
}

function sameSequencePrefix(actual, expected) {
  return expected.every((label, index) => actual[index] === label);
}

function changedSourceNames(previousHashes, currentHashes) {
  if (!previousHashes) return Object.keys(currentHashes);
  return Object.entries(currentHashes)
    .filter(([name, value]) => previousHashes[name] !== value)
    .map(([name]) => name);
}

function classifyChange(changedSources) {
  if (!changedSources.length) return "unchanged";
  if (changedSources.some((name) => ["index.html", "verify.mjs"].includes(name))) return "prototype";
  if (changedSources.some((name) => name.endsWith(".md"))) return "prd";
  return "verification";
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "verification";
}

function renderConsole(state) {
  return [
    `RoomRecall self-loop ${state.iterationId}: ${state.loopScore.passed}/${state.loopScore.total} probes passing`,
    `Dominant next lane: ${state.dominantLane}`,
    `Countable change: ${state.countableChangeType} (${state.changedSources.join(", ") || "none"})`,
    `Recommended next patch: ${state.recommendedNextPatch}`,
    `Wrote ${markdownUrl.pathname}`,
    `Wrote ${stateUrl.pathname}`
  ].join("\n");
}

function renderMarkdown(state) {
  const probeRows = state.probes
    .map((probe) => `| ${probe.pass ? "pass" : "needs work"} | ${probe.delta} | ${probe.lane} | ${probe.id} | ${probe.evidence} | ${probe.next} |`)
    .join("\n");
  const queueRows = state.nextQueue
    .map((item) => `${item.order}. ${item.next} (${item.lane}: ${item.id})`)
    .join("\n");
  return `# RoomRecall Self-Loop Report

Generated: ${state.generatedAt}

## Countable Iteration

- Iteration id: ${state.iterationId}
- Parent iteration id: ${state.parentIterationId ?? "none"}
- Verification generated: ${state.verificationGeneratedAt}
- Countable change type: ${state.countableChangeType}
- Changed sources: ${state.changedSources.length ? state.changedSources.join(", ") : "none"}

## Status

- Verification assertions: ${state.verification.assertionCount}
- Assertion failures: ${state.verification.assertionFailures.length ? state.verification.assertionFailures.join(", ") : "none"}
- Loop score: ${state.loopScore.passed}/${state.loopScore.total}
- Dominant next lane: ${state.dominantLane}
- Recommended next patch: ${state.recommendedNextPatch}

## Probe Matrix

| Status | Delta | Lane | Probe | Evidence | Next |
| --- | --- | --- | --- | --- | --- |
${probeRows}

## Next Iteration Queue

${queueRows}

## Loop Command

\`\`\`bash
node prototype/verify.mjs
node prototype/self-loop.mjs
\`\`\`
`;
}
