import { useState, type SyntheticEvent } from "react";
import type { AppLanguage, ResearchRoomStateDto } from "../api/dto.js";
import { Button } from "../components/primitives/Button.js";
import { localizedError, t } from "../i18n/copy.js";

interface BriefSetupProps {
  readonly language: AppLanguage;
  readonly projectTitle: string;
  readonly busy: boolean;
  readonly onActivate: (question: string, task: string) => Promise<ResearchRoomStateDto>;
  readonly onActivated: (state: ResearchRoomStateDto) => void;
  readonly onError: (message: string) => void;
}

export function BriefSetup({ language, projectTitle, busy, onActivate, onActivated, onError }: BriefSetupProps) {
  const [question, setQuestion] = useState("");
  const [task, setTask] = useState("");
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try { onActivated(await onActivate(question, task)); }
    catch (error) { onError(localizedError(language, error)); }
  }
  return (
    <main className="brief-setup">
      <section>
        <p className="eyebrow">02 / RESEARCH BRIEF</p>
        <h1>{t(language, "setup_title")}</h1>
        <p>{t(language, "setup_deck")}</p>
        <p className="project-label"><span>{t(language, "project")}</span><strong>{projectTitle}</strong></p>
      </section>
      <form className="brief-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="initial-question">{t(language, "research_question")}</label>
        <textarea id="initial-question" maxLength={4096} required value={question} onChange={(event) => { setQuestion(event.target.value); }} />
        <label htmlFor="initial-task">{t(language, "current_task")}</label>
        <textarea id="initial-task" maxLength={4096} required value={task} onChange={(event) => { setTask(event.target.value); }} />
        <Button type="submit" variant="primary" disabled={busy}>{t(language, "activate_brief")}</Button>
      </form>
    </main>
  );
}
