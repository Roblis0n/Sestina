import { _electron } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { strict as assert } from "node:assert";
const root = resolve(import.meta.dirname, ".."),
  dir = join(root, ".tmp/g10-g11");
const executable =
  process.env.SESTINA_TEST_INSTALLED_EXECUTABLE ??
  join(dir, "installed/Sestina Candidate.exe");
const projectPath = join(dir, "install-project"),
  profile = join(dir, "installation-profile");
await mkdir(projectPath, { recursive: true });
await mkdir(join(dir, "screenshots"), { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electron = await _electron.launch({
  executablePath: executable,
  args: [`--user-data-dir=${profile}`],
  env,
});
try {
  const page = await electron.firstWindow();
  await page.waitForFunction(() => Boolean(window.sestinaDesktop));
  const invoke = (method, input = {}) =>
    page.evaluate(
      ({ method, input }) => window.sestinaDesktop.methods[method](input),
      { method, input },
    );
  await electron.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, projectPath);
  await invoke("pickDirectory");
  const mode = process.argv[2] ?? "create";
  if (mode === "create") {
    await page.getByRole("button", { name: "选择文件夹", exact: true }).click();
    await page.getByText("在此文件夹创建项目", { exact: true }).click();
    await page
      .getByLabel("项目名称", { exact: true })
      .fill("桌面验收 / Synthetic desktop");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("button", { name: "新建审议", exact: true }).click();
    await page
      .getByLabel("新的建议", { exact: true })
      .fill(
        "合成桌面验收：保存这个观察限制。Synthetic installed research draft.",
      );
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.waitForURL(/\/reviews\/rrvw_/);
    const reviewId = new URL(page.url()).pathname.split("/").at(-1);
    const session = (await invoke("kernelStatus")).value;
    await writeFile(
      join(dir, "installation-proof.json"),
      JSON.stringify({ reviewId, projectId: session.projectId }),
    );
    await page.screenshot({
      path: join(dir, "screenshots/installed-review-zh.png"),
    });
  } else {
    const proof = JSON.parse(
      await readFile(join(dir, "installation-proof.json"), "utf8"),
    );
    const opened = await invoke("open", { projectPath });
    assert.equal(opened.ok, true);
    const result = await page.evaluate(
      (input) => window.sestinaDesktop.commands.read(input),
      {
        action: "read",
        projectId: opened.value.projectId,
        sessionGeneration: opened.value.sessionGeneration,
        reviewId: proof.reviewId,
      },
    );
    assert.equal(
      result.value.review.suggestion,
      "合成桌面验收：保存这个观察限制。Synthetic installed research draft.",
    );
    assert.equal(opened.value.projectId, proof.projectId);
  }
  const second = spawnSync(executable, [`--user-data-dir=${profile}`], {
    env,
    timeout: 10000,
    windowsHide: true,
  });
  assert.equal(second.status, 0);
  assert.equal(
    (await invoke("kernelStatus")).value.projectId,
    JSON.parse(await readFile(join(dir, "installation-proof.json"), "utf8"))
      .projectId,
  );
  await invoke("closeProject");
  console.log(
    JSON.stringify({
      passed: true,
      mode,
      installedExecutable: executable,
      doubleLaunch: true,
      originalDraftReadable: true,
    }),
  );
} finally {
  await electron.close();
}
