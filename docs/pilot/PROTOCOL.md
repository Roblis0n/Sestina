# Sestina 0.2 public-preview behavior protocol / 公开预览行为协议

Protocol / 协议：`2026-08-30`
Pilot Kit：`2.0.0`
Release：`0.2.0` / `public_preview`

## Purpose / 目的

Observe whether independent researchers can obtain the real public artifact,
verify it, reach Research Room, complete a bounded research journey, relaunch,
recover, and voluntarily return for a second real task. This is not a demo,
testimonial, recruitment script, or automatic product decision.

观察独立研究者能否自行取得真实公开制品、校验、进入 Research Room、完成受限
研究旅程、重启、恢复，并自愿在第二个真实任务中再次使用。它不是演示、好评
征集、招募脚本或自动产品裁决。

Artifact hash, test success, owner use, internal/synthetic cases, and a single
session do not prove external value or repeat use. / 制品 hash、测试成功、项目所有
者使用、内部/合成案例与单次 session 均不能证明外部价值或重复使用。

## Eligible evidence / 合格证据

- Real `v0.2.0` GitHub Release artifact on Windows x64, macOS arm64, or Ubuntu
  x64; `distributionSource` must be `github_release` for an external researcher.
- A real independent `external_researcher`; `project_owner` and `internal_test`
  are excluded from external denominators.
- Session 2 must belong to the same opaque participant code, have ordinal `2`,
  and represent a distinct real research task. Self-report without that paired
  record remains `second_use_unproven`.
- Failed, abandoned, negative, blocking, and unwilling-to-return outcomes remain
  in the eligible evidence when the participant permits export.

- 必须使用真实 `v0.2.0` GitHub Release 制品和支持平台；外部研究者的
  `distributionSource` 必须是 `github_release`。
- 仅独立 `external_researcher` 计入外部样本；`project_owner` 与
  `internal_test` 排除。
- Session 2 必须使用相同 opaque participant code、ordinal `2`，并对应另一个
  真实研究任务；只有自报而无配对记录时仍是 `second_use_unproven`。
- 失败、放弃、否定、阻塞与不愿再次使用不能因结果不利而剔除。

No next-stage product decision is eligible until there are at least five
eligible independent external researchers, at least one valid
session-1/session-2 pair, and complete required behavior fields. Meeting the
count does not itself prove value or authorize expansion. / 至少取得 5 名合格
独立外部研究者、1 组有效 session 1/2 配对并补齐必填行为字段前，不得作出下一
阶段产品决定；达到数量也不会自动证明价值或授权扩张。

## Participant-owned sequence / 参与者持有的顺序

1. Read and explicitly accept the matching consent. No acknowledgement, no
   session record.
2. Download the matching release artifact and `SHA256SUMS`; independently verify
   the hash and extract into a new directory.
3. Record only fixed fields for download, checksum, extraction, first launch,
   time-to-room, platform, asset hash, source commit, and operating mode.
4. Attempt the real journey: project, Brief, review, Manifest, disposition,
   Receipt, recovery when needed, relaunch, and local-web shutdown/restart.
5. Record bounded outcomes, counts, minutes, burden scores, exit point, negative
   outcome, repeat-correction impact, willingness to return, and desktop need.
6. The participant decides whether to create and share the export. Export is a
   local explicit action; the runner never scans, sends, or uploads it.
7. Session 2 repeats the protocol on a distinct real task. Never infer it from
   intention or session 1.

## Privacy boundary / 隐私边界

The shareable export contains fixed enums, booleans, counts, minutes, opaque
IDs, release identity, and integrity hashes only. It contains no free text,
research content, identity, institution, contact information, project or
personal path, device identifier, secret, environment value, Provider payload,
raw error, log, stdout/stderr, screenshot, or conversation.

可分享 export 只含固定枚举、布尔值、计数、分钟数、opaque ID、发布身份与完整性
hash。它不含自由文本、研究内容、身份/机构/联系方式、项目或个人路径、设备
标识、密钥、环境值、Provider payload、原始错误、日志、stdout/stderr、截图或
对话。

Private session data remains in the participant-selected local directory.
There is no telemetry server, background discovery, upload, or automatic
collection. Delete only an exact session ID through the bounded delete command;
never recursively delete a participant directory.

私有 session 只在参与者选择的本地目录中保存；无遥测服务器、后台发现、上传或
自动收集。删除只针对精确 session ID，不递归删除参与者目录。

Before collection, the responsible organizer must determine whether local law
or institutional rules require ethics/IRB approval. If required, do not collect
until approval exists. / 收集前由责任组织者判断适用法律或机构是否要求伦理/IRB；
如要求，批准前不得收集。

## Reporting discipline / 结果纪律

Every rate reports numerator, denominator, missing count, and opaque evidence
IDs. Fewer than five eligible external participants is always
`insufficient_external_sample`; no valid pair is always `second_use_unproven`.
Aggregation never outputs Go/No-Go, never fills missing facts, and never upgrades
evidence class.

每个比例必须同时报告 numerator、denominator、missing 与 opaque evidence ID。
少于 5 人固定为 `insufficient_external_sample`；无有效配对固定为
`second_use_unproven`。汇总不自动生成 Go/No-Go、不填补缺失事实、不升级证据级别。
