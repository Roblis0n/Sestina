import type { ReactNode } from "react";

interface StatusBadgeProps {
  readonly tone?: "neutral" | "ready" | "working" | "warning" | "danger";
  readonly children: ReactNode;
}
export function StatusBadge({ tone = "neutral", children }: StatusBadgeProps) {
  const icon = tone === "ready" ? "✓" : tone === "working" ? "↻" : tone === "warning" ? "!" : tone === "danger" ? "×" : "•";
  return <span className="status-badge" data-tone={tone}><span aria-hidden="true">{icon}</span>{children}</span>;
}
