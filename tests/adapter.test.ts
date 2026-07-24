import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { SnapshotStore } from "../src/snapshots.js";

describe("adapter API", () => {
  it("reports replay-ready health without an API key", async () => {
    const app = createApp({ root: process.cwd(), apiKey: undefined });
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, liveEnabled: false });
  });

  it("returns stable baseline state and quality contracts", async () => {
    const app = createApp({ root: process.cwd(), apiKey: undefined });
    const state = await request(app).get("/v1/demo/state");
    expect(state.body.schemaVersion).toBe(1);
    expect(state.body.stage).toBe("baseline");
    expect(state.body.quality.brokenLinks).toBe(0);
    expect(state.body.graph.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects mutation without an idempotency key", async () => {
    const app = createApp({ root: process.cwd(), apiKey: undefined });
    const response = await request(app).post("/v1/demo/delta");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Idempotency-Key/);
  });

  it("replays pinned delta idempotently when live access is disabled", async () => {
    const app = createApp({ root: process.cwd(), apiKey: undefined });
    const first = await request(app)
      .post("/v1/demo/delta")
      .set("Idempotency-Key", "delta-one");
    const second = await request(app)
      .post("/v1/demo/delta")
      .set("Idempotency-Key", "delta-one");
    expect(first.status).toBe(200);
    expect(first.body.mode).toBe("replay");
    expect(first.body.changes.updated.length).toBeGreaterThanOrEqual(2);
    expect(second.body).toEqual(first.body);
  });

  it("disables free-form live query without credentials", async () => {
    const app = createApp({ root: process.cwd(), apiKey: undefined });
    const response = await request(app)
      .post("/v1/query")
      .send({ question: "New arbitrary question?", save: false });
    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/OPENAI_API_KEY/);
  });
});

describe("snapshot verification", () => {
  it("verifies both committed replay snapshots", async () => {
    const store = new SnapshotStore(process.cwd());
    for (const name of ["baseline", "post-delta"]) {
      const manifest = JSON.parse(
        await (await import("node:fs/promises")).readFile(
          join(process.cwd(), "demo", "snapshots", "manifests", `${name}.json`),
          "utf8",
        ),
      );
      expect(await store.verify(manifest)).toBe(true);
    }
  });

  it("detects checksum changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-snapshot-"));
    await writeFile(join(root, "page.md"), "original", "utf8");
    const store = new SnapshotStore(root);
    const manifest = await store.createManifest(["page.md"], {
      snapshotId: "test",
      stage: "baseline",
    });
    expect(await store.verify(manifest)).toBe(true);
    await writeFile(join(root, "page.md"), "changed", "utf8");
    expect(await store.verify(manifest)).toBe(false);
  });
});
