# Ubuntu x64 / Ubuntu x64 安装

Requirements / 要求：Ubuntu x64、Node.js 24.x、本地浏览器。

Download from the same `v0.2.0` GitHub Release:

- `sestina-research-room-0.2.0-ubuntu-x64.tar.gz`
- `SHA256SUMS`

Verify, extract, and start:

```sh
sha256sum sestina-research-room-0.2.0-ubuntu-x64.tar.gz
cat SHA256SUMS
tar -xzf sestina-research-room-0.2.0-ubuntu-x64.tar.gz
cd sestina-research-room-0.2.0-ubuntu-x64
node ./start.mjs --version --json
node ./start.mjs
```

Only continue when the hash matches. Open only the printed loopback URL; use
`node ./start.mjs --port 0` if port 43148 is occupied.

只有 hash 完全一致才继续，只打开程序打印的 `127.0.0.1` 地址；端口冲突时
使用 `--port 0`。

Provider keys require a current-user Secret Service implementation such as
GNOME Keyring or KWallet. Sestina never silently falls back to plaintext. If
secure storage is absent, Provider use is blocked and local ledger-only work
remains available.

Provider 密钥要求当前用户的 Secret Service（如 GNOME Keyring 或 KWallet）。
Sestina 不会静默回退到明文；安全存储缺失时阻止 Provider，保留本地工作。

To uninstall, stop the process and remove only the extracted app directory.
Project `.sestina` state is not removed. / 卸载只删除程序目录，不删除项目状态。
