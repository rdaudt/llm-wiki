import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BuildStore } from "../src/build-store.js";

async function temporaryRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "llm-wiki-build-store-"));
}

describe("BuildStore", () => {
  it("persists a baseline build and derives allowed actions", async () => {
    const store = new BuildStore(await temporaryRoot());
    const created = await store.createBaseline();

    expect(created.stage).toBe("empty");
    expect((created as any).knowledgeStage).toBe("empty");
    expect(created.qualityStatus).toBe("not_run");
    expect(store.availableActions(created)).toEqual(["fetch"]);
    expect(await store.currentBaseline()).toEqual(created);
    expect(await store.load(created.buildId)).toEqual(created);
  });

  it("persists the live knowledge stage with the baseline build", async () => {
    const store = new BuildStore(await temporaryRoot());
    const build = await store.createBaseline();

    await store.updateState({
      ...build,
      knowledgeStage: "post_delta",
    } as any);

    expect((await store.load(build.buildId) as any).knowledgeStage).toBe("post_delta");
  });

  it("promotes a successful phase without modifying its input checkpoint", async () => {
    const store = new BuildStore(await temporaryRoot());
    const build = await store.createBaseline();
    const transaction = await store.beginPhase(build.buildId, "fetch", "operation-1");
    await writeFile(path.join(transaction.temporaryRoot, "normalized.md"), "first", "utf8");

    const fetched = await store.commitPhase(transaction, {
      ...build,
      stage: "fetched",
      qualityStatus: "not_run",
    });
    const firstCheckpoint = fetched.checkpointId;
    expect(firstCheckpoint).toBeTruthy();

    const next = await store.beginPhase(build.buildId, "ingest", "operation-2");
    await writeFile(path.join(next.temporaryRoot, "normalized.md"), "second", "utf8");

    expect(
      await readFile(
        path.join(store.checkpointRoot(build.buildId, firstCheckpoint!), "normalized.md"),
        "utf8",
      ),
    ).toBe("first");
  });

  it("retains sanitized failure artifacts and leaves state unchanged", async () => {
    const store = new BuildStore(await temporaryRoot());
    const build = await store.createBaseline();
    const transaction = await store.beginPhase(build.buildId, "fetch", "operation-failed");
    await writeFile(path.join(transaction.temporaryRoot, "partial.md"), "partial", "utf8");

    await store.failPhase(transaction, {
      operationId: "operation-failed",
      action: "fetch",
      failedAt: "2026-07-24T08:00:00.000Z",
      error: { message: "provider failed [REDACTED]" },
      diagnostics: [{ filing: "nvidia" }],
    });

    expect((await store.load(build.buildId)).stage).toBe("empty");
    const artifact = JSON.parse(
      await readFile(
        path.join(
          store.buildRoot(build.buildId),
          "failures",
          "fetch",
          "operation-failed",
          "failure.json",
        ),
        "utf8",
      ),
    );
    expect(artifact.error.message).toBe("provider failed [REDACTED]");
  });

  it("rejects corrupt persisted state instead of guessing", async () => {
    const store = new BuildStore(await temporaryRoot());
    const build = await store.createBaseline();
    await writeFile(
      path.join(store.buildRoot(build.buildId), "build-state.json"),
      '{"stage":"compiled"}',
      "utf8",
    );

    await expect(store.load(build.buildId)).rejects.toThrow(/invalid build state/i);
  });

  it("keeps only the latest three failures for an action", async () => {
    const store = new BuildStore(await temporaryRoot());
    const build = await store.createBaseline();
    for (let index = 1; index <= 4; index += 1) {
      const operationId = `operation-${index}`;
      const transaction = await store.beginPhase(build.buildId, "fetch", operationId);
      await store.failPhase(transaction, {
        operationId,
        action: "fetch",
        failedAt: `2026-07-24T08:00:0${index}.000Z`,
        error: { message: `failure ${index}` },
        diagnostics: [],
      });
    }

    const failures = await store.listFailures(build.buildId, "fetch");
    expect(failures.map((item) => item.operationId)).toEqual([
      "operation-4",
      "operation-3",
      "operation-2",
    ]);
  });
});
