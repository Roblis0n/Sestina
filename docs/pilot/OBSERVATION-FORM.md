# Structured observation form / 结构化观察表

Protocol and consent `2026-08-30`; Pilot Kit `2.0.0`. Record fixed fields only.
Do not paste or paraphrase research content, identity, paths, raw errors, logs,
or other free text into the shareable record.

只记录固定字段。禁止把研究内容、身份、路径、原始错误、日志或其他自由文本写入
可分享记录。

## Session binding / Session 绑定

- Opaque participant code: 3–32 uppercase letters/digits/`_`/`-`, not derived
  from identity or contact details.
- Ordinal: `1` or `2`; role: `external_researcher` / `project_owner` /
  `internal_test`.
- Platform: `windows_x64` / `macos_arm64` / `ubuntu_x64`.
- Distribution source: `github_release` / `local_build`; external researchers
  require `github_release`.
- Exact 40-hex source commit, 64-hex asset SHA-256, 64-hex release build ID.
- Operating mode: `ledger_only` / `provider_configured`.
- Host entry: `research_room` / `research_room_with_mcp` / `recovery_cli` /
  `multiple`; material type is one fixed enum.

## Distribution / 分发

For each step choose `success` / `failure` / `not_observed` and minutes or null:

- download; checksum verification; extraction; first launch.
- time to Research Room in minutes when first launch succeeds.
- one fixed failure point when a step fails; otherwise null.

## Real journey / 真实旅程

Choose `completed` / `not_completed` / `not_observed` for project, Brief,
review, Manifest, disposition, and Receipt. Record recovery as `success` /
`failure` / `not_needed` / `not_observed`, and relaunch as `success` / `failure`
/ `not_observed`.

项目、Brief、Review、Manifest、Disposition、Receipt 各选 completed / not
completed / not observed；恢复选 success / failure / not needed / not observed；
重启选 success / failure / not observed。

For the local web lifecycle record outcome, friction (`none` / `minor` /
`major` / `blocking`), and whether it blocked completion.

本地网页生命周期记录结果、摩擦等级与是否阻塞完成。

## Outcome / 结果

- Setup and Episode result and minutes; total session minutes.
- Exit result and one fixed exit point when not completed.
- Repeat-correction impact: `reduced` / `unchanged` / `increased` / `uncertain`.
- Necessary, unnecessary, uncertain Finding counts.
- Burden 1–5 for Brief, Decision, Issue, Manifest, Recovery.
- Preferred entry; desktop need (`none` / `helpful` / `required` / `uncertain`)
  and its bounded evidence category.
- UI need, synthetic-case discussion, willingness to use again, failure observed,
  negative feedback observed.
- `secondUseObserved` must equal whether the session ordinal is `2`; intention
  alone is not second use.

If the session completed, the release must have launched and the required
journey/relaunch fields must all be complete. Do not turn unobserved into
success. / Session 完成时，制品首启与必需旅程/重启字段必须完整；不得把未观察
改成成功。
