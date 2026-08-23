# Sestina Research Room

The RI-48 Research Room is a loopback-only local web application. On Windows,
its primary project action opens the operating system's folder picker; a manual
absolute-path mode remains available as a fallback. It opens only the directory
the owner explicitly selects. When that directory has no `.sestina`, the same
open-or-initialize action creates the local project and asks the owner for the
initial research question and current task on the next screen.
It then shows the exact Context Manifest before any Provider call and requires a
separate explicit owner action before a disposition can change research state.

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
