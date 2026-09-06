import { beforeAll, afterAll, it, expect, vi } from "vitest";
import net from "node:net";
import { createServer } from "node:http";
import { migrateKernelProject, previewKernelMigration, openKernelProject, restoreKernelPreMigrationBackup } from "@sestina/core";
import { createResearchUnitOfWork, readKernelSnapshot, projectKernelContext, rebuildKernelProjection } from "@sestina/research-store";
import { oldCorpus } from "../legacy-fixtures.js";
import { capability, prepare, decision } from "../kernel-fixtures.js";
import { value } from "../factory.js";
let corpus: Awaited<ReturnType<typeof oldCorpus>>;
beforeAll(async () => { corpus = await oldCorpus(); }); afterAll(async () => { await corpus?.cleanup(); });
it("G1/G2/G3: migration, no-assessment commit, context, projection and downgrade use zero sockets", async () => {
 const p = await corpus.project(20); const attempts: string[] = [];
 const deny = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function () { attempts.push("socket"); throw Error("network_forbidden_by_test"); });
 try {
  await previewKernelMigration(p.root); await migrateKernelProject({ projectRoot: p.root }); const db = await openKernelProject(p.root);
  try { const uow = createResearchUnitOfWork(db, { authorize: c => c.authorityCapability === capability }).kernel!; const object = decision(db, p.entry.projectId), review = prepare(uow, p.entry.projectId, "create_decision", [{ kind: "decision", id: object.id, version: 0 }]); value(uow.commitCanonical(review.command, r => { value(r.decisions.create(object)); })); const context = projectKernelContext(readKernelSnapshot(db, p.entry.projectId), "Synthetic local suggestion."); expect(context.projection.projectStateRevision).toBe(2); value(rebuildKernelProjection(db, p.entry.projectId, "search", s => ({ revision: s.head.revision }))); } finally { db.close(); }
  await restoreKernelPreMigrationBackup(p.root); expect((await previewKernelMigration(p.root)).sourceSchema).toBe(20); expect(attempts).toEqual([]);
 } finally { deny.mockRestore(); await p.cleanup(); }
});

/** Controlled TCP fixture: only loopback, exact body capture, no real Provider. */
export async function controlledSocket(mode: "reset_after_body" | "timeout_after_body" | "redirect" | "oversize" | "invalid_json") {
 const bodies: Buffer[] = []; const sockets = new Set<net.Socket>();
 const server = createServer(async (request, response) => { const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part)); bodies.push(Buffer.concat(parts)); if (mode === "reset_after_body") request.socket.destroy(); else if (mode === "timeout_after_body") { /* Deliberately leave the captured request unanswered until client cancellation. */ } else if (mode === "redirect") { response.writeHead(302, { location: "/must-not-follow" }); response.end(); } else if (mode === "oversize") response.end("x".repeat(65537)); else response.end("{invalid-json"); });
 server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
 await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw Error("no loopback address");
 return { url: `http://127.0.0.1:${address.port}`, bodies, async close() { sockets.forEach(s => s.destroy()); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); } };
}
it.each(["reset_after_body", "timeout_after_body", "redirect", "oversize", "invalid_json"] as const)("G1: controlled %s transport captures exact socket body and never retries", async mode => {
 const fixture = await controlledSocket(mode), body = Buffer.from('{"synthetic":"e\u0301 合成"}');
 try { let failure: unknown; try { const response = await fetch(fixture.url, { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(150) }); const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > 65536) throw Error("response_too_large"); JSON.parse(Buffer.from(bytes).toString("utf8")); } catch (error) { failure = error; } expect(failure).toBeDefined(); expect(fixture.bodies).toEqual([body]); } finally { await fixture.close(); }
});
