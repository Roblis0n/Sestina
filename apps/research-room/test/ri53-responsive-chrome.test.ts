import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("RI-53 responsive production chrome", () => {
  it("keeps project switching reachable and groups runtime status with the brand at compact desktop widths", async () => {
    const appRoot = join(import.meta.dirname, "..");
    const shell = await readFile(join(appRoot, "client", "src", "screens", "ProjectShell.tsx"), "utf8");
    const styles = await readFile(join(appRoot, "client", "src", "styles", "app.css"), "utf8");

    expect(shell).toContain('aria-label={t(props.language, "switch_project")}');
    expect(shell).toContain('<span aria-hidden="true">↔</span>');
    expect(styles).toContain(".project-navigation__footer .button span:last-child");

    const compactDesktop = styles.split("@media (max-width: 80rem) {")[1]?.split("@media (max-width: 64rem)")[0] ?? "";
    expect(compactDesktop).toContain(".app-chrome__status { grid-column: 1; grid-row: 2;");
    expect(compactDesktop).toContain(".app-chrome__actions { grid-column: 2; grid-row: 1 / span 2;");
    const hiddenFooter = compactDesktop
      .split("\n")
      .find((line) => line.includes(".project-navigation__footer") && line.includes("display: none") && !line.includes("span:last-child"));
    expect(hiddenFooter).toBeUndefined();
  });

  it("moves Manifest facts onto their own row before a full navigation rail can squeeze them", async () => {
    const appRoot = join(import.meta.dirname, "..");
    const styles = await readFile(join(appRoot, "client", "src", "styles", "app.css"), "utf8");
    const reviewActionLayout = styles.split("@media (max-width: 92rem) {")[1]?.split("@media (max-width: 80rem)")[0] ?? "";

    expect(reviewActionLayout).toContain(".review-current-action { grid-template-columns: minmax(0, 1fr) auto; }");
    expect(reviewActionLayout).toContain(".review-current-action dl { grid-column: 1 / -1; grid-row: 2; }");
    expect(reviewActionLayout).toContain(".review-current-action__next { grid-column: 2; grid-row: 1; }");
  });
});
