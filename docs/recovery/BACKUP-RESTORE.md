# Backup and restore

Sestina recovery is local and model-free. A managed backup is a complete, verified pair: the SQLite project state plus the active `research-brief.yaml` projection.

This page describes the shipped schema-20 commands. The opt-in G1–G3 schema-25
foundation has a separate copied-migration journal and explicit recovery/old-backup
restore entry, documented in [foundation operations](../product/restructure/G1-G3-OPERATIONS.md).
Its durable Manifest can contain a prepared request body, so full target database
copies are sensitive research material. Do not apply the legacy payload-exclusion
statement below to a complete target database copy or use legacy writers on it.

Schema 17 stores RI-49 Appeal statements, attempts, strict normalized
assessments, deterministic comparisons, user Resolutions, transitions, and
Receipt lineage inside the same SQLite project state, so a verified managed
backup preserves them atomically with all earlier project objects. Provider
secrets, config files, raw responses, authorization headers, full network
payloads, browser profiles, logs, and screenshots are outside that state and are
not added to a recovery bundle.

## Inspect recovery state

```text
sestina data status --project <project-dir>
sestina data status --project <project-dir> --json
```

`data status` is read-only. It does not migrate, create a database, create source WAL/SHM, repair, or generate a backup. It copies the current database and any sidecars to system-temporary storage for inspection, verifies managed bundles, and leaves every byte in the project `.sestina/` tree unchanged. A damaged live database returns `recovery_required`; verified candidates still appear with `restoreAvailable: true`.

## Create a complete backup

```text
sestina data backup --project <project-dir>
```

The command obtains the maintenance fence, requires a healthy database and an exact active-Brief/YAML binding, and uses SQLite's online backup API so committed WAL content is included. It writes and verifies a temporary bundle before atomically publishing it as:

```text
.sestina/backups/manual/<backup-id>/
  manifest.json
  state.sqlite
  state.sqlite.sha256
  research-brief.yaml
  research-brief.yaml.sha256
```

The strict manifest binds its schema version, managed ID, creation time, runtime/database schema versions, project ID, active Brief/version IDs, both hashes and sizes, and an overall binding hash. Drift or any failed check prevents publication and removes the temporary bundle.

## Preview restore

```text
sestina data restore <backup-id> --project <project-dir>
```

Without `--yes`, the command accepts only a managed ID, validates canonical containment, strict manifest shape, both sidecars/hashes, SQLite integrity, schema, project, and active Brief/YAML binding, then returns the confirmation-required exit status. It does not change the database, Brief, WAL/SHM, or backup tree.

## Confirm restore

```text
sestina data restore <backup-id> --project <project-dir> --yes
```

Restore is an explicit destructive replacement of the live database and Brief. After the maintenance fence is acquired, the source is validated again. A healthy current state first becomes a complete `pre_...` managed bundle. If the live database or current binding is unhealthy, the raw database, existing WAL/SHM, and Brief are preserved under `.sestina/backups/forensic/<forensic-id>/` before replacement.

The selected database and Brief are copied to same-directory staged files and verified as a pair. Sestina moves the old live database, WAL/SHM, and Brief to rollback names, commits the new database and Brief, removes old sidecars, and re-verifies integrity, schema, project ID, active Brief/version IDs, and exact YAML projection. If either commit fails, both old files are restored. If rollback itself fails, the command returns `infrastructure_failure`, claims no success, and retains the managed/pre-restore/forensic and rollback materials for recovery.

Successful JSON includes `restored: true`, `backupId`, `databaseIntegrity: ok`, `briefBinding: matched`, `preRestoreBackupId`, `forensicCopyPreserved`, and `networkUsed: false`. It never includes an absolute path or research text.

## Damaged database procedure

1. Stop commands that write to the project.
2. Run `sestina data status --project <project-dir> --json`.
3. Select only a candidate with `valid: true` and `verification: verified`.
4. Run the restore command without `--yes` and inspect its managed ID, schema version, sizes, and confirmation statement.
5. Run the same command with `--yes`.
6. Run `data status` again and require `currentState: healthy`, `databaseIntegrity: ok`, and `currentBriefBinding: matched`.

Do not move arbitrary external files into the recovery command; paths are deliberately not accepted. Do not delete the pre-restore or forensic copy until the restored research question, Brief, and decisions have been checked.

When the Research Room cannot open an existing project, first follow its typed
recovery class: close another instance only for `busy/locked`; restore current
user write access for `read-only`; verify the selected directory/volume is
available for `unavailable`; and use the managed status/restore procedure for
`corrupt`. A failed open or migration does not overwrite the existing database.

Uninstalling the CLI or running `disconnect` does not delete these bundles or any project `.sestina/` data. See [the privacy policy](../../PRIVACY.md) and [data-flow inventory](../security/DATA-FLOW.md).

## Internal desktop candidate

For schema 25, close the project through Settings → Recovery & data, select its
folder and open Backup & recovery. Create a backup, check saved backups or open
the backup folder. Choose a verified backup to preview its identity, then confirm
the restore in the native dialog. The same Core recovery service verifies the
current state and the backup again, preserves a verified pre-restore bundle and
replaces the database/Brief pair under maintenance and writer locks. Reopen the
project after the result appears. These operations use no network.

An interrupted swap or cleanup blocks ordinary project opening. Choose Recover
interrupted restore to verify the preserved files and finish the recorded local
recovery. Unknown replacements are retained and refused. Schema-25 recovery needs
a verifiable current privacy history: corrupt or missing history cannot be
overridden by an older backup. A Forget or retired managed copy blocks restoring
content from before that cleanup. The schema-20 CLI procedure above retains its
legacy forensic behavior; it does not authorize writing schema 25.

恢复前会保护当前已保存的数据。预览过期、备份被修改、项目仍有写入会话或隐私
清理记录不一致时，恢复会停止。中断记录存在时，先选择“处理上次中断的恢复”，
完成核验后再打开项目。不要手动删除中断记录或用旧程序打开新数据库。

See [desktop operations and acceptance scope](../../apps/desktop/README.md).
