# 02 - Harden Commit Ledger persistence

Type: implementation
Status: done
Blocked by: 01

Route every Store command through one staged transaction. Persist before publishing, roll back on persistence failure, isolate listeners, validate imports before replacement, and make corruption visible. Replace repeated synchronous file read/parse/overwrite with a cached image and atomic temporary-file rename.

Done when acknowledged writes survive reload, injected failures publish nothing, bad durable data never becomes seed, and JSON v2 export/import stays compatible.

## Comments

- 2026-08-17: Done. `transact()` in `store.ts` owns stage→validate→derive→persistNow→publish with rollback on failure; `ReentrantStoreCommandError` guards subscriber/persistence re-entry; import is validated and staged with an expected-revision conflict guard; `loadLedger` fails closed on corruption (never silently reseeds); `fileStorage` uses a cached image + atomic same-dir rename. Confirmed by the review's Standards axis (faithful to ADR 0003 §1/§4/§6) and 459/459 assertions. The follow-up `4a11640` removed the now-dead `persist()`/`notify()` no-ops that `transact` superseded.
