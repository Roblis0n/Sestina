# Demo 3 — scope overreach

The Brief allows edits only under `allowed/`, while the Artifact is under
`outside/`. The deterministic scope checker must produce a blocking
`scope_violation`, bind it to a concrete Markdown block, render a minimum
recovery path, and make the CLI return exit code `5`.

The Episode is explicitly rejected before its immutable Snapshot is created.
