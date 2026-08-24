import type { AppLanguage } from "../api/dto.js";
import { Button } from "../components/primitives/Button.js";
import { t } from "../i18n/copy.js";

interface LanguageScreenProps {
  readonly busy: boolean;
  readonly onChoose: (language: AppLanguage) => void;
}

export function LanguageScreen({ busy, onChoose }: LanguageScreenProps) {
  return (
    <main className="language-screen">
      <section className="language-screen__context" aria-labelledby="language-title">
        <p className="eyebrow">SESTINA / LOCAL APP</p>
        <h1 id="language-title">选择界面语言 / Choose your language</h1>
        <p>语言只决定界面的呈现方式。Language changes the interface, never your research authority.</p>
        <div className="boundary-note">
          <strong>Local App preference</strong>
          <span>No account, sync, telemetry, project content, or Provider call.</span>
        </div>
      </section>
      <section className="language-screen__choices" aria-label="Choose your language">
        <Button type="button" variant="primary" aria-label="中文" disabled={busy} onClick={() => { onChoose("zh-CN"); }}>
          <span className="language-code">ZH</span> {t("zh-CN", "chinese")}
        </Button>
        <Button type="button" variant="secondary" aria-label="English" disabled={busy} onClick={() => { onChoose("en"); }}>
          <span className="language-code">EN</span> {t("en", "english")}
        </Button>
      </section>
    </main>
  );
}
