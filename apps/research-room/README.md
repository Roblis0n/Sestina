# Sestina Research Room

The RI-48 Research Room is a loopback-only local web application. It opens only
the project directory the owner selects. When that directory has no `.sestina`,
the explicitly labelled open-or-initialize action creates the local project and
the same page asks the owner for the initial research question and current task.
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
