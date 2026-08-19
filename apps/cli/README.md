# @sestina/cli

Offline command-line access to the Sestina research revision lifecycle. The
CLI opens one project-local `.sestina/state.sqlite` database and calls
`@sestina/core` for every business operation; it does not connect to a model or
network service.

The executable supports project initialization and diagnosis; Brief,
Artifact, Revision, and Episode preparation; Decision and Issue authority
transitions; deterministic Review runs; explicit Episode dispositions and
scoped waivers; immutable Snapshot creation and hash verification; standalone
Markdown/JSON reports; and minimized Capsule export/import.

Run `sestina help` for the command groups. Use `--json` for stable machine
output. Any action that changes user authority requires `--yes`; imported
Capsule responses remain `model_proposed` candidates and cannot mutate
authoritative research state.
