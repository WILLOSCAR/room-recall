# 02 - Harden Commit Ledger persistence

Type: implementation
Status: ready-for-agent
Blocked by: 01

Route every Store command through one staged transaction. Persist before publishing, roll back on persistence failure, isolate listeners, validate imports before replacement, and make corruption visible. Replace repeated synchronous file read/parse/overwrite with a cached image and atomic temporary-file rename.

Done when acknowledged writes survive reload, injected failures publish nothing, bad durable data never becomes seed, and JSON v2 export/import stays compatible.
