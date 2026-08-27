import type { ReactNode } from "react";

interface WorkspaceHeaderProps {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly status?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function WorkspaceHeader({ id, eyebrow, title, description, status, actions, className = "" }: WorkspaceHeaderProps) {
  return (
    <header className={`workspace-section-header workspace-header ${className}`.trim()}>
      <div className="workspace-header__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id={id}>{title}</h1>
        {description ? <p className="workspace-header__description">{description}</p> : null}
      </div>
      {status || actions ? <div className="workspace-header__actions">{status}{actions}</div> : null}
    </header>
  );
}
