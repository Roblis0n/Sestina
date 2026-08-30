# Synthetic walkthrough — process validation only / 合成演练，仅验证流程

This walkthrough validates the offline runner, schema, hashing, export, and
aggregation with invented data. It is not a participant, external session,
public-preview adoption, second use, Provider evidence, or market evidence.

本演练只用虚构数据验证离线 runner、schema、hash、export 与 aggregate；它不是
参与者、外部 session、公开采用、第二次使用、Provider 证据或市场证据。

Use a temporary directory, an `internal_test` role, a locally built release
binding, and fixed synthetic outcomes. Exercise both one completed record and
one failure/exit record, export explicitly, then aggregate them. The aggregate
must exclude both from external denominators and report:

- `externalParticipantCount: 0`
- `insufficient_external_sample`
- `second_use_unproven`
- next-stage evidence gate not eligible

使用临时目录、`internal_test` 角色、本地构建绑定与固定合成结果，同时覆盖一个
完成记录和一个失败/退出记录，再显式 export 与 aggregate。汇总必须把它们排除
在外部分母之外，并保持上述未证明状态。

Never substitute real research, real identity, a real project path, device ID,
secret, Provider payload, raw error, log, or screenshot. Delete only the exact
temporary directory created for the walkthrough.

禁止替换为真实研究、真实身份、真实项目路径、设备 ID、密钥、Provider payload、
原始错误、日志或截图；只删除本次演练创建的精确临时目录。
