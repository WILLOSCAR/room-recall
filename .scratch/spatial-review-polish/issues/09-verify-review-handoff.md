# 09 - Verify, review, and hand off

Type: review
Status: ready-for-agent
Blocked by: 02, 03, 04, 05, 06, 07, 08

Run deterministic verification (target: all assertions green including the new ticket-01 contract, settled RAF = 0, GPU budget respected), regenerate runtime + browser benchmarks and desktop/mobile screenshots, then independent Standards and Spec reviews against this spec and ADR 0002. Fix all P0/P1 findings or record an explicit bounded residual. Update the tracker (mark tickets done) and the handoff.

Done when the branch is reproducible and green, the read-only-projection invariant is demonstrably intact (no new write path, signature-stable selection), and no push/deploy/hosting claim is made without separate evidence.