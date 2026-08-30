# Public-preview security boundaries / 公开预览安全边界

- The service binds only to `127.0.0.1`; non-loopback Host headers are rejected.
- Every mutation requires the unguessable token of the active local process.
- Default mode is offline `ledger_only`: no telemetry, update check, crash
  upload, background upload queue, automatic Provider call, or automatic retry.
- Provider context is visible in an exact Context Manifest and requires explicit
  confirmation. Provider/model output is a candidate, never user authority.
- Explicitly configured secrets use current-user DPAPI, Keychain, or Secret
  Service. If safe storage is unavailable, key storage fails closed; there is no
  automatic plaintext fallback.
- Restore confirmation is separate, short-lived, single-use, and bound to one
  session, project, backup Manifest, and current-state hash.
- Release verification rejects path traversal, links/special entries, source
  maps, databases, logs, credentials, environment files, personal paths, and
  undeclared files.
- Installation is explicit archive extraction. There is no postinstall script,
  npm publication, updater, daemon, signing, or notarization in 0.2.0.
- Removing the runtime never authorizes deletion of project data.

- 服务只绑定 `127.0.0.1`，拒绝非 loopback Host。
- 每次写操作都要求当前本地进程的不可猜测 token。
- 默认离线 `ledger_only`：无遥测、更新检查、崩溃上传、后台上传、自动 Provider
  调用或自动重试。
- 外发 Context 必须通过精确可见的 Manifest 并显式确认；模型输出只是候选。
- 密钥只使用当前用户 DPAPI、Keychain 或 Secret Service；不可用时失败关闭，
  不自动明文回退。
- 恢复确认短期、单次使用，并绑定会话、项目、备份 Manifest 与当前状态 hash。
- 制品校验拒绝路径穿越、链接/特殊项、source map、数据库、日志、凭证、环境
  文件、个人路径与未声明文件。
- 0.2.0 只有显式解压安装，无 postinstall、npm 发布、更新器、守护进程、签名或
  公证；删除运行时不等于授权删除项目数据。

Report vulnerabilities privately as described in the repository root
`SECURITY.md`. Never submit research content, secrets, project paths, or raw
logs. These controls do not prove research correctness or Provider quality.

漏洞按根目录 `SECURITY.md` 私下报告，禁止提交研究内容、密钥、项目路径或原始
日志。以上控制不证明研究结论或 Provider 质量。
