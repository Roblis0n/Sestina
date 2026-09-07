import { it, expect, vi } from "vitest";
import { request } from "node:http";
import { reviewEnvelopeHash } from "@sestina/research";
import { applicationFixture, session } from "../application-fixtures.js";
import { HostDraftBridge } from "../../../apps/research-room/src/host-draft-bridge.js";

it("G7: Host envelopes persist one draft, retain provenance and never grant user authority", async () => {
  const f = await applicationFixture();
  try {
    const body = {
      schemaVersion: "1.0.0" as const,
      projectId: f.kernel.projectId,
      suggestion: "Inspect a synthetic observation",
      source: {
        kind: "skill" as const,
        hostId: "synthetic-host",
        invocationId: "one",
        skillId: "agent-corrector",
        skillVersion: "1.0.0",
      },
      createdAt: "2026-09-07T00:00:00.000Z",
      fileReferences: [
        { displayName: "Unopened source", pathToken: "untrusted/path" },
      ],
    };
    const envelope = { ...body, envelopeHash: reviewEnvelopeHash(body) };
    const before = f.kernel.brief(session).projectStateRevision;
    const r = f.kernel.importReviewEnvelope(envelope, "connection-one");
    expect(r.status).toBe("draft");
    expect(r.intake).toMatchObject({
      authority: "draft_only",
      fileAccess: "not_read",
      envelope,
    });
    await f.restart();
    expect(f.kernel.importReviewEnvelope(envelope, "connection-two").id).toBe(
      r.id,
    );
    expect(f.kernel.hostDraftStatus("connection-two", "one")).toBeNull();
    expect(f.kernel.brief(session).projectStateRevision).toBe(before);
    const changed = {
      ...body,
      suggestion: "Changed proposal under the same invocation",
    };
    expect(() =>
      f.kernel.importReviewEnvelope(
        { ...changed, envelopeHash: reviewEnvelopeHash(changed) },
        "connection-one",
      ),
    ).toThrow();
    expect(() =>
      f.kernel.edit(r.id, r.version, "Host edit", { actor: "user" }),
    ).toThrow();
    expect(() =>
      f.kernel.importReviewEnvelope(
        { ...envelope, actor: "user" },
        "connection-one",
      ),
    ).toThrow();
  } finally {
    await f.cleanup();
  }
});

it("G7: bridge expiry, invalid projects, oversized bytes and revocation during upload cannot save a draft", async () => {
  const f=await applicationFixture();
  const intake=vi.fn((body:unknown,connection:string)=>f.kernel.importReviewEnvelope(body,connection));
  const bridge=new HostDraftBridge(intake,()=>null);
  try {
    const access=await bridge.enable();
    const headers={Authorization:`Bearer ${access.token}`,"Content-Type":"application/json"};
    const body={schemaVersion:"1.0.0" as const,projectId:"rprj_00000000000000000000000000",suggestion:"Wrong project must not create a draft",source:{kind:"host" as const,hostId:"fixture",invocationId:"cross-project"},createdAt:"2026-09-07T00:00:00.000Z"};
    expect((await fetch(`${access.origin}/drafts`,{method:"POST",headers,body:JSON.stringify({...body,envelopeHash:reviewEnvelopeHash(body)})})).status).toBe(400);
    expect(f.kernel.list(session,{limit:20}).items).toEqual([]);
    intake.mockClear();
    expect((await fetch(`${access.origin}/drafts`,{method:"POST",headers,body:'"'+"x".repeat(131072)+'"'})).status).toBe(400);
    expect(intake).not.toHaveBeenCalled();
    const date=vi.spyOn(Date,"now").mockReturnValue(Date.parse(access.expiresAt)+1);
    try { expect((await fetch(`${access.origin}/status?invocationId=one`,{headers})).status).toBe(401); }
    finally { date.mockRestore(); }
    const interrupted=new Promise<string>((resolve,reject)=>{
      const req=request(`${access.origin}/drafts`,{method:"POST",headers:{...headers,"Transfer-Encoding":"chunked"}},res=>{res.resume();res.on("end",()=>resolve(String(res.statusCode)));});
      req.on("error",error=>resolve((error as NodeJS.ErrnoException).code??"unknown"));
      req.on("socket",socket=>socket.on("connect",()=>{
        req.write('{"schemaVersion":',error=>{if(error)reject(error);else {bridge.close();req.end('"1.0.0"}');}});
      }));
    });
    expect(await interrupted).toBe("ECONNRESET");
    expect(intake).not.toHaveBeenCalled();
    await f.restart();
    expect(f.kernel.list(session,{limit:20}).items).toEqual([]);
    expect(f.kernel.createReview("Manual input works after Host ends",session).status).toBe("draft");
  } finally {bridge.close();vi.restoreAllMocks();await f.cleanup();}
});

it("G7: a revocable separate loopback capability exposes only submit and own status", async () => {
  const f = await applicationFixture();
  const bridge = new HostDraftBridge(
    (body, connection) => f.kernel.importReviewEnvelope(body, connection),
    (connection, invocation) =>
      f.kernel.hostDraftStatus(connection, invocation),
  );
  try {
    const access = await bridge.enable();
    const headers = {
      Authorization: `Bearer ${access.token}`,
      "Content-Type": "application/json",
    };
    expect(
      (await fetch(`${access.origin}/status?invocationId=one`)).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${access.origin}/status?invocationId=one`, {
          headers: { ...headers, Origin: "http://127.0.0.1" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${access.origin}/commit`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(404);
    const body = {
      schemaVersion: "1.0.0" as const,
      projectId: f.kernel.projectId,
      suggestion: "Synthetic bridge draft",
      source: { kind: "host" as const, hostId: "fixture", invocationId: "one" },
      createdAt: "2026-09-07T00:00:00.000Z",
    };
    const submitted = await fetch(`${access.origin}/drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, envelopeHash: reviewEnvelopeHash(body) }),
    });
    expect(submitted.status).toBe(201);
    const result = (await submitted.json()) as {
      reviewId: string;
      authority: string;
    };
    expect(result.authority).toBe("draft_only");
    expect(f.kernel.readReview(result.reviewId, session).attempts).toEqual([]);
    const status = await fetch(`${access.origin}/status?invocationId=one`, {
      headers,
    });
    expect(await status.text()).not.toContain("Synthetic bridge draft");
    const replacement = await bridge.enable();
    expect(
      (
        await fetch(`${replacement.origin}/status?invocationId=one`, {
          headers,
        })
      ).status,
    ).toBe(401);
    bridge.close();
    await expect(
      fetch(`${replacement.origin}/status?invocationId=one`, {
        headers: { Authorization: `Bearer ${replacement.token}` },
      }),
    ).rejects.toThrow();
  } finally {
    bridge.close();
    await f.cleanup();
  }
});
