import { useEffect, useState } from "react";
import { researchRoomApi } from "../api/client.js";
import { desktop } from "../api/desktop.js";
import type {
  AppLanguage,
  ProviderSaveInput,
  ProviderStatusDto,
} from "../api/dto.js";
import { AppChrome } from "../components/product/AppChrome.js";
import { localizedError } from "../i18n/copy.js";
import { LanguageScreen } from "../screens/LanguageScreen.js";
import { KernelProjectWorkspace } from "../screens/KernelProjectWorkspace.js";
import {
  applyAppearanceToDocument,
  readAppearancePreferences,
  writeAppearancePreferences,
  type AppearancePreferences,
} from "../preferences/appearance.js";

/** Desktop owns presentation and local preferences. Every research state and
 * authority transition comes from the persistent Kernel workspace. */
export function App() {
  const [phase, setPhase] = useState<"boot" | "language" | "kernel" | "fatal">(
    "boot",
  );
  const [language, setLanguage] = useState<AppLanguage>("en");
  const [provider, setProvider] = useState<ProviderStatusDto>();
  const [secondProvider, setSecondProvider] = useState<ProviderStatusDto>();
  const [busy, setBusy] = useState(0);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "ready" | "warning" | "danger";
  }>();
  const [providerOpen, setProviderOpen] = useState(false);
  const [secondOpen, setSecondOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearance, setAppearance] = useState(readAppearancePreferences);
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const en = language === "en";
  function showNotice(
    message: string,
    tone: "ready" | "warning" | "danger" = "ready",
  ) {
    setNotice({ message, tone });
  }
  async function run<T>(action: () => Promise<T>): Promise<T> {
    setBusy((value) => value + 1);
    try {
      return await action();
    } finally {
      setBusy((value) => Math.max(0, value - 1));
    }
  }
  async function enterKernel(next: AppLanguage) {
    setLanguage(next);
    const [primary, second] = await Promise.all([
      researchRoomApi.provider(),
      researchRoomApi.secondOpinionProvider(),
    ]);
    setProvider(primary);
    setSecondProvider(second);
    if (window.location.pathname === "/")
      window.history.replaceState({}, "", "/project/today");
    setPhase("kernel");
  }
  useEffect(() => {
    let active = true;
    const isActive = () => active;
    void run(async () => {
      try {
        const saved = await desktop()?.methods.preferences({ action: "read" });
        if (!isActive()) return;
        if (saved?.ok) {
          const value = saved.value as {
            appearance: AppearancePreferences;
            recentProjects: string[];
          };
          writeAppearancePreferences(value.appearance);
          applyAppearanceToDocument(value.appearance);
          setAppearance(value.appearance);
          localStorage.setItem(
            "sestina.candidate.recent-projects",
            JSON.stringify(value.recentProjects),
          );
        }
        const status = await researchRoomApi.status();
        if (!isActive()) return;
        if (status.languagePreference === null) setPhase("language");
        else await enterKernel(status.languagePreference);
      } catch (error) {
        if (isActive()) {
          setPhase("fatal");
          showNotice(localizedError("en", error), "danger");
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    const imported = (event: Event) => {
      const value = (event as CustomEvent).detail as {
        language: AppLanguage;
        appearance: AppearancePreferences;
        recentProjects: string[];
      };
      setLanguage(value.language);
      setAppearance(value.appearance);
      writeAppearancePreferences(value.appearance);
      applyAppearanceToDocument(value.appearance);
      localStorage.setItem(
        "sestina.candidate.recent-projects",
        JSON.stringify(value.recentProjects),
      );
    };
    window.addEventListener("sestina-preferences-imported", imported);
    return () => {
      window.removeEventListener("sestina-preferences-imported", imported);
    };
  }, []);
  async function changeLanguage(next: AppLanguage) {
    await run(async () => {
      try {
        await researchRoomApi.saveLanguage(next);
        if (phase === "language") {
          await researchRoomApi.status();
          await enterKernel(next);
        } else setLanguage(next);
      } catch (error) {
        showNotice(localizedError(next, error), "danger");
      }
    });
  }
  function applyAppearance(next: AppearancePreferences) {
    writeAppearancePreferences(next);
    applyAppearanceToDocument(next);
    setAppearance(next);
    void desktop()
      ?.methods.preferences({ action: "save", input: { appearance: next } })
      .then((reply) => {
        if (!reply.ok)
          showNotice(
            en
              ? "Appearance changed for this window, but could not be saved for reopening."
              : "当前窗口外观已改变，但未能保存供下次打开使用。",
            "warning",
          );
      });
  }
  async function saveProvider(input: ProviderSaveInput, second = false) {
    await run(async () => {
      const saved = await (second
        ? researchRoomApi.saveSecondOpinionProvider(input)
        : researchRoomApi.saveProvider(input));
      (second ? setSecondProvider : setProvider)(saved);
      showNotice(
        en
          ? "Provider configuration saved locally; no research data was sent."
          : "Provider 配置已保存在本机；没有发送研究数据。",
      );
    });
  }
  async function removeProvider(second: boolean, secret: boolean) {
    await run(async () => {
      const saved = await (second
        ? secret
          ? researchRoomApi.deleteSecondOpinionProviderSecret()
          : researchRoomApi.deleteSecondOpinionProviderConfig()
        : secret
          ? researchRoomApi.deleteProviderSecret()
          : researchRoomApi.deleteProviderConfig());
      (second ? setSecondProvider : setProvider)(saved);
      showNotice(
        secret
          ? en
            ? "Provider secret deleted."
            : "Provider 密钥已删除。"
          : en
            ? "Provider configuration deleted."
            : "Provider 配置已删除。",
      );
    });
  }
  return (
    <div className="app-root" aria-busy={busy > 0}>
      <a className="skip-link" href="#main-content">
        {en ? "Skip to main content" : "跳至主要内容"}
      </a>
      {phase === "kernel" ? (
        <AppChrome
          candidate
          language={language}
          provider={provider}
          secondOpinionProvider={secondProvider}
          runtime={notice?.tone === "danger" ? "degraded" : "ready"}
          busy={busy > 0}
          providerOpen={providerOpen}
          secondOpinionProviderOpen={secondOpen}
          appearanceOpen={appearanceOpen}
          recoveryOpen={false}
          recoveryAvailable={false}
          appearance={appearance}
          onLanguage={(next) => void changeLanguage(next)}
          onProviderOpen={setProviderOpen}
          onSecondOpinionProviderOpen={setSecondOpen}
          onAppearanceOpen={setAppearanceOpen}
          onRecoveryOpen={() => undefined}
          onAppearance={applyAppearance}
          onSaveProvider={(input) => saveProvider(input)}
          onSaveSecondOpinionProvider={(input) => saveProvider(input, true)}
          onDeleteProviderConfig={() => removeProvider(false, false)}
          onDeleteProviderSecret={() => removeProvider(false, true)}
          onDeleteSecondOpinionProviderConfig={() =>
            removeProvider(true, false)
          }
          onDeleteSecondOpinionProviderSecret={() => removeProvider(true, true)}
          onTestSecondOpinionProvider={() => Promise.resolve()}
          onRecoveryRestored={() => Promise.resolve()}
          onNotice={showNotice}
          onError={(message) => {
            showNotice(message, "danger");
          }}
        />
      ) : null}
      <div
        className="live-region"
        role="status"
        aria-live="polite"
        data-tone={notice?.tone ?? "ready"}
      >
        {notice ? (
          <>
            <span>{notice.message}</span>
            <button
              type="button"
              aria-label={en ? "Dismiss notification" : "关闭通知"}
              onClick={() => {
                setNotice(undefined);
              }}
            >
              ×
            </button>
          </>
        ) : null}
      </div>
      {phase === "boot" ? (
        <main id="main-content" className="boot-screen">
          <img
            className="sestina-logo sestina-logo--boot"
            src="/sestina-logo.png"
            alt="Sestina"
            width="1024"
            height="1024"
            draggable={false}
          />
          <p>
            {en ? "Starting the local Research Room…" : "正在启动本地研究室…"}
          </p>
        </main>
      ) : null}
      {phase === "language" ? (
        <LanguageScreen
          busy={busy > 0}
          onChoose={(next) => void changeLanguage(next)}
        />
      ) : null}
      {phase === "kernel" ? (
        <KernelProjectWorkspace
          key={workspaceKey}
          language={language}
          onSettings={(section) => {
            if (section === "provider") setProviderOpen(true);
            else if (section === "second_opinion") setSecondOpen(true);
            else if (section === "appearance") setAppearanceOpen(true);
          }}
          onBack={() => {
            window.history.replaceState({}, "", "/project/today");
            setWorkspaceKey((value) => value + 1);
          }}
        />
      ) : null}
      {phase === "fatal" ? (
        <main id="main-content" className="boot-screen">
          <h1>{en ? "Research Room could not open" : "研究室未能打开"}</h1>
          <button
            type="button"
            className="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            {en ? "Try opening again" : "重新打开"}
          </button>
        </main>
      ) : null}
    </div>
  );
}
