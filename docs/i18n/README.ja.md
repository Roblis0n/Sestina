<div align="center">
  <img src="../../apps/research-room/client/public/sestina-logo.png" width="120" height="120" alt="Sestina logo">
  <h1>Sestina</h1>
  <p><strong>長期の AI 支援リサーチを、焦点が合い、検証可能で、利用者の権限下にある状態に保ちます。</strong></p>

[English](../../README.md) · [简体中文](README.zh-CN.md) · **日本語** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)
</div>

---

Sestina は、1 回のチャットでは終わらない調査のためのローカル対話型
アプリケーションです。Research Room は、現在の問い、Evidence、Decision、
未解決の Issue、Correction、出典、次に安全に行える操作を、一つの継続的な
ワークスペースにまとめます。モデルは提案できますが、研究方針や正式な状態を
変更できるのは利用者だけです。

## 主な特徴

- バージョン管理された Research Brief と現在の研究線により、問いの静かな
  すり替わりを防ぎます。
- 提案と正式な Decision を分離し、権限を伴う操作には直接の利用者確認と
  追記型 Receipt を要求します。
- Provider 呼び出し前に、送信対象・除外対象・目的・制限・ハッシュを含む
  正確な Context Manifest を表示します。
- Correction Appeal、独立して設定する second opinion、相互に出力を見ない
  2 参加者の限定的 Deliberation Room を提供します。
- プロジェクト単位の管理されたメモリ、バックアップ、復元、スキーマ移行に
  よって、根拠を捏造せずに作業を再開できます。

## 権限とプライバシー

Research Deliberation Kernel が状態遷移と Authority Gate を所有し、Research
Room が主要インターフェースです。CLI、Skill、MCP、ホストアダプターは薄い
接続層であり、公開 MCP は読み取り専用です。

利用者は唯一の研究権限者です。Provider の出力、モデル間の合意、署名、
ハッシュ、ツール成功は、Brief、Decision、Issue、Review、Appeal、または
Deliberation の状態を変更できません。証拠が不足している内容は unknown または
unproven のまま扱います。

データは既定で選択したプロジェクトの `.sestina` ディレクトリに保存されます。
必須クラウドアカウント、バックグラウンド同期、テレメトリ、クラッシュ送信、
自動アップロードはありません。外部 Provider への送信は、利用者が接続を設定し、
正確な Manifest を確認して、その 1 回の要求を承認した場合に限られます。

## 0.2.0 public preview の起動

Node.js 24.x とローカルブラウザーが必要です。

1. [`v0.2.0` Release](https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0)
   から `SHA256SUMS` と OS に合うアーカイブをダウンロードします。
2. SHA-256 を検証してから、新しい空のディレクトリへ展開します。
3. 展開したディレクトリで次を実行します。

```text
node start.mjs --version --json
node start.mjs
```

表示された `http://127.0.0.1:...` だけを開いてください。Windows x64、macOS
arm64、Ubuntu x64 がサポート対象です。詳細は
[リリースガイド](../release/README.md)を参照してください。

0.2.0 はアーカイブ形式のプレビューで、インストーラー、自動更新、署名、
公証、バックグラウンドサービス、npm 公開、クラウド同期は含みません。
テストやアーティファクト検証は、研究結果や Provider の意味的品質を保証しません。

ソースは [Apache License 2.0](../../LICENSE) で公開されています。貢献する場合は
[CONTRIBUTING.md](../../CONTRIBUTING.md)を読み、実データではなく合成データだけを
使用してください。
