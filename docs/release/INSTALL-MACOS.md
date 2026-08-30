# macOS arm64 / macOS Apple 芯片安装

Requirements / 要求：Apple silicon macOS、Node.js 24.x、本地浏览器。
This public preview is not code-signed or notarized.

本公开预览没有代码签名或 Apple 公证。请从同一 `v0.2.0` GitHub Release 下载：

- `sestina-research-room-0.2.0-macos-arm64.tar.gz`
- `SHA256SUMS`

Verify and extract:

```sh
shasum -a 256 sestina-research-room-0.2.0-macos-arm64.tar.gz
cat SHA256SUMS
tar -xzf sestina-research-room-0.2.0-macos-arm64.tar.gz
cd sestina-research-room-0.2.0-macos-arm64
node ./start.mjs --version --json
node ./start.mjs
```

Only continue when the hash matches. Open only the printed
`http://127.0.0.1:...` URL; use `node ./start.mjs --port 0` if port 43148 is
occupied.

只有 hash 完全一致才继续。只打开程序打印的本地地址；端口冲突时使用
`--port 0`。

Explicitly configured Provider keys use the current user's macOS Keychain. An
unavailable Keychain leaves Sestina in offline ledger-only mode. To uninstall,
stop the process and remove only the extracted app directory; project `.sestina`
state remains untouched.

显式配置的 Provider 密钥使用当前用户 Keychain；不可用时保持离线模式。
卸载只删除程序目录，不删除项目 `.sestina` 状态。
