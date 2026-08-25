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
only the directory the owner explicitly selects. An existing Sestina project
opens immediately. A plain directory first produces a path-free initialization
preview and a one-use confirmation nonce; only the separate **Initialize this
folder** action creates `.sestina`. The owner then supplies the initial research
question and current task. No first-render, picker-preview, or cancelled action
writes to the selected directory.

The Windows adapter uses the lightweight Shell folder browser rooted at This PC
instead of loading WinForms. Its child process runs at below-normal priority
when the host permits it. While the window is open, Start Center exposes an
explicit cancel action that aborts both the browser request and the local picker
process; cancellation is a normal zero-write outcome and manual mode remains
available immediately.

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
writes. Cancellation remains a true server-side operation after a request has
started: the Kernel validates the bound operation nonce and Manifest hash,
aborts the Provider signal, and refuses to persist an analyzed entry.

## Production client architecture

The only shipped page is the React / TypeScript / Vite client under `client/`.
It uses a single typed API facade in `client/src/api/client.ts`; runtime decoders
reject malformed HTTP envelopes and payloads before components can consume
them. Screens and product components never derive assessments, Findings,
ArgumentDelta, authority, or receipts. Those remain Kernel results.

The production build emits fingerprinted JavaScript and CSS. The loopback
server serves those files without a Vite development server, applies a
same-origin CSP and security headers, returns a diagnosable JSON 404 for missing
assets, and supports extensionless SPA refreshes. No CDN, remote font, telemetry,
or client-side project-path history is used.

The production composition root imports secure storage only through the
`@sestina/core` package root. A Research Room-only build resolver statically
includes the secure-storage implementation in this production bundle without
exposing a cross-package subpath or changing other Core consumers. The production-entry test
builds and spawns `dist/main.js`, initializes a clean project, activates its
Brief, and reads the persisted state back without a development server.

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
the folder-picker API. The preview response contains only whether the folder is
an existing project or can be initialized, plus the one-use nonce required for
initialization. Cancelling the system dialog or declining initialization
performs no write. On hosts where the native picker is unavailable, the UI
exposes manual mode immediately.

If an existing project's local state cannot be read or updated, the bilingual
recovery message names `.sestina/state.sqlite`, confirms that existing files
were preserved, and asks the owner to close another Sestina instance, confirm
the folder is writable, and reopen it. Stable copy is rendered directly; HTML
entities such as `&#x20;` are rejected by regression tests.

The shipped UI is a desktop `Thread + Inspector` research workstation with a
Start Center, project/Review Room navigation, a central review workflow, a
conditional Context Inspector, receipts, rollback, runtime status, and
bilingual recovery copy. Appearance preferences are a strict versioned
allowlist in browser storage: follow system, light, dark, or high contrast;
reduced motion and reduced transparency are independent. High contrast forces
opaque dark surfaces with vivid cyan, green, yellow, red, blue, and magenta
semantic colors plus stronger borders and focus rings. The 1280px layout collapses project navigation and
presents the Inspector as a focus-trapped sheet; Escape closes it and focus is
restored. The same core workflow remains usable by keyboard and at 200% text.

## Project continuity workspaces

After a project is open, the production navigation also exposes Overview,
Brief, Decisions, Issues, canonical Evidence, Episodes, Receipts, and Attention.
The URL identifies the selected workspace and optional object ID, so direct
links, refresh, Back, and Forward restore the same Core projection. Lists use
bounded project-bound cursor pages; selecting an item loads its full provenance,
relations, history, state bindings, lineage, and Core-derived legal actions.

The Brief workspace keeps an editable candidate separate from the active
version. Creating a candidate only records a proposal and field diff. A second
explicit activation binds the project, proposal, current version, user actor,
confirmation, and reason. The Core compare-and-swap and atomic
`.sestina/research-brief.yaml` publication either agree or return a stable
failure without reporting partial success.

Decision and Issue forms send explicit confirmed commands through the Core
Authority Gate. The browser never assumes success: it renders the fresh
projection returned after the Store transaction. Issue resolution requires
current canonical Evidence; waiver, dispute, reopen, Decision transitions,
supersession, and Receipt rollback preserve their existing version and legal
transition rules.

Project search examines structured projection fields only. It does not scan
ordinary files, other projects, browser history, credentials, or Provider raw
responses. Attention is rebuildable from canonical object state; transient
signals remain in the current App session and cannot accept, resolve, waive,
freeze, supersede, or otherwise change research authority. The complete
contract is documented in
`docs/architecture/02-RESEARCH-OBJECT-WORKSPACES.md`.

The development-only Semantic Judge benchmark and its reproducible
export/run/import/evaluate workflow are documented at
`researchbench/research-room-semantic-judge/README.md`. It contains 96
development and 96 hash-locked test cases, split equally between zh-CN and
English. It is synthetic implementation evidence, never external-user or market
evidence. With no user-configured Provider, the checked-in real-host smoke and
semantic metrics remain `blocked_missing_user_config`.
