import { useEffect, useState, type RefObject, type SyntheticEvent } from "react";
import type { AppLanguage, MotionPreference, ThemePreference } from "../../api/dto.js";
import type { AppearancePreferences } from "../../preferences/appearance.js";
import { Button } from "../primitives/Button.js";
import { Modal } from "../primitives/Modal.js";
import { t } from "../../i18n/copy.js";

interface AppearanceDialogProps {
  readonly open: boolean;
  readonly language: AppLanguage;
  readonly preferences: AppearancePreferences;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onApply: (preferences: AppearancePreferences) => void;
}

export function AppearanceDialog({ open, language, preferences, returnFocusRef, onClose, onApply }: AppearanceDialogProps) {
  const [theme, setTheme] = useState<ThemePreference>(preferences.theme);
  const [motion, setMotion] = useState<MotionPreference>(preferences.reducedMotion);
  const [transparency, setTransparency] = useState(preferences.reducedTransparency);
  useEffect(() => { if (open) { setTheme(preferences.theme); setMotion(preferences.reducedMotion); setTransparency(preferences.reducedTransparency); } }, [open, preferences]);
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply({ version: 1, theme, reducedMotion: motion, reducedTransparency: transparency });
    onClose();
  }
  return (
    <Modal open={open} title={t(language, "appearance_heading")} closeLabel={t(language, "close")} onClose={onClose} returnFocusRef={returnFocusRef}>
      <form className="appearance-form" onSubmit={submit}>
        <fieldset><legend>{t(language, "theme")}</legend>
          {(["system", "light", "dark", "high_contrast"] as const).map((value) => <label key={value}><input type="radio" name="theme" value={value} checked={theme === value} onChange={() => { setTheme(value); }} />{t(language, value === "system" ? "theme_system" : value === "light" ? "theme_light" : value === "dark" ? "theme_dark" : "theme_high_contrast")}</label>)}
        </fieldset>
        <fieldset><legend>{t(language, "reduced_motion")}</legend>
          {(["system", "on", "off"] as const).map((value) => <label key={value}><input type="radio" name="motion" value={value} checked={motion === value} onChange={() => { setMotion(value); }} />{t(language, value === "system" ? "motion_system" : value === "on" ? "motion_on" : "motion_off")}</label>)}
        </fieldset>
        <label className="check-row"><input type="checkbox" checked={transparency} onChange={(event) => { setTransparency(event.target.checked); }} />{t(language, "reduced_transparency")}</label>
        <Button type="submit" variant="primary">{t(language, "save_appearance")}</Button>
      </form>
    </Modal>
  );
}
