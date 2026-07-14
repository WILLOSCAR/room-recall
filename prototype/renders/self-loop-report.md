# RoomRecall Self-Loop Report

Generated: 2026-07-14T15:44:36.771Z

## Countable Iteration

- Iteration id: rr-fa4f2f256234
- Parent iteration id: rr-47241ff3013b
- Verification generated: 2026-07-14T15:44:13.823Z
- Countable change type: verification
- Changed sources: verification-report.json

## Status

- Verification assertions: 247
- Assertion failures: none
- Loop score: 47/47
- Dominant next lane: verification
- Recommended next patch: Promote the strongest prototype paths into a product PRD and decide which V1 surface should become real.

## Probe Matrix

| Status | Delta | Lane | Probe | Evidence | Next |
| --- | --- | --- | --- | --- | --- |
| pass | unchanged | semantic | killer-loop-correction-behavior | negative=negative-evidence-1, corrected source=corrected placement | Keep this as a regression guard while strengthening the commit ledger. |
| pass | unchanged | verification | killer-loop-ledgered-answer | commit=commit-placement-correction-1 | Add a commitPlacementCorrection path with a CommitLedgerEntry and assert locate('water bottle') returns the corrected source afterward. |
| pass | unchanged | verification | mutation-bundle-shape | {"hasObservationRecords":true,"hasDraftOps":true,"hasResultingRecords":true,"placementOps":2,"evidenceRecords":1} | Introduce a mutationBundle preview: observationRecords, evidenceRecords, draftOps, commitPreview, resultingRecords. |
| pass | unchanged | spatial | placement-invalidation | 7 affected placements; stale ops assertion=true. | Promote stale placements from current-state mutation into explicit placementReviewOps with causedByGeometryOpId. |
| pass | unchanged | interface | affected-placement-visibility | 7 named affected placements visible. | Render affected item names and parent furniture/container in Layout Health, then assert DOM parity with stalePlacementOps. |
| pass | unchanged | verification | backend-write-model-records | anchors=3, geometry=5, placements=12. | Add ids and causal fields to collisionResults so layout health can be committed as records. |
| pass | unchanged | interface | 3d-state-driven-furniture | 6 furniture groups; 11 support surfaces; ids=bed, wardrobe, desk, storage-shelf, shoe-rack, bedside-block. | Add hover affordance and surface-ownership tests for targetable 3D support surfaces. |
| pass | unchanged | spatial | support-surface-precheck-gate | {"hoverTargetable":true,"hoverMutatedPrechecks":false,"hoverDomVisible":true,"allowedBeforeConfirm":true,"snappedReady":true,"snappedConfirmed":true,"snapReason":"right_of_blocker","snapLocal":{"x":0.3,"z":0},"centerBlockerIds":["earphones"],"saturatedBlocked":true,"collisionBlocked":true,"fitBlocked":true,"staleAfterParentEdit":true} | Use direct drag preview evidence to add editable patch handles and object-volume resize controls. |
| pass | unchanged | spatial | support-drag-preview-gate | {"ready":"ready","snapped":"snapped","blocked":"surface_occupied","stale":"stale","placementUnchanged":true,"gateMatches":true,"planPreview":"ready"} | Turn preview patches into editable 2D/3D handles with user-controlled local placement instead of auto-nearest packing. |
| pass | unchanged | spatial | support-manual-patch-preview | {"clear":"manual","local":{"x":-0.45,"z":0},"blocked":"manual_patch_occupied","blockers":["earphones"],"plan":"manual","placementUnchanged":true} | Expose manual patch movement as visible 2D/3D handles instead of script-only local coordinates. |
| pass | unchanged | verification | support-manual-patch-commit | {"itemId":"custom-1784043841836","status":"confirmed","local":{"x":-0.55,"z":0.28},"precheckId":"precheck-4","commitId":"commit-support-placement-7","finalPreviewCleared":true,"survivesGeometryInvalidation":true} | Make the 2D plan patch handle pointer-draggable while reusing this commit-readback contract. |
| pass | unchanged | interface | plan-patch-handle-layers | {"hasPatch":true,"hasVolume":true,"hasHandle":true,"patchMatches3d":true,"volumeMatches3d":true} | Make the 2D handle pointer-draggable and add volume resize handles with min/max collision checks. |
| pass | unchanged | interface | plan-patch-handle-drag | {"before":{"x":-0.45,"z":0},"after":{"x":-0.62,"z":0.24},"phase":"preview_retained","placementUnchanged":true,"precheckCountUnchanged":true} | Add preview-only volume resize handles that reuse the same fit/collision and commit-readback contracts. |
| pass | unchanged | interface | plan-volume-resize-preview | {"candidate":{"width":0.18,"depth":0.18},"duringPhase":"resize_drag_preview","retainedPhase":"resize_confirm_pending","placementUnchanged":true,"itemFootprintUnchanged":true} | Add explicit confirmation for resized dimensions as separate geometry plus placement commit records. |
| pass | unchanged | verification | plan-volume-resize-commit | {"itemId":"custom-1784043839318","status":"confirmed","commitId":"commit-support-placement-5","geometryOpId":"op-commit-item-geometry-custom-1784043839318-5","previewPhase":"resize_confirm_pending","afterFootprint":{"width":0.16,"depth":0.16,"height":0.04},"renderedFootprint":{"width":0.16,"depth":0.16},"finalPreviewCleared":true} | Move the same explicit producer-review-commit boundary into scan identity observations and match/create/merge proposals. |
| pass | unchanged | verification | support-check-causal-ids | {"collision":"check-precheck-5-support-collision","snappedCheck":"check-precheck-3-support-collision","snappedPatch":{"x":0.3,"z":0,"width":0.26,"depth":0.26},"centerBlockers":["earphones"],"saturatedCheck":"check-precheck-5-support-collision","fit":["check-precheck-6-surface-fit","check-precheck-6-opening-clearance"],"staleOps":6,"manualGeometryOps":["op-manual-geometry-desk-1"],"supportPoseRecorded":true,"snappedSupportPoseRecorded":true} | Make support-local patches editable with visible handles, labels, and object volume outlines. |
| pass | unchanged | spatial | support-pose-snapping | {"snapped":true,"centerBlockerIds":["earphones"],"sharedDeskPatchCount":4,"occupancyVisualCount":10,"saturatedReason":"surface_occupied"} | Promote support-local patch snapping into draggable 2D/3D handles and translucent object volume outlines. |
| pass | unchanged | interface | support-surface-hover-affordance | {"surfaceId":"surface-desk-top","status":"allowed","owner":"furniture:desk","domVisible":true,"mutatedPrechecks":false} | Wire pointermove screenshots into a non-flaky smoke check while keeping the API hover probe as the main gate. |
| pass | unchanged | interface | 2d-semantic-overlays | envelopes=bedside access, drawer pull-out, chair pull-back, drawer pull-out, drawer pull-out; proposals=Desk footprint
              84%, Wardrobe  back wall
              76%, Bedside  block
              63%. | Collapse secondary labels until selected/hovered so dense plan zones stay readable. |
| pass | unchanged | interface | right-panel-scope | sections=Selection -> Retrieval Plan -> Spatial Frame -> Layout Health -> Scan Diff -> Contract -> Objects -> Product Intake. | Add ownership checks so each section proves it owns the right controls and data. |
| pass | unchanged | spatial | scan-proposal-loop | 3 proposals, 3 committed. | Add a scan identity producer that emits item/container observations before match, create, or merge review. |
| pass | unchanged | semantic | scan-identity-producer | {"summary":{"id":"scan-identity-producer-v1","stage":"observations","writePolicy":"observation_only","status":"partial reviewable","observationCount":5,"observationTypes":["item_candidate_seen","container_contents_seen","container_seen_empty","container_region_unknown","privacy_redacted_region"],"candidateItemCount":1,"coverageStateCount":3,"pendingIdentityResolutionCount":5},"dom":{"producerId":"scan-identity-producer-v1","observationCount":5,"observationTypes":["item_candidate_seen","container_contents_seen","container_seen_empty","container_region_unknown","privacy_redacted_region"],"text":"5\n              identity observations"},"observationTypes":["item_candidate_seen","container_contents_seen","container_seen_empty","container_region_unknown","privacy_redacted_region"],"productPriorIds":["water-bottle","earphones","gym-card","charger","custom-1784043839318","custom-1784043841836","custom-1784043842450","custom-1784043846972"]} | Promote these identity observations into match/create/merge proposals with required resolution fields. |
| pass | unchanged | semantic | scan-identity-proposal-contract | {"count":5,"types":["item_identity_match","item_identity_merge","container_seen_empty","container_contents_unknown","privacy_hold"],"domRows":5,"commitOps":0} | Turn read-only identity proposal rows into a shared review surface with selected observation focus and match/create/merge decisions. |
| pass | unchanged | interface | scan-identity-review-loop | {"selected":"identity-proposal-identity-obs-desk-lamp-candidate","action":"match_existing","draftCount":1,"identityCommitOps":0,"geometryStatusesStable":true} | Promote reviewed identity resolution drafts into an atomic scan identity commit ledger with undo/source lineage. |
| pass | unchanged | verification | scan-identity-commit-ledger | {"commitId":"commit-scan-identity-2","opTypes":["commit_identity_resolution"],"draftStatus":"committed","geometryOps":0,"placementOps":2} | Use the committed identity resolution as answer evidence, then add undo/lineage inspection for identity commits. |
| pass | unchanged | semantic | scan-identity-answer-lineage | {"answerItem":"custom-1784043846972","source":"scan_identity_commit","commitId":"commit-scan-identity-8","rowStatus":"active","rollbackType":"scan_identity_reversal"} | Use answer lineage as the retrieval-agent explanation surface, including confidence and stale/reverted identity handling. |
| pass | unchanged | semantic | retrieval-agent-explanation-surface | {"answered":"answered","needsReview":"latest_identity_commit_reverted","blockedOlder":1,"notFound":"not_found"} | Carry retrieval explanation into 2D/3D overlays so answer confidence, holds, and suppressed evidence are visible in spatial context. |
| pass | unchanged | interface | retrieval-spatial-overlay-surface | {"answeredPlan":"answered","answered3d":"item_answer","needsReviewPlan":"needs_review","notFound3d":"not_found"} | Use the spatial retrieval overlay to reduce dense 2D labels and reveal answer evidence on hover/selection. |
| pass | unchanged | interface | plan-density-answer-reveal | {"answeredDensity":"collapsed","needsReviewDensity":"collapsed","notFoundDensity":"collapsed"} | Promote 3D object refinement: dimension-scaled archetypes and clearer object silhouettes. |
| pass | unchanged | interface | 3d-object-archetype-refinement | {"productItemId":"custom-1784043846972","archetypes":[]} | Add selected-object 3D volume outlines and container occupancy silhouettes for dense storage surfaces. |
| pass | unchanged | interface | 3d-volume-and-occupancy-silhouettes | {"answerOutline":"answer_target","holdOutline":"identity_hold","occupancySilhouettes":0} | Add selected-object local axes, rotation handles, and container fit readouts for 3D manipulation. |
| pass | unchanged | interface | 3d-manipulation-affordance-readouts | {"itemId":"gym-card","fit":"fits","axes":["x","y","z"],"rotationVisible":true} | Add layout-planning scenario compare: current vs proposed furniture placement and storage gain/loss. |
| pass | unchanged | spatial | layout-scenario-compare | {"scenarios":3,"ghosts":1,"unchanged":true,"backendRecords":3} | Promote layout scenarios into explicit geometry-diff ids and predicted placement impact records. |
| pass | unchanged | verification | layout-scenario-geometry-impact | {"geometryDiffs":3,"impacts":9,"placementsUnchanged":true} | Carry scenario impact into support-surface impacts and recommendation reason codes. |
| pass | unchanged | semantic | layout-scenario-support-reasons | {"supportImpacts":7,"reasonCodes":"reduces_conflicts,requires_child_placement_review,requires_support_surface_recheck,scan_quality_capture_needed","domReasons":true} | Connect scenario recommendation reasons to scan quality, certainty, and guided capture prompts. |
| pass | unchanged | semantic | layout-scenario-scan-certainty | {"statuses":"needs_capture_before_commit","prompts":12,"promptReasons":3} | Turn scan certainty into editable anchors, keyframe coverage, and reconstruction job contracts. |
| pass | unchanged | semantic | scan-reconstruction-job-contract | {"job":"recon-job-scan-bedroom-001","route":"feed-forward-3d","frames":5,"coverage":"6/7","outputPolicy":"proposal_only"} | Make anchors editable and turn anchor changes into stale scan-derived geometry. |
| pass | unchanged | verification | anchor-edit-stale-geometry | {"draft":"anchor-draft-anchor-desk-edge","staleGeometry":2,"anchorsUnchanged":true,"dom":"anchor-draft-anchor-desk-edge"} | Promote anchor edits into explicit commit/reject boundaries with reconstruction refresh proposals. |
| pass | unchanged | verification | anchor-edit-resolution-boundary | {"commit":"commit-anchor-edit-10","refresh":"recon-refresh-anchor-draft-anchor-desk-edge","rejected":"anchor-draft-anchor-entry-wall","history":2} | Carry committed anchor changes into scenario certainty and locate/layout readbacks. |
| pass | unchanged | verification | anchor-commit-readback | {"commit":"commit-anchor-edit-10","backendAnchor":"commit-anchor-edit-10","locateAnchor":"commit-anchor-edit-10"} | Add scenario commit gate that merges anchor, reconstruction, support, identity, and placement blockers. |
| pass | unchanged | verification | layout-scenario-commit-gate | {"gates":[{"id":"scenario-desk-wall-align","status":"blocked","blockers":17,"types":["placement","support_surface","scan_quality","reconstruction","identity_or_coverage","privacy"]},{"id":"scenario-entry-rack-flush","status":"blocked","blockers":12,"types":["support_surface","scan_quality","reconstruction","identity_or_coverage","privacy"]},{"id":"scenario-shelf-vertical-storage","status":"blocked","blockers":16,"types":["placement","support_surface","scan_quality","reconstruction","identity_or_coverage","privacy"]}]} | Add scenario apply/reject drafts that can consume the commit gate when blockers are cleared. |
| pass | unchanged | verification | layout-scenario-decision-drafts | {"apply":"layout-scenario-apply-scenario-desk-wall-align","applyStatus":"blocked","rejected":"layout-scenario-reject-scenario-entry-rack-flush-1","furnitureUnchanged":true} | Add scenario focus/readback parity across panel, 2D plan, backend, and locate context. |
| pass | unchanged | interface | layout-scenario-focus-parity | {"focus":"scenario-shelf-vertical-storage","backend":"scenario-shelf-vertical-storage","ghosts":"scenario-shelf-vertical-storage","locate":"scenario-shelf-vertical-storage"} | Freeze deterministic scenario fixtures and add replay verification. |
| pass | unchanged | verification | layout-scenario-fixture-replay | {"fixtures":3,"replay":"matched","scenario":"scenario-shelf-vertical-storage","backendReplay":"matched","readOnly":true} | Add an end-to-end demo trace from scan capture through reconstruction, scenario gate, human decision, anchor commit, and locate readback. |
| pass | unchanged | verification | roomrecall-end-to-end-demo | {"stages":["scan_capture","reconstruction_job","scenario_compare","scenario_gate","anchor_commit","scenario_decision","locate_readback"],"policy":"proposal_first_no_auto_truth_writes","writes":["commit_anchor_edit","commit_identity_resolution","commit_support_surface_placement","commit_item_geometry_update","commit_scan_geometry_update","commit_scan_geometry_create","contradict_placement","create_placement"],"anchor":"commit-anchor-edit-10","reviewBoundaries":true} | Promote the strongest prototype paths into a product PRD and decide which V1 surface should become real. |
| pass | unchanged | spatial | product-intake-fit | created=true, movedDefaultPreserved=true, width=0.18m. | Run target-container fit precheck before committing a product-created item to a container. |
| pass | unchanged | semantic | privacy-and-unknown-regions | scanCoverage=0.78; unknown/redacted DOM assertion=true. | Connect unknown, empty, occluded, and private scan regions to reviewable coverage records instead of silent emptiness. |

## Next Iteration Queue

1. Promote the strongest prototype paths into a product PRD and decide which V1 surface should become real. (verification: roomrecall-end-to-end-demo)
2. Add an end-to-end demo trace from scan capture through reconstruction, scenario gate, human decision, anchor commit, and locate readback. (verification: layout-scenario-fixture-replay)
3. Freeze deterministic scenario fixtures and add replay verification. (interface: layout-scenario-focus-parity)
4. Add scenario focus/readback parity across panel, 2D plan, backend, and locate context. (verification: layout-scenario-decision-drafts)

## Loop Command

```bash
node prototype/verify.mjs
node prototype/self-loop.mjs
```
