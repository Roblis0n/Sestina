import { _electron } from "@playwright/test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  cp,
  readdir,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { RandomIdFactory } from "@sestina/core";
import legacyStates from "../post-0.2/legacy-states-provenance.json" with { type: "json" };

const executablePath = process.env.SESTINA_TEST_INSTALLED_EXECUTABLE;
const development = process.env.SESTINA_TEST_ALLOW_DEVELOPMENT === "1";
if (!executablePath && !development)
  throw Error("installed_executable_required");
const output = resolve(
  process.env.SESTINA_TARGET_OUTPUT ?? ".tmp/target/journeys",
);
await mkdir(output, { recursive: true });
const area = await mkdtemp(join(tmpdir(), "sestina-installed-journeys-"));
const projectPath = join(area, "中文 research"),
  profile = join(area, "profile");
await mkdir(projectPath);
const cases: string[] = [],
  requests: string[] = [];
const nativeAnswers: { message: string; detail: string }[] = [];
let mode = "valid";
const handler: import("node:http").RequestListener = async (req, res) => {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(Buffer.from(part));
  const body = Buffer.concat(parts).toString();
  requests.push(body);
  if (mode === "timeout" || mode === "cancel") return;
  if (mode === "disconnect") {
    req.socket.destroy();
    return;
  }
  if (mode === "redirect") {
    res.writeHead(302, { location: "/must-not-follow" });
    res.end();
    return;
  }
  if (mode === "oversize") {
    res.end("x".repeat(1_048_577));
    return;
  }
  if (mode === "invalid") {
    res.end("invalid JSON");
    return;
  }
  const binding = JSON.parse(
    JSON.parse(body).messages[1].content,
  ).requestBinding;
  if (mode === "wrong-identity") binding.projectId = "synthetic-wrong-project";
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              schemaVersion: "2.0.0",
              requestBinding: binding,
              publicSummary: "Synthetic installed opinion",
              quotedSpans: [],
            }),
          },
        },
      ],
    }),
  );
};
const server = createServer(handler);
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string") throw Error("fixture_address");
const endpoint = `http://127.0.0.1:${address.port}`;
await writeFile(
  join(area, "openssl.cnf"),
  "[req]\ndistinguished_name=dn\n[dn]\n",
);
for (const name of ["trusted", "untrusted"]) {
  execFileSync(
    process.env.SESTINA_TEST_OPENSSL ?? "openssl",
    [
      "req",
      "-config",
      join(area, "openssl.cnf"),
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(area, `${name}-key.pem`),
      "-out",
      join(area, `${name}-cert.pem`),
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-days",
      "1",
    ],
    { windowsHide: true, stdio: "pipe" },
  );
}
const tlsServers = await Promise.all(
  ["trusted", "untrusted"].map(async (name) => {
    const server = createTlsServer(
      {
        key: await readFile(join(area, `${name}-key.pem`)),
        cert: await readFile(join(area, `${name}-cert.pem`)),
      },
      handler,
    );
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("fixture_tls_address");
    return {
      server,
      port: address.port,
      endpoint: `https://127.0.0.1:${address.port}`,
    };
  }),
);
const env = { ...process.env };
env.NODE_EXTRA_CA_CERTS = join(area, "trusted-cert.pem");
delete env.ELECTRON_RUN_AS_NODE;
let electron: Awaited<ReturnType<typeof _electron.launch>>;
let page: Awaited<ReturnType<typeof electron.firstWindow>>;
let session: any;
const invoke = async (name: string, input: object = {}) => {
  const reply = await page.evaluate(
    ({ name, input }) => (window as any).sestinaDesktop.methods[name](input),
    { name, input },
  );
  if (!reply.ok) throw Error(`${name}: ${JSON.stringify(reply.error)}`);
  return reply.value;
};
const rawCommand = (action: string, body: object = {}) =>
  page.evaluate(
    (input) => (window as any).sestinaDesktop.commands[input.action](input),
    {
      action,
      projectId: session.projectId,
      sessionGeneration: session.sessionGeneration,
      ...body,
    },
  );
const command = async (action: string, body: object = {}) => {
  const result = await rawCommand(action, body);
  if (!result.ok) throw Error(`${action}: ${JSON.stringify(result.error)}`);
  return result.value;
};
const launch = async () => {
  electron = await _electron.launch({
    executablePath:
      executablePath ??
      createRequire(resolve("apps/desktop/package.json"))("electron"),
    args: [
      ...(executablePath ? [] : [resolve("apps/desktop")]),
      `--user-data-dir=${profile}`,
      `--log-net-log=${join(output, `chromium-network-${cases.length}.json`)}`,
    ],
    env,
  });
  page = await electron.firstWindow();
  await page.waitForFunction(() => Boolean((window as any).sestinaDesktop));
  assert.equal(
    await electron.evaluate(({ app }) => app.isPackaged),
    !development,
  );
  // Observe real Node sockets without substituting transport, Provider or Kernel.
  await electron.evaluate(async () => {
    const dc = (process as any).mainModule.require("node:diagnostics_channel");
    (globalThis as any).__sestinaSockets = [];
    dc.channel("net.client.socket").subscribe((event: any) => {
      event.socket.once("connect", () =>
        (globalThis as any).__sestinaSockets.push({
          address: event.socket.remoteAddress,
          port: event.socket.remotePort,
        }),
      );
    });
  });
  // Native answers are isolated application-logic fixtures, NEVER native acceptance.
  await electron.evaluate(({ dialog }) => {
    (globalThis as any).__sestinaConfirmations = [];
    dialog.showMessageBox = async (_window: any, options: any) => {
      (globalThis as any).__sestinaConfirmations.push(options ?? _window);
      return { response: 1, checkboxChecked: false };
    };
  });
};
const select = async (path: string) => {
  await electron.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, path);
  await invoke("pickDirectory");
};
const collect = async () => {
  nativeAnswers.push(
    ...(await electron.evaluate(
      () => (globalThis as any).__sestinaConfirmations,
    )),
  );
  const sockets = await electron.evaluate(
    () => (globalThis as any).__sestinaSockets,
  );
  assert.ok(
    sockets.every(
      (socket: any) =>
        socket.address === "127.0.0.1" &&
        [address.port, ...tlsServers.map((server) => server.port)].includes(
          socket.port,
        ),
    ),
    JSON.stringify(sockets),
  );
  return sockets;
};
const restart = async () => {
  await collect();
  await electron.close();
  await launch();
  await select(projectPath);
  session = await invoke("open", { projectPath });
};
const commit = async (suggestion: string, payload: object, existing?: any) => {
  let review = existing ?? (await command("create", { suggestion }));
  review = await command("skip_assessment", {
    reviewId: review.id,
    expectedVersion: review.version,
  });
  const prepared = await command("prepare_effect", {
    reviewId: review.id,
    expectedVersion: review.version,
    payload,
  });
  const request = {
    reviewId: review.id,
    expectedVersion: prepared.version,
    previewHash: prepared.effectDraft.previewHash,
    authorityCommandId: prepared.effectDraft.authorityCommandId,
  };
  const result = await command("commit", request);
  const { briefPublication: _publication, ...receipt } = result;
  assert.deepEqual(
    await command("lookup", { authorityCommandId: request.authorityCommandId }),
    receipt,
  );
  return { reviewId: review.id, result };
};
const record = {
  kind: "record_only",
  outcome: "reference_only",
  reason: "Explicit synthetic user record",
};
let identity: any;
try {
  await launch();
  identity = development
    ? { sourceCommit: null, scope: "development_not_installed_acceptance" }
    : await electron.evaluate(async ({ app }) =>
        JSON.parse(
          await (process as any).mainModule
            .require("node:fs/promises")
            .readFile(`${app.getAppPath()}/dist/identity.json`, "utf8"),
        ),
      );
  await select(projectPath);
  session = await invoke("createProject", {
    projectPath,
    title: "Installed final research / 合成",
  });
  await invoke("language", { language: "en" });
  const fields = {
    projectQuestion: "",
    currentTask: "Bound a synthetic observation",
    currentStage: "",
    targetArtifacts: [],
    fixedDecisions: [],
    allowedChanges: [],
    forbiddenChanges: [],
    expectedDeltas: [],
    evidenceBoundaries: [],
    explicitNonGoals: [],
  };
  await commit("Initialize an explicit user Brief", {
    kind: "patch_brief",
    mode: "initialize",
    fields: {
      ...fields,
      progressive: {
        schemaVersion: "2.0.0",
        sections: Object.fromEntries(
          [
            ...Object.keys(fields),
            "knownUnknowns",
            "acceptedDecisions",
            "evidenceThresholds",
          ].map((key) => [
            key,
            { status: key === "currentTask" ? "provided" : "not_provided" },
          ]),
        ),
        knownUnknowns: [],
        acceptedDecisions: [],
        evidenceThresholds: [],
      },
    },
    reason: "User task",
  });
  assert.ok((await command("brief")).brief);
  cases.push("first-project-brief-language");
  const saved = await commit("No Provider is required", record);
  await restart();
  assert.ok(
    (await command("read", { reviewId: saved.reviewId })).review
      .terminalOutcome,
  );
  assert.equal(requests.length, 0);
  for (const view of ["today", "project", "search"])
    assert.ok(await command("workspace", { query: { view, limit: 50 } }));
  assert.equal((await collect()).length, 0);
  cases.push("offline-decision-restart-views");

  const config = {
    providerId: "synthetic-installed",
    baseUrl: endpoint,
    model: "synthetic",
    timeoutMs: 400,
  };
  // Synthetic transport credential setup, not native credential-entry evidence.
  // Keep it outside the renderer and encrypt it with this actual Electron OS backend.
  await electron.evaluate(async ({ app, safeStorage }) => {
    if (!safeStorage.isEncryptionAvailable())
      throw Error("fixture_secure_storage_required");
    const require = (process as any).mainModule.require;
    const fs = require("node:fs/promises"),
      path = require("node:path"),
      crypto = require("node:crypto");
    const directory = path.join(app.getPath("userData"), "credentials");
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(
      directory,
      crypto
        .createHash("sha256")
        .update("sestina.provider.api-key")
        .digest("hex") + ".enc",
    );
    const encrypted = safeStorage.encryptString("synthetic-local-tls-fixture");
    await fs.writeFile(file, encrypted, { flag: "wx" });
    if (
      safeStorage.decryptString(await fs.readFile(file)) !==
      "synthetic-local-tls-fixture"
    )
      throw Error("fixture_credential_roundtrip_failed");
  });
  await invoke("providerSave", { input: config });
  for (const scenario of [
    "valid",
    "invalid",
    "wrong-identity",
    "oversize",
    "timeout",
    "disconnect",
    "redirect",
    "cancel",
    "tls-valid",
    "tls-untrusted",
  ]) {
    mode = scenario;
    await invoke("providerSave", {
      input: {
        ...config,
        baseUrl:
          scenario === "tls-valid"
            ? tlsServers[0]!.endpoint
            : scenario === "tls-untrusted"
              ? tlsServers[1]!.endpoint
              : endpoint,
      },
    });
    const before = requests.length;
    let review = await command("create", {
      suggestion: `Installed ${scenario} 中文`,
    });
    const prepared = await command("prepare_manifest", {
      reviewId: review.id,
      expectedVersion: review.version,
      selection: {},
      useProvider: true,
    });
    review = await command("confirm_manifest", {
      reviewId: review.id,
      expectedVersion: prepared.review.version,
      manifestIdentityHash: prepared.manifest.identityHash,
      confirmed: true,
    });
    review = await command("prepare_attempt", {
      reviewId: review.id,
      expectedVersion: review.version,
    });
    const send = rawCommand("start_attempt", {
      reviewId: review.id,
      expectedVersion: review.version,
      manifestIdentityHash: prepared.manifest.identityHash,
    });
    if (scenario === "cancel") {
      await page.waitForTimeout(100);
      const current = await command("read", { reviewId: review.id });
      await rawCommand("cancel_attempt", {
        reviewId: review.id,
        expectedVersion: current.review.version,
      });
    }
    await send;
    const expectedRequests = before + (scenario === "tls-untrusted" ? 0 : 1);
    assert.equal(requests.length, expectedRequests, scenario);
    if (scenario !== "tls-untrusted")
      assert.equal(requests.at(-1), prepared.manifest.exactRequestBody);
    const read = await command("read", { reviewId: review.id });
    assert.equal(
      read.attempts[0].status === "completed",
      ["valid", "tls-valid", "wrong-identity"].includes(scenario),
      `${scenario}: ${JSON.stringify(read.attempts)}`,
    );
    if (read.attempts[0].status === "completed")
      assert.equal(
        read.attempts[0].assessment.requestBound,
        ["valid", "tls-valid"].includes(scenario),
      );
    assert.equal(read.review.terminalOutcome, null);
    await restart();
    assert.equal(requests.length, expectedRequests);
    const recovered = await command("read", { reviewId: review.id });
    assert.equal(recovered.attempts[0].status, read.attempts[0].status);
    await commit(
      `Continue locally after ${scenario}`,
      record,
      recovered.review,
    );
    cases.push(`provider-${scenario}-exact-body-no-retry`);
  }
  mode = "valid";
  await invoke("providerSave", { input: config });
  await invoke("providerSave", {
    second: true,
    input: {
      ...config,
      providerId: "synthetic-independent",
      model: "independent-model",
    },
  });
  const assessed = async (draft: any) => {
    const prepared = await command("prepare_manifest", {
      reviewId: draft.id,
      expectedVersion: draft.version,
      selection: {},
      useProvider: true,
    });
    let current = await command("confirm_manifest", {
      reviewId: draft.id,
      expectedVersion: prepared.review.version,
      manifestIdentityHash: prepared.manifest.identityHash,
      confirmed: true,
    });
    current = await command("prepare_attempt", {
      reviewId: draft.id,
      expectedVersion: current.version,
    });
    await command("start_attempt", {
      reviewId: draft.id,
      expectedVersion: current.version,
      manifestIdentityHash: prepared.manifest.identityHash,
    });
    assert.equal(requests.at(-1), prepared.manifest.exactRequestBody);
    return command("read", { reviewId: draft.id });
  };
  const original = await assessed(
    await command("create", {
      suggestion: "Inspect an observation before accepting it",
    }),
  );
  const originalAttempt = original.attempts[0];
  const correction = await command("append_correction", {
    reviewId: original.review.id,
    expectedVersion: original.review.version,
    attemptId: originalAttempt.id,
    originalAssessmentHash: originalAttempt.assessmentHash,
    reason: "Preserve original while requesting independent inspection",
  });
  const independent = await assessed(correction.review);
  assert.equal(JSON.parse(requests.at(-1)!).model, "independent-model");
  await commit(
    "Explicit result after independent inspection",
    record,
    independent.review,
  );
  await restart();
  assert.deepEqual(
    (await command("read", { reviewId: original.review.id })).attempts[0],
    originalAttempt,
  );
  assert.equal(
    (await command("correction_history", { reviewId: original.review.id }))[0]
      .status,
    "closed",
  );
  cases.push("correction-independent-inspection-original-preserved");
  let stale = await command("create", {
    suggestion: "Configuration reconfirmation",
  });
  const manifest = await command("prepare_manifest", {
    reviewId: stale.id,
    expectedVersion: stale.version,
    selection: {},
    useProvider: true,
  });
  await invoke("providerSave", { input: { ...config, model: "changed" } });
  assert.equal(
    (
      await rawCommand("confirm_manifest", {
        reviewId: stale.id,
        expectedVersion: manifest.review.version,
        manifestIdentityHash: manifest.manifest.identityHash,
        confirmed: true,
      })
    ).ok,
    false,
  );
  cases.push("configuration-change-reconfirmation");

  const ids = new RandomIdFactory();
  const govern = async (input: object) =>
    command("govern_memory", {
      commandId: ids.create("rpev_"),
      expectedRevision: (await command("memory")).projectStateRevision,
      input,
    });
  await govern({
    action: "create",
    kind: "working_hint",
    content: { text: "SYNTHETIC_INSTALLED_FORGET" },
    retention: { policy: "until_unpinned" },
    sensitivity: "public",
    outboundPolicy: "explicit_manifest_only",
    publicReason: "Synthetic user context",
  });
  let memory = (await command("memory")).items[0].item;
  await govern({
    action: "confirm",
    itemId: memory.id,
    expectedVersion: memory.version,
    publicReason: "Use this context",
  });
  memory = (await command("memory")).items[0].item;
  assert.ok(
    (await command("recall_memory", { trigger: "add_context", objectIds: [] }))
      .length,
  );
  const sharing = await command("create", {
    suggestion: "Explicitly selected memory",
  });
  const shared = await command("prepare_manifest", {
    reviewId: sharing.id,
    expectedVersion: sharing.version,
    selection: {
      memory: [
        {
          id: memory.id,
          version: memory.version,
          contentHash: memory.contentHash,
        },
      ],
    },
    useProvider: true,
  });
  assert.ok(
    shared.manifest.exactRequestBody.includes("SYNTHETIC_INSTALLED_FORGET"),
  );
  await invoke("closeProject");
  const maintenance = async (action: string, body: object = {}) =>
    invoke("maintenance", {
      projectPath,
      sessionGeneration: (await invoke("kernelStatus")).sessionGeneration,
      action,
      ...body,
    });
  const backup = await maintenance("backup");
  session = await invoke("open", { projectPath });
  const afterBackup = await commit("Modification after backup", record);
  await invoke("closeProject");
  const preview = await maintenance("backup_restore_preview", {
    backupId: backup.backupId,
  });
  assert.ok(preview);
  await maintenance("backup_restore", {
    backupId: backup.backupId,
    confirmationNonce: preview.confirmationNonce,
    expectedStateBinding: preview.stateBinding,
  });
  session = await invoke("open", { projectPath });
  assert.equal(
    (await rawCommand("read", { reviewId: afterBackup.reviewId })).ok,
    false,
  );
  assert.ok(
    (await command("read", { reviewId: saved.reviewId })).review
      .terminalOutcome,
  );
  await govern({
    action: "forget",
    itemId: memory.id,
    expectedVersion: memory.version,
    publicReason: "user_requested_irreversible_forget",
    confirmation: "FORGET",
  });
  const forgotten = await command("memory");
  assert.ok(!JSON.stringify(forgotten).includes("SYNTHETIC_INSTALLED_FORGET"));
  await invoke("closeProject");
  await assert.rejects(() =>
    maintenance("backup_restore_preview", { backupId: backup.backupId }),
  );
  cases.push("memory-confirm-recall-share-forget-backup-protection");

  const corpus = join(output, "frozen-corpus");
  execFileSync(
    process.execPath,
    [resolve("scripts/materialize-post-0.2-states.mjs"), corpus],
    { windowsHide: true, stdio: "pipe" },
  );
  const entry = legacyStates.fixtures.find((item) =>
    item.key.startsWith("deliberation"),
  )!;
  const legacyRoot = join(area, "legacy-room");
  const source = join(corpus, "states", entry.key, ".sestina");
  assert.equal(
    createHash("sha256")
      .update(await readFile(join(source, "state.sqlite")))
      .digest("hex"),
    entry.databaseSha256,
  );
  await cp(source, join(legacyRoot, ".sestina"), { recursive: true });
  await select(legacyRoot);
  const closed = await invoke("kernelStatus");
  const old = await invoke("maintenance", {
    action: "preview",
    projectPath: legacyRoot,
    sessionGeneration: closed.sessionGeneration,
  });
  assert.ok(old);
  await invoke("maintenance", {
    action: "migrate",
    projectPath: legacyRoot,
    sessionGeneration: closed.sessionGeneration,
    previewHash: old.previewHash,
  });
  session = await invoke("open", { projectPath: legacyRoot });
  const history = await command("legacy_history", {
    sourceKind: "deliberation_rooms",
    limit: 50,
  });
  assert.ok(history.items.length > 0);
  const item = history.items[0];
  const detail = await command("legacy_detail", {
    sourceKind: "deliberation_rooms",
    sourceId: entry.objectId,
  });
  assert.ok(detail);
  await writeFile(
    join(output, "synthetic-history-export.json"),
    JSON.stringify(detail, null, 2),
  );
  const draft = await command("convert_legacy", {
    sourceKind: "deliberation_rooms",
    sourceId: entry.objectId,
    suggestion: "Explicit conversion from history",
  });
  assert.equal(draft.terminalOutcome, null);
  cases.push("installed-migration-history-export-draft");
  await collect();
  await electron.close();
  const rendererConnections: unknown[] = [];
  for (const file of (await readdir(output)).filter((name) =>
    /^chromium-network-.*\.json$/.test(name),
  )) {
    const log = JSON.parse(await readFile(join(output, file), "utf8"));
    for (const event of log.events ?? []) {
      if (
        event.type === log.constants?.logEventTypes?.TCP_CONNECT ||
        event.type === log.constants?.logEventTypes?.UDP_CONNECT
      )
        rendererConnections.push(event);
    }
  }
  assert.equal(
    rendererConnections.length,
    0,
    "Renderer/browser must not initiate research network connections",
  );
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        packaged: !development,
        identity,
        platform: process.platform,
        arch: process.arch,
        cases,
        requests: requests.length,
        exactBodies: requests,
        nativeConfirmationCount: nativeAnswers.length,
        nativeObservation: "not_established_dialog_answers_are_fixtures",
        tlsCredentialSetup:
          "synthetic_OS_encrypted_fixture_not_native_entry_acceptance",
        chromiumLogs: "chromium-network-*.json",
        rendererConnections,
        mainSockets:
          "observed after bridge readiness through diagnostics_channel; startup Node activity not covered",
        projectPath,
        profile,
        legacyRoot,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, cases: cases.length, output }));
} catch (error) {
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: false,
        identity,
        cases,
        error: String(error),
        projectPath,
        profile,
      },
      null,
      2,
    ),
  );
  await electron?.close().catch(() => undefined);
  throw error;
} finally {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  for (const { server } of tlsServers) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}
