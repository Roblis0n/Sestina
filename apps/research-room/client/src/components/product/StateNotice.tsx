import type { AriaRole, ReactNode } from "react";
import { StatusBadge } from "../primitives/StatusBadge.js";

interface StateNoticeProps {
  readonly ariaLabel: string;
  readonly eyebrow?: string;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly status?: ReactNode;
  readonly tone?: "neutral" | "ready" | "working" | "warning" | "danger";
  readonly role?: AriaRole;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function StateNotice({ ariaLabel, eyebrow, title, description, status, tone = "neutral", role = "region", actions, className = "" }: StateNoticeProps) {
  return (
    <section className={`state-notice ${className}`.trim()} data-tone={tone} role={role} aria-label={ariaLabel}>
      <div className="state-notice__body">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <div className="state-notice__heading">
          <h2>{title}</h2>
          {status ? <StatusBadge tone={tone}>{status}</StatusBadge> : null}
        </div>
        <p>{description}</p>
      </div>
      {actions ? <div className="state-notice__actions">{actions}</div> : null}
    </section>
  );
}
