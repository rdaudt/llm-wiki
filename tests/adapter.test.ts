import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  type LiveWiki,
  type OperationExecutor,
  type StagedBuildService,
} from "../src/app.js";

const emptyStatus = {
  pages: { concepts: 0, queries: 0, total: 0 },
  sources: 0,
  lastCompiledAt: null,
  stalePages: [],
  staleCount: 0,
  orphanedPages: [],
  orphanedCount: 0,
  stateStatus: "missing",
  pendingCandidates: 0,
  pendingChanges: [],
  pendingChangesCount: 0,
};

function fakeWiki(overrides: Partial<LiveWiki> = {}): LiveWiki {
  return {
    status: vi.fn().mockResolvedValue(emptyStatus),
    lint: vi.fn().mockResolvedValue({ errors: 0, warnings: 0, info: 0, results: [] }),
    fastEval: vi.fn().mockResolvedValue({
      health: { score: 0 },
      citationCoverage: { coveragePercent: 0 },
      stats: {},
    }),
    exportJson: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      exportedAt: "2026-01-01T00:00:00Z",
      pageCount: 0,
      pages: [],
    }),
    query: vi.fn(),
    ...overrides,
  };
}

async function eventually(
  app: ReturnType<typeof createApp>,
  operationId: string,
  expected: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request(app).get(`/v1/operations/${operationId}`);
    if (response.body.status === expected) return response;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`operation ${operationId} did not reach ${expected}`);
}

describe("live-only adapter", () => {
  it("starts honestly empty and reports the native viewer", async () => {
    const app = createApp({ root: "unused", apiKey: undefined, wiki: fakeWiki() });
    const health = await request(app).get("/health");
    const state = await request(app).get("/v1/demo/state");
    expect(health.body).toMatchObject({
      ok: true,
      liveEnabled: false,
      knowledgeStage: "empty",
      viewerUrl: "http://127.0.0.1:4320",
    });
    expect(state.body).toMatchObject({
      knowledgeStage: "empty",
      sources: 0,
      pages: 0,
    });
    expect(state.body).not.toHaveProperty("mode");
    expect(state.body).not.toHaveProperty("snapshotId");
  });

  it("disables every paid operation when credentials are missing", async () => {
    const app = createApp({ root: "unused", apiKey: undefined, wiki: fakeWiki() });
    for (const path of ["/v1/demo/baseline", "/v1/demo/delta", "/v1/query"]) {
      const response = await request(app)
        .post(path)
        .set("Idempotency-Key", "missing-creds")
        .send({ question: "What changed?" });
      expect(response.status).toBe(503);
      expect(response.body.error).toMatch(/OPENAI_API_KEY/);
    }
  });

  it("queues baseline work, exposes progress, and is idempotent", async () => {
    let release!: () => void;
    const executor: OperationExecutor = vi.fn(async (_type, report) => {
      report("fetch", { filing: "nvidia-2026-10k" });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { sources: 3 };
    });
    const app = createApp({
      root: "unused",
      apiKey: "configured",
      secUserAgent: "demo contact@example.com",
      wiki: fakeWiki(),
      operationExecutor: executor,
    });
    const first = await request(app)
      .post("/v1/demo/baseline")
      .set("Idempotency-Key", "baseline-one");
    const second = await request(app)
      .post("/v1/demo/baseline")
      .set("Idempotency-Key", "baseline-one");
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.operationId).toBe(first.body.operationId);
    const running = await eventually(app, first.body.operationId, "running");
    expect(
      new Date(running.body.deadline).getTime() -
        new Date(running.body.queuedAt).getTime(),
    ).toBe(30 * 60 * 1000);
    expect(running.body).toMatchObject({
      type: "baseline",
      phase: "fetch",
      progress: { filing: "nvidia-2026-10k" },
    });
    release();
    const completed = await eventually(app, first.body.operationId, "completed");
    expect(completed.body.result).toEqual({ sources: 3 });
    expect(executor).toHaveBeenCalledTimes(1);
    const state = await request(app).get("/v1/demo/state");
    expect(state.body.knowledgeStage).toBe("baseline");
  });

  it("gates delta until baseline and then advances to post_delta", async () => {
    const executor: OperationExecutor = vi.fn(async () => ({}));
    const app = createApp({
      root: "unused",
      apiKey: "configured",
      secUserAgent: "demo contact@example.com",
      wiki: fakeWiki(),
      operationExecutor: executor,
    });
    expect(
      (await request(app).post("/v1/demo/delta").set("Idempotency-Key", "too-early"))
        .status,
    ).toBe(409);
    const baseline = await request(app)
      .post("/v1/demo/baseline")
      .set("Idempotency-Key", "baseline");
    await eventually(app, baseline.body.operationId, "completed");
    const delta = await request(app)
      .post("/v1/demo/delta")
      .set("Idempotency-Key", "delta");
    expect(delta.status).toBe(202);
    await eventually(app, delta.body.operationId, "completed");
    expect((await request(app).get("/v1/demo/state")).body.knowledgeStage).toBe(
      "post_delta",
    );
  });

  it("persists post_delta after a successful delta operation", async () => {
    const setKnowledgeStage = vi.fn(async () => undefined);
    const app = createApp({
      root: "unused",
      apiKey: "configured",
      secUserAgent: "demo contact@example.com",
      wiki: fakeWiki(),
      initialStage: "baseline",
      operationExecutor: vi.fn(async () => ({})),
      buildService: {
        getOrCreateBaseline: vi.fn(async () => ({ buildId: "baseline-test" })),
        setKnowledgeStage,
      } as any,
    });

    const delta = await request(app)
      .post("/v1/demo/delta")
      .set("Idempotency-Key", "persisted-delta");
    await eventually(app, delta.body.operationId, "completed");

    expect(setKnowledgeStage).toHaveBeenCalledWith(
      "baseline-test",
      "post_delta",
    );
  });

  it("passes distinct questions and save flags unchanged to the compiler", async () => {
    const query = vi.fn(async (question: string, save: boolean) => ({
      answer: `answer:${question}`,
      pageIds: ["concepts/company-strategy"],
      selectedPages: ["company-strategy"],
      refs: [],
      reasoning: "grounded",
      saved: save ? "wiki/queries/saved.md" : undefined,
      warnings: [{ code: "degraded", message: "lexical fallback" }],
    }));
    const wiki = fakeWiki({
      query,
      exportJson: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        exportedAt: "2026-01-01T00:00:00Z",
        pageCount: 1,
        pages: [
          {
            slug: "company-strategy",
            pageDirectory: "concepts",
            title: "Company strategy",
            sources: ["nvidia.md"],
            citations: [
              { source: "nvidia.md", startLine: 10, endLine: 20 },
            ],
          },
        ],
      }),
    });
    const app = createApp({
      root: "unused",
      apiKey: "configured",
      secUserAgent: "demo contact@example.com",
      wiki,
      initialStage: "baseline",
    });
    const one = await request(app)
      .post("/v1/query")
      .send({ question: "First exact question?", save: true });
    const two = await request(app)
      .post("/v1/query")
      .send({ question: "Second exact question?", save: false });
    expect(query).toHaveBeenNthCalledWith(1, "First exact question?", true);
    expect(query).toHaveBeenNthCalledWith(2, "Second exact question?", false);
    expect(one.body).toMatchObject({
      answer: "answer:First exact question?",
      pageIds: ["concepts/company-strategy"],
      warnings: [{ code: "degraded" }],
      savedPage: "wiki/queries/saved.md",
      citations: [{ source: "nvidia.md", startLine: 10, endLine: 20 }],
    });
    expect(two.body.answer).toBe("answer:Second exact question?");
    expect(one.body.durationMs).toBeTypeOf("number");
  });

  it("publishes quality and export only from compiler reads", async () => {
    const wiki = fakeWiki({
      lint: vi.fn().mockResolvedValue({
        errors: 1,
        warnings: 2,
        info: 0,
        results: [{ rule: "broken-citation", severity: "error" }],
      }),
      fastEval: vi.fn().mockResolvedValue({
        health: { score: 71 },
        citationCoverage: { coveragePercent: 83 },
        stats: {},
      }),
    });
    const app = createApp({
      root: "unused",
      apiKey: "configured",
      secUserAgent: "demo contact@example.com",
      wiki,
    });
    expect((await request(app).get("/v1/quality")).body).toMatchObject({
      errors: 1,
      warnings: 2,
      healthScore: 71,
      citationCoverage: 83,
    });
    await request(app).get("/v1/wiki/export");
    expect(wiki.exportJson).toHaveBeenCalled();
    expect(wiki.lint).toHaveBeenCalled();
    expect(wiki.fastEval).toHaveBeenCalled();
  });

  it("sanitizes worker failures and allows retry", async () => {
    const executor: OperationExecutor = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("OPENAI_API_KEY=sk-secret Authorization: Bearer hidden"),
      )
      .mockResolvedValueOnce({});
    const app = createApp({
      root: "unused",
      apiKey: "configured",
      secUserAgent: "demo contact@example.com",
      wiki: fakeWiki(),
      operationExecutor: executor,
    });
    const failedStart = await request(app)
      .post("/v1/demo/baseline")
      .set("Idempotency-Key", "failed");
    const failed = await eventually(app, failedStart.body.operationId, "failed");
    expect(JSON.stringify(failed.body)).not.toContain("sk-secret");
    expect(JSON.stringify(failed.body)).not.toContain("hidden");
    const retry = await request(app)
      .post("/v1/demo/baseline")
      .set("Idempotency-Key", "retry");
    expect(retry.status).toBe(202);
    await eventually(app, retry.body.operationId, "completed");
  });

  it("exposes staged build actions and preserves phase idempotency", async () => {
    const state = {
      buildId: "baseline-test",
      kind: "baseline" as const,
      stage: "empty" as const,
      knowledgeStage: "empty" as const,
      qualityStatus: "not_run" as const,
      createdAt: "2026-07-24T08:00:00.000Z",
      updatedAt: "2026-07-24T08:00:00.000Z",
      sourceFiles: [],
    };
    const runPhase = vi.fn(async () => ({ ...state, stage: "fetched" as const }));
    const buildService: StagedBuildService = {
      getOrCreateBaseline: vi.fn(async () => state),
      getBuild: vi.fn(async () => ({
        ...state,
        availableActions: ["fetch" as const],
      })),
      runPhase,
      runQuality: vi.fn(),
      setKnowledgeStage: vi.fn(),
      getLatestQuality: vi.fn(),
      getArtifact: vi.fn(),
      runPublish: vi.fn(),
    };
    const app = createApp({
      root: "unused",
      apiKey: "configured",
      secUserAgent: "demo contact@example.com",
      wiki: fakeWiki(),
      buildService,
    });

    const created = await request(app).post("/v1/builds/baseline");
    expect(created.status).toBe(201);
    expect(created.body.buildId).toBe("baseline-test");
    expect((await request(app).get("/v1/builds/baseline-test")).body).toMatchObject({
      availableActions: ["fetch"],
    });

    const first = await request(app)
      .post("/v1/builds/baseline-test/fetch")
      .set("Idempotency-Key", "fetch-one");
    const second = await request(app)
      .post("/v1/builds/baseline-test/fetch")
      .set("Idempotency-Key", "fetch-one");
    expect(first.status).toBe(202);
    expect(second.body.operationId).toBe(first.body.operationId);
    const completed = await eventually(app, first.body.operationId, "completed");
    expect(completed.body).toMatchObject({
      buildId: "baseline-test",
      action: "fetch",
    });
    expect(runPhase).toHaveBeenCalledTimes(1);
  });
});
