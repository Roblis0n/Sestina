# Sestina internal desktop candidate

This is the G10 Electron candidate, using the G8/G9 schema-25 research interface.
It is not a public release and does not change the published v0.2.0/schema-20
preview. The three-platform installation gate is not complete.

For contributors, from the repository root:

```text
pnpm install --frozen-lockfile
pnpm desktop:build
pnpm --filter @sestina/desktop start
pnpm desktop:runtime
pnpm test:desktop
```

The application loads bundled resources through `sestina://app/`; it does not
start the Research Room HTTP server or open a system browser. Main owns project
leases, OS storage, Provider connections and native confirmation. Preload exposes
named methods only. Research rules and transactions remain in Kernel.

Choose a project folder in the native picker. Create a project or open an
existing compatible project. Today, Project, Search and Settings use the same
typed projections as the controlled browser candidate. A Provider is optional.
Saving a research decision and sending checked content require main-owned user
confirmation. Closing a project revokes its session; restarting never resends a
Provider request or enables the Host bridge.

Project databases stay in the selected folders. Program installation, application
preferences, OS-encrypted credential files and project backups are separate.
No telemetry or background update checker is installed. The candidate has no
configured trusted production update root; the update page reports this as
unavailable, not up to date. Linux `basic_text` encryption is rejected.

Package a committed candidate with `pnpm desktop:package win32` (Windows x64),
`pnpm desktop:package darwin` (macOS arm64), or `pnpm desktop:package linux`
(Linux x64). Output is under `release/desktop/<platform>-<arch>/`. The recipe
includes an unsigned deterministic core, candidate manifest and platform
installer. Packaging does not establish installation, signature, notarization or
Gatekeeper acceptance. Do not publish these unsigned internal candidates.

The Windows candidate has been installed in an isolated directory, used to save
a synthetic draft, exited and reopened, uninstalled and reinstalled while retaining
the original project. The installer is unsigned. This result does not establish
public signing or the complete upgrade/recovery fault matrix.

Remaining G10 work includes legacy credential/preference migration, the complete
verified update download/staging/install path, schema-25 backup/upgrade integration,
and native-dialog/focus/motion acceptance. macOS/Linux machines and production
signing/notarization resources were explicitly unavailable for this local task.
The local implementation gaps are separate from those unavailable resources.

For actual installed-window checks, set `SESTINA_TEST_INSTALLED_EXECUTABLE` to the
installed executable and run `pnpm test:desktop`. The installed visual journey is
`node node_modules/vite-node/vite-node.mjs --config tests/post-0.2/vitest.foundation.config.ts tests/desktop/installed-visual.ts`.
Its synthetic OS-picker and native-confirmation answers are test stubs; they
exercise the real renderer, IPC, Kernel and SQLite but do not prove native-dialog
interaction or visual acceptance. Inspect the captured installed-window images.

See the current [implementation status](../../docs/product/restructure/IMPLEMENTATION-STATUS.md)
and [operations record](../../docs/product/restructure/G1-G3-OPERATIONS.md).
