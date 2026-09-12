import { useState } from "react";
import { desktop } from "../../api/desktop.js";
import { Button } from "../primitives/Button.js";
export function DesktopSettingsMigration({ en }: { en: boolean }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [source, setSource] = useState(""),
    [text, setText] = useState("");
  async function run(action: "status" | "migrate" | "import" | "export") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const bridge = desktop();
      if (!bridge) throw Error("desktop_required");
      if (action === "export") {
        const reply = await bridge.methods.preferences({ action: "read" });
        if (!reply.ok) throw Error();
        setText(JSON.stringify(reply.value, null, 2));
        setMessage(
          en
            ? "Settings are ready below. Copy this text to import them in another installation. It contains recent folder locations; no keys or session tokens are included."
            : "设置已显示在下方，可以复制后导入另一安装环境。其中包含最近文件夹位置，不包含密钥或会话令牌。",
        );
        return;
      }
      if (action === "import") {
        const input: unknown = JSON.parse(text);
        const reply = await bridge.methods.preferences({
          action: "import",
          input,
        });
        if (!reply.ok) throw Error();
        window.dispatchEvent(
          new CustomEvent("sestina-preferences-imported", {
            detail: reply.value,
          }),
        );
        setMessage(
          en
            ? "Language, appearance and recent locations imported. Choose a project folder before opening it."
            : "语言、外观和最近位置已导入。打开项目时仍需选择文件夹。",
        );
        return;
      }
      const reply = await bridge.methods.settingsMigration({ action });
      if (!reply.ok) throw Error();
      const value = reply.value as {
        source?: string;
        providers: { name: string; available?: boolean; status?: string }[];
        languageAvailable?: boolean;
        preferences?: unknown;
      };
      if (value.source) setSource(value.source);
      if (value.preferences)
        window.dispatchEvent(
          new CustomEvent("sestina-preferences-imported", {
            detail: value.preferences,
          }),
        );
      setMessage(
        action === "status"
          ? value.providers.some((p) => p.available) || value.languageAvailable
            ? en
              ? "Supported earlier settings were found. Importing keeps the original files."
              : "发现支持导入的旧设置，导入会保留原文件。"
            : en
              ? "No supported earlier settings were found in this location. You can configure services and appearance directly."
              : "此位置未发现支持导入的旧设置。可以直接设置评估服务和外观。"
          : value.providers.some((p) => p.status === "credentials_need_input")
            ? en
              ? "Configuration imported; a key could not be moved to secure storage. Re-enter it in the service settings. Original settings and keys are kept."
              : "配置已导入，但有密钥未能迁入安全存储。请在服务设置中重新输入，原配置和密钥仍保留。"
            : en
              ? "Earlier settings have been checked and imported where available. Existing desktop service settings were kept. Original files remain available."
              : "已检查并导入可用的旧设置，已有桌面服务配置保持原样。原文件仍保留。",
      );
    } catch {
      setError(
        en
          ? "Settings could not be imported. Your original files and the text below are kept. Check the exported format or configure the settings directly."
          : "未能导入设置。原文件和下方文本仍保留。请核对导出格式，或直接重新设置。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="desktop-settings-migration">
      <summary>
        {en
          ? "Bring settings from an earlier installation"
          : "导入旧安装环境的设置"}
      </summary>
      <p>
        {en
          ? "Import supported local service settings and language. Keys move only through secure storage and are read back to verify them. The original copy is kept. Browser profiles and old session permissions are not imported."
          : "导入受支持的本地服务配置与语言设置。密钥只通过安全存储迁移，并在写入后读回核验，原副本会保留。不会导入浏览器资料库或旧会话权限。"}
      </p>
      <div className="action-row">
        <Button disabled={busy} onClick={() => void run("status")}>
          {en ? "Find earlier settings" : "查找旧设置"}
        </Button>
        <Button disabled={busy} onClick={() => void run("migrate")}>
          {en ? "Import earlier settings" : "导入旧设置"}
        </Button>
      </div>
      {source ? (
        <p className="break-path">
          {en ? "Supported source" : "支持的来源"}：{source}
        </p>
      ) : null}
      <p>
        {en
          ? "For appearance and recent locations, paste an exported settings document below. If old browser preferences are unavailable, set appearance again from the application menu."
          : "外观与最近位置可以通过下方导出的设置文本导入。无法取得旧浏览器偏好时，可以在应用菜单中重新设置外观。"}
      </p>
      <label>
        {en ? "Exported settings" : "导出的设置"}
        <textarea
          rows={6}
          value={text}
          maxLength={65536}
          onChange={(e) => {
            setText(e.target.value);
          }}
          spellCheck={false}
        />
      </label>
      <div className="action-row">
        <Button disabled={busy} onClick={() => void run("export")}>
          {en ? "Show settings to copy" : "显示可复制的设置"}
        </Button>
        <Button
          disabled={busy || !text.trim()}
          onClick={() => void run("import")}
        >
          {en ? "Import this settings text" : "导入此设置文本"}
        </Button>
      </div>
      {busy ? (
        <p role="status">
          {en ? "Checking local settings…" : "正在检查本地设置…"}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
