# Offline research-integrity demos

Run all four vertical slices with `pnpm demo:offline`.

The command builds and invokes the real bundled CLI. Each scenario starts in a
new operating-system temporary directory, creates a real project-local SQLite
database, runs the complete Brief → Artifact → Revision → Episode → Review →
Disposition → Snapshot → Report/Capsule path, validates the live output, and
then removes the entire runtime directory.

The checked-in `actual-report.md` and `actual-report.json` files are normalized
records of a verified run. They retain only protocol-level observable facts;
random IDs, timestamps, hashes, and temporary paths are deliberately omitted.
The runner never reads these records as its result. It reads the input files,
executes Sestina, and validates newly produced reports.

The deterministic layer currently checks freshness and revision scope and
applies the existing Issue suppression policy. It does not call a model. Demo
1 therefore remains `semantic_pending`; Demo 4 remains semantically
`unproven`. Neither a successful tool call nor user risk acceptance is reported
as proof of the research conclusion.
