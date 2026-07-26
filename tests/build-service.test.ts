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

  it("leaves checkpoint and state unchanged when staging publication fails", async () => {
    const execute = async (request: BuildWorkerRequest): Promise<BuildWorkerResult> => {
      if (request.action === "fetch") return { action: "fetch", filings: 3 };
      if (request.action === "ingest") return { action: "ingest", sourceFiles: [] };
      return { action: "compile", pages: [] };
    };
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-stage-failure-"));
    const store = new BuildStore(root);
    const publisher = vi.fn(async (
      _source: string,
      _target: string,
      _commit: () => Promise<import("../src/build-types.js").BuildState>,
    ) => {
      throw new Error("staging viewer failed");
    });
    const builds = new BuildService(store, execute, undefined, publisher);
    const build = await builds.getOrCreateBaseline();
    await builds.runPhase(build.buildId, "fetch", "stage-fetch");
    await builds.runPhase(build.buildId, "ingest", "stage-ingest");
    const before = await store.load(build.buildId);

    await expect(
      builds.runPhase(build.buildId, "compile", "stage-compile"),
    ).rejects.toThrow(/staging viewer failed/);

    expect(await store.load(build.buildId)).toEqual(before);
    expect(await store.listFailures(build.buildId, "compile")).toHaveLength(1);
  });

  it("retains exact citation findings without rolling back compiled pages", async () => {
    const execute = async (request: BuildWorkerRequest): Promise<BuildWorkerResult> => {
      if (request.action === "fetch") return { action: "fetch", filings: 3 };
      if (request.action === "ingest") return { action: "ingest", sourceFiles: [] };
      return {
        action: "compile",
        pages: [
          "ai-semiconductor-landscape",
          "company-strategy-comparison",
          "supply-chain-and-geopolitical-risk",
        ],
      };
    };
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-quality-"));
    const store = new BuildStore(root);
    const quality = vi.fn(async () => ({
      lint: {
        results: [
          {
            rule: "broken-citation",
            severity: "error",
            file: "wiki/concepts/company-strategy-comparison.md",
            line: 42,
            message:
              "Broken citation ^[NVIDIA 10-K:34-40] — source file not found",
          },
          {
            rule: "malformed-claim-citation",
            severity: "error",
            file: "wiki/concepts/ai-semiconductor-landscape.md",
            line: 67,
            message:
              "Malformed claim citation ^[amd.md: lines 10-20] — expected file.md:N-N",
          },
        ],
      },
      evaluation: { health: 92 },
    }));
    const builds = new BuildService(store, execute, quality);
    const build = await builds.getOrCreateBaseline();
    await builds.runPhase(build.buildId, "fetch", "quality-fetch");
    await builds.runPhase(build.buildId, "ingest", "quality-ingest");
    const compiled = await builds.runPhase(build.buildId, "compile", "quality-compile");

    const checked = await builds.runQuality(build.buildId, "quality-check");
    expect(checked.qualityStatus).toBe("failed");
    expect(checked.checkpointId).toBe(compiled.checkpointId);

    const artifact = await builds.getLatestQuality(build.buildId);
    expect(artifact.findings).toEqual([
      expect.objectContaining({
        rule: "broken-citation",
        page: "wiki/concepts/company-strategy-comparison.md",
        line: 42,
        citation: "^[NVIDIA 10-K:34-40]",
      }),
      expect.objectContaining({
        rule: "malformed-claim-citation",
        page: "wiki/concepts/ai-semiconductor-landscape.md",
        line: 67,
        citation: "^[amd.md: lines 10-20]",
      }),
    ]);
  });

  it("gates quality on citation errors beyond the retained artifact limit", async () => {
    const execute = async (request: BuildWorkerRequest): Promise<BuildWorkerResult> => {
      if (request.action === "fetch") return { action: "fetch", filings: 3 };
      if (request.action === "ingest") return { action: "ingest", sourceFiles: [] };
      return {
        action: "compile",
        pages: [
          "ai-semiconductor-landscape",
          "company-strategy-comparison",
          "supply-chain-and-geopolitical-risk",
        ],
      };
    };
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-quality-limit-"));
    const store = new BuildStore(root);
    const nonBlocking = Array.from({ length: 2_000 }, (_, index) => ({
      rule: "schema-cross-link-minimum",
      severity: "warning",
      file: `wiki/concepts/page-${index}.md`,
      message: "Needs another link",
    }));
    const quality = vi.fn(async () => ({
      lint: {
        results: [
          ...nonBlocking,
          {
            rule: "broken-citation",
            severity: "error",
            file: "wiki/concepts/late-error.md",
            message: "Broken citation ^[nvidia-2026-10k.md:1-2]",
          },
        ],
      },
      evaluation: {},
    }));
    const builds = new BuildService(store, execute, quality);
    const build = await builds.getOrCreateBaseline();
    await builds.runPhase(build.buildId, "fetch", "limit-fetch");
    await builds.runPhase(build.buildId, "ingest", "limit-ingest");
    await builds.runPhase(build.buildId, "compile", "limit-compile");

    const checked = await builds.runQuality(build.buildId, "limit-quality");

    expect(checked.qualityStatus).toBe("failed");
    const artifact = await builds.getLatestQuality(build.buildId);
    expect(artifact.truncated).toBe(true);
    expect(artifact.findings).toHaveLength(2_000);
  });

  it("publishes only a quality-passed checkpoint", async () => {
    const execute = async (request: BuildWorkerRequest): Promise<BuildWorkerResult> => {
      if (request.action === "fetch") return { action: "fetch", filings: 3 };
      if (request.action === "ingest") return { action: "ingest", sourceFiles: [] };
      return {
        action: "compile",
        pages: [
          "ai-semiconductor-landscape",
          "company-strategy-comparison",
          "supply-chain-and-geopolitical-risk",
        ],
      };
    };
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-publish-service-"));
    const store = new BuildStore(root);
    const publisher = vi.fn(async (
      _source: string,
      _target: string,
      commit: () => Promise<import("../src/build-types.js").BuildState>,
    ) => commit());
    const builds = new BuildService(
      store,
      execute,
      async () => ({ lint: { results: [] }, evaluation: {} }),
      publisher,
    );
    const build = await builds.getOrCreateBaseline();
    await builds.runPhase(build.buildId, "fetch", "publish-fetch");
    await builds.runPhase(build.buildId, "ingest", "publish-ingest");
    await builds.runPhase(build.buildId, "compile", "publish-compile");
    await expect(builds.runPublish(build.buildId)).rejects.toThrow(/quality/i);

    await builds.runQuality(build.buildId, "publish-quality");
    const published = await builds.runPublish(build.buildId);
    expect(published.stage).toBe("published");
    expect(published.knowledgeStage).toBe("baseline");
    expect(published.publishedAt).toBeTruthy();
    expect(publisher).toHaveBeenLastCalledWith(
      expect.stringContaining("workspace"),
      path.join(root, "wiki"),
      expect.any(Function),
    );

    const postDelta = await (builds as any).setKnowledgeStage(
      build.buildId,
      "post_delta",
    );
    expect(postDelta.knowledgeStage).toBe("post_delta");
    expect((await store.load(build.buildId)).knowledgeStage).toBe("post_delta");
  });
});
