# Windows x64 / Windows x64 安装

Requirements / 要求：Windows x64、Node.js 24.x、本地浏览器。

Download these files from the same `v0.2.0` GitHub Release:

- `sestina-research-room-0.2.0-windows-x64.zip`
- `SHA256SUMS`

In PowerShell, compare the printed hash with the exact line in `SHA256SUMS`:

```powershell
Get-FileHash .\sestina-research-room-0.2.0-windows-x64.zip -Algorithm SHA256
Get-Content .\SHA256SUMS
```

Only continue when the hashes match. Extract the zip into a new empty folder,
enter `sestina-research-room-0.2.0-windows-x64`, then run:

```powershell
node .\start.mjs --version --json
node .\start.mjs
```

只在 hash 完全一致时继续。用资源管理器或 `Expand-Archive` 解压到新的空
目录，先检查版本，再启动。只打开程序打印的 `http://127.0.0.1:...` 地址；
默认端口冲突时运行 `node .\start.mjs --port 0`。

Provider keys, when explicitly configured, use current-user Windows DPAPI. If
secure storage is unavailable, Sestina refuses to store a key and remains in
offline ledger-only mode.

显式配置的 Provider 密钥使用当前 Windows 用户的 DPAPI。安全存储不可用时，
Sestina 拒绝保存密钥并保持离线 ledger-only。

To uninstall, stop the process and remove only the extracted app directory.
Do not remove a project's `.sestina` directory unless you deliberately want to
delete its Sestina state. Re-extracting the verified archive reinstalls the app.

卸载时先停止进程，只删除解压出的程序目录。除非明确要删除研究状态，否则
不要删除项目中的 `.sestina`。重新解压已校验制品即可重装。
