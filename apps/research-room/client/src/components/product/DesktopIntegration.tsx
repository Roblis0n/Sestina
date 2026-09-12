import { useState } from "react";
import { desktop } from "../../api/desktop.js";
import { Button } from "../primitives/Button.js";
export function DesktopIntegration({
  en,
  projectId,
}: {
  en: boolean;
  projectId: string;
}) {
  const [config, setConfig] = useState<{
    json: string;
    toml: string;
    companionDirectory: string;
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      const bridge = desktop();
      if (!bridge) throw Error("desktop_required");
      const session = await bridge.methods.kernelStatus();
      if (!session.ok) throw Error();
      const reply = await bridge.methods.integration({
        action,
        projectId,
        sessionGeneration: (session.value as { sessionGeneration: number })
          .sessionGeneration,
      });
      if (!reply.ok) throw Error();
      if (action === "config")
        setConfig(
          reply.value as {
            json: string;
            toml: string;
            companionDirectory: string;
          },
        );
    } catch {
      setError(
        en
          ? "Integration files could not be opened. Check that this project is still open and the application installation is complete."
          : "未能打开集成文件。请确认项目仍已打开，且应用安装完整。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>
        {en ? "Read-only MCP and companion Skills" : "只读 MCP 与配套 Skills"}
      </summary>
      <p>
        {en
          ? "This configuration uses the runtime included with this installation. A host you configure can read the allowed project snapshot; it cannot save research decisions. Showing the configuration does not start a connection or send project content."
          : "此配置使用本次安装附带的运行时。你配置的宿主可以读取允许的项目快照，不能保存研究决定。显示配置不会启动连接，也不会发送项目内容。"}
      </p>
      <Button disabled={busy} onClick={() => void act("config")}>
        {en ? "Show configuration to copy" : "显示可复制的配置"}
      </Button>
      <Button disabled={busy} onClick={() => void act("open_companion")}>
        {en ? "Open companion Skills" : "打开配套 Skills"}
      </Button>
      {config ? (
        <>
          <label>
            {en ? "MCP configuration (JSON)" : "MCP 配置（JSON）"}
            <textarea
              rows={8}
              readOnly
              value={config.json}
              onFocus={(e) => {
                e.currentTarget.select();
              }}
            />
          </label>
          <label>
            {en ? "Codex configuration (TOML)" : "Codex 配置（TOML）"}
            <textarea
              rows={5}
              readOnly
              value={config.toml}
              onFocus={(e) => {
                e.currentTarget.select();
              }}
            />
          </label>
          <p>
            {en
              ? "Copy the settings into your host and enable them explicitly. The host connection has not been verified. Agent Corrector uses the included generated Skill and hands proposals back as drafts."
              : "将配置复制到宿主并显式启用。当前尚未验证宿主连接。Agent Corrector 使用附带的生成版 Skill，通过草稿交接建议。"}
          </p>
          <p className="break-path">{config.companionDirectory}</p>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
