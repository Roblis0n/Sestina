import { useRef, useState, type SyntheticEvent } from "react";
import type { AppLanguage, ProjectOpenResultDto, SelectedDirectoryPreviewDto } from "../api/dto.js";
import { ResearchRoomApiError } from "../api/client.js";
import { Button } from "../components/primitives/Button.js";
import { Modal } from "../components/primitives/Modal.js";
import { localizedError, t } from "../i18n/copy.js";

interface PendingInitialization {
  readonly source: "native" | "manual";
  readonly title: string;
  readonly creates: readonly string[];
  readonly confirmationNonce?: string;
  readonly projectPath?: string;
}

interface StartCenterProps {
  readonly language: AppLanguage;
  readonly directoryPickerAvailable: boolean;
  readonly busy: boolean;
  readonly onPreviewNative: () => Promise<SelectedDirectoryPreviewDto>;
  readonly onOpenManual: (path: string, initializeIfNeeded: boolean) => Promise<ProjectOpenResultDto>;
  readonly onInitializeNative: (nonce: string) => Promise<ProjectOpenResultDto>;
  readonly onOpened: (opened: ProjectOpenResultDto) => void;
  readonly onNotice: (message: string, tone?: "ready" | "warning" | "danger") => void;
}

const CREATES = [".sestina/state.sqlite", ".sestina/research-brief.yaml", ".sestina/gitignore-suggestion.txt"] as const;

export function StartCenter({ language, directoryPickerAvailable, busy, onPreviewNative, onOpenManual, onInitializeNative, onOpened, onNotice }: StartCenterProps) {
  const [pending, setPending] = useState<PendingInitialization>();
  const [path, setPath] = useState("");
  const chooseButtonRef = useRef<HTMLButtonElement>(null);

  async function chooseFolder() {
    try {
      const preview = await onPreviewNative();
      if (!preview.selected) {
        onNotice(t(language, "initialization_cancelled"), "ready");
        return;
      }
      if (preview.initializationRequired) {
        setPending({ source: "native", title: preview.projectTitle, creates: preview.creates, confirmationNonce: preview.confirmationNonce });
        return;
      }
      onOpened(preview);
    } catch (error) {
      onNotice(localizedError(language, error), "danger");
    }
  }

  async function submitManual(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanPath = path.trim();
    if (!cleanPath) return;
    try {
      onOpened(await onOpenManual(cleanPath, false));
    } catch (error) {
      if (error instanceof ResearchRoomApiError && error.code === "initialization_confirmation_required") {
        const pieces = cleanPath.replace(/[\\/]+$/u, "").split(/[\\/]/u);
        setPending({ source: "manual", title: pieces.at(-1) ?? cleanPath, creates: CREATES, projectPath: cleanPath });
        return;
      }
      onNotice(localizedError(language, error), "danger");
    }
  }

  async function confirmInitialization() {
    if (!pending) return;
    try {
      const opened = pending.source === "native"
        ? await onInitializeNative(pending.confirmationNonce ?? "")
        : await onOpenManual(pending.projectPath ?? "", true);
      setPending(undefined);
      setPath("");
      onOpened(opened);
    } catch (error) {
      setPending(undefined);
      onNotice(localizedError(language, error), "danger");
    }
  }

  return (
    <main className="start-center" id="start-center">
      <section className="start-center__intro">
        <p className="eyebrow">{t(language, "start_eyebrow")}</p>
        <h1>{t(language, "start_title")}</h1>
        <p>{t(language, "start_deck")}</p>
        <div className="boundary-list" aria-label="Local project boundaries">
          <span>✓ {t(language, "local_only")}</span>
          <span>× {language === "en" ? "No disk scan" : "不扫描磁盘"}</span>
          <span>× {language === "en" ? "No path history" : "不保存路径历史"}</span>
        </div>
      </section>
      <section className="start-center__actions" aria-label={t(language, "start_title")}>
        <div className="primary-entry">
          <p className="section-index">01 / SYSTEM PICKER</p>
          <Button ref={chooseButtonRef} type="button" variant="primary" disabled={busy || !directoryPickerAvailable} onClick={() => void chooseFolder()}>
            <strong>{t(language, "choose_folder")}</strong>
            <small>{t(language, "choose_folder_hint")}</small>
          </Button>
          {!directoryPickerAvailable ? <p className="inline-warning">{language === "en" ? "System picker unavailable. Use the manual path below." : "系统选择器不可用，请使用下方手动路径。"}</p> : null}
          <p className="muted">{t(language, "zero_write")}</p>
        </div>
        <details className="manual-entry">
          <summary>{t(language, "manual_path")}</summary>
          <form onSubmit={(event) => void submitManual(event)}>
            <label htmlFor="project-path">{t(language, "project_path")}</label>
            <input id="project-path" value={path} onChange={(event) => { setPath(event.target.value); }} required autoComplete="off" spellCheck={false} />
            <Button type="submit" variant="secondary" disabled={busy}>{t(language, "inspect_path")}</Button>
          </form>
        </details>
      </section>
      <Modal
        open={pending !== undefined}
        title={t(language, "initialization_title")}
        description={t(language, "initialization_deck")}
        closeLabel={t(language, "close")}
        onClose={() => { setPending(undefined); }}
        returnFocusRef={chooseButtonRef}
      >
        <div className="initialization-preview">
          <dl><dt>{t(language, "selected_project")}</dt><dd>{pending?.title}</dd></dl>
          <h3>{t(language, "creates")}</h3>
          <ul>{pending?.creates.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
          <p className="boundary-note">{language === "en" ? "No project research file will be read or overwritten." : "不会读取或覆盖项目研究文件。"}</p>
          <div className="button-row">
            <Button type="button" variant="primary" disabled={busy} onClick={() => void confirmInitialization()}>{t(language, "initialize")}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { setPending(undefined); }}>{t(language, "cancel")}</Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
