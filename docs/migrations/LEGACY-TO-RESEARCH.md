# Legacy to Research migration

The legacy importer is the only new product boundary allowed to interpret the
legacy project, contract, correction, and evidence tables. It opens the source
database read-only and follows one explicit flow:

`scan → dry-run plan → user selection → target transaction → verification report`

Scanning never writes either database. A plan binds a content fingerprint, a
database-identity fingerprint, mapping version, stable candidate identities,
and a canonical plan hash. Execution rejects a changed source, altered plan,
non-user selection, unsafe dependency selection, mapping failure, or target
identity conflict. All selected target writes use one research-store unit of
work, so a failed write rolls back the whole batch.

Imported values retain `imported_unconfirmed` authority. Contract data becomes
an inactive Research Brief draft and a supporting empty artifact. Corrections
become proposed Decisions only. Evidence and legacy completion facts remain
typed deferred candidates; they are not verified evidence or accepted Episodes.
Only an explicit user transition can activate or confirm imported research
state.

The importer does not add a migration, dual-write, mark legacy rows, disclose a
source path, or include unknown raw JSON in reports and errors. Re-running an
unchanged import skips identical deterministic Research IDs. The same identity
with changed mapped content fails closed as a conflict.
