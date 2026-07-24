import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BuildService } from "../src/build-service.js";
import { BuildStore } from "../src/build-store.js";
import type { BuildWorkerRequest, BuildWorkerResult } from "../src/build-types.js";

async function service(
  execute: (request: BuildWorkerRequest) => Promise<BuildWorkerResult>,
): Promise<{ builds: BuildService; store: BuildStore; buildId: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-build-service-"));
  const store = new BuildStore(root);
  const builds = new BuildService(store, execute);
  const build = await builds.getOrCreateBaseline();
  return { builds, store, buildId: build.buildId };
}

describe("BuildService phase boundaries", () => {
  it("advances fetch, ingest, and compile exactly one checkpoint at a time", async () => {
    const actions: string[] = [];
    const execute = vi.fn(async (request: BuildWorkerRequest): Promise<BuildWorkerResult> => {
      actions.push(request.action);
      if (request.action === "fetch") {
        await writeFile(path.join(request.targetRoot, "corpus.json"), "{}", "utf8");
        return { action: "fetch", filings: 3 };
      }
      if (request.action === "ingest") {
        await mkdir(path.join(request.targetRoot, "sources"), { recursive: true });
        await writeFile(path.join(request.targetRoot, "sources", "annual.md"), "source", "utf8");
        return {
          action: "ingest",
          sourceFiles: [{ filingId: "annual", filename: "annual.md", lines: 1 }],
        };
      }
      return {
        action: "compile",
        pages: [
          "ai-semiconductor-landscape",
          "company-strategy-comparison",
          "supply-chain-and-geopolitical-risk",
        ],
      };
    });
    const { builds, store, buildId } = await service(execute);

    const fetched = await builds.runPhase(buildId, "fetch", "op-fetch");
    expect(fetched.stage).toBe("fetched");
    const fetchedCheckpoint = fetched.checkpointId;

    const ingested = await builds.runPhase(buildId, "ingest", "op-ingest");
    expect(ingested.stage).toBe("ingested");
    expect(ingested.sourceFiles[0]?.filename).toBe("annual.md");
    expect(
      await readFile(
        path.join(store.checkpointRoot(buildId, fetchedCheckpoint!), "corpus.json"),
        "utf8",
      ),
    ).toBe("{}");

    const compiled = await builds.runPhase(buildId, "compile", "op-compile");
    expect(compiled.stage).toBe("compiled");
    expect(compiled.qualityStatus).toBe("not_run");
    expect(actions).toEqual(["fetch", "ingest", "compile"]);
  });

  it("rejects an action that is invalid for the persisted stage", async () => {
    const { builds, buildId } = await service(vi.fn());
    await expect(builds.runPhase(buildId, "compile", "op-invalid")).rejects.toThrow(
      /not available.*empty/i,
    );
  });

  it("leaves checkpoint and state unchanged when a worker phase fails", async () => {
    const { builds, store, buildId } = await service(async () => {
      throw new Error("provider failed secret-key");
    });
    const before = await store.load(buildId);

    await expect(builds.runPhase(buildId, "fetch", "op-failed")).rejects.toThrow(
      /provider failed/,
    );

    expect(await store.load(buildId)).toEqual(before);
    const failures = await store.listFailures(buildId, "fetch");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.diagnostics).toEqual([]);
  });
});
