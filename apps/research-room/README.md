# Sestina Research Room

The RI-48 Research Room is a loopback-only local web application. On first run,
it requires an explicit `中文` or `English` interface-language choice before a
project can be opened. The choice is stored as a strict App-level preference in
`%LOCALAPPDATA%\Sestina\preferences.json` on Windows and is restored across
browser, service, and project changes. It can be changed explicitly from the
top-right control. It is not stored in project state, a receipt, Provider
Context, browser storage, or Git, and it never changes user research text.

On Windows, the primary project action opens the operating system's folder
picker; a manual absolute-path mode remains available as a fallback. It opens
only the directory the owner explicitly selects. When that directory has no
`.sestina`, the same open-or-initialize action creates the local project and asks
the owner for the initial research question and current task on the next screen.
It then shows the exact Context Manifest before any Provider call and requires a
separate explicit owner action before a disposition can change research state.

The top-right Provider settings dialog supports exactly one
`openai_compatible` family. Enter a Base URL, model, and API key for external
HTTPS; explicit loopback HTTP may be configured without a key. The Provider
name already has a safe default, while timeout and output-token controls remain
available. Saving does not probe the network or call a model. Configuration is
App-level, not project-level; the key is stored through `@sestina/secrets`
(current-user DPAPI on Windows) and is never returned to the page or written to
the config file. Reopen the project after a configuration change so a new
generation is bound to the next Manifest.

For each suggestion, first select **Generate Context Manifest** and inspect the
exact endpoint, request body, byte count, protocol/Prompt/rubric hashes, state
and request hashes, and excluded fields. Only **I reviewed it; start analysis**
can issue the single request. The response must contain all nine unique
criterion assessments with valid evidence spans and bindings. The Kernel, not
the model, derives Findings, ArgumentDelta, unknowns, and reasonable-increment
status; only the owner can commit one of the five dispositions. Cancelling,
timeouts, invalid output, changed configuration, or no configuration fail
closed to the local ledger without partial semantic findings or authority
writes.

From the repository root:

```text
pnpm --filter @sestina/research-room build
node apps/research-room/dist/main.js
```

Open `http://127.0.0.1:43148`. No semantic Provider is configured by the shipped
launcher, so it safely degrades to `ledger_only`. The server refuses non-loopback
bind addresses and does not scan selected directory contents, upload data, emit
telemetry, or write an export without an explicit user action. Existing files in
the selected directory are not imported or modified. A foreign or partial
`.sestina` directory is preserved and rejected instead of being overwritten.
The selected path stays inside the local server process and is never returned by
the folder-picker API. Cancelling the system dialog performs no write. On hosts
where the native picker is unavailable, the UI exposes manual mode immediately.

The shipped UI is a desktop research workstation with bilingual entry, Brief,
Room, feedback, and recovery copy. Short transitions communicate view entry,
busy work, stage progression, findings, and receipts. When Windows or the
browser requests reduced motion, nonessential animation is disabled and the
entire workflow remains operable.

The development-only Semantic Judge benchmark and its reproducible
export/run/import/evaluate workflow are documented at
`researchbench/research-room-semantic-judge/README.md`. It contains 96
development and 96 hash-locked test cases, split equally between zh-CN and
English. It is synthetic implementation evidence, never external-user or market
evidence. With no user-configured Provider, the checked-in real-host smoke and
semantic metrics remain `blocked_missing_user_config`.
