import express from "express";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { CompilerClient } from "./compiler-client.js";
import { AsyncLock, buildGraph, redactSecrets, validateIdempotencyKey } from "./domain.js";
import { executeInWorker } from "./operations.js";
import type {
  BuildAction,
  BuildState,
  QualityArtifact,
} from "./build-types.js";

export type KnowledgeStage = "empty" | "baseline" | "post_delta";
export type OperationType = "baseline" | "delta";
export type OperationPhase =
  | "fetch"
  | "normalize"
  | "ingest"
  | "compile"
  | "quality"
  | "repair_citations"
  | "publish"
  | "export";
export type OperationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out";

export interface SanitizedError {
  message: string;
}

export interface LiveWiki {
  status(): Promise<any>;
  exportJson(): Promise<any>;
  lint(): Promise<any>;
  fastEval(): Promise<any>;
  query(question: string, save: boolean): Promise<any>;
}

export type ProgressReporter = (
  phase: OperationPhase,
  detail?: Record<string, unknown>,
) => void;
export type OperationExecutor = (
  type: OperationType,
  report: ProgressReporter,
  signal: AbortSignal,
) => Promise<unknown>;

interface OperationRecord {
  operationId: string;
  type: OperationType | "build";
  buildId?: string;
  action?: BuildAction;
  status: OperationStatus;
  phase: OperationPhase;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  deadline: string;
  progress?: Record<string, unknown>;
  result?: unknown;
  error?: SanitizedError;
}

export interface AppOptions {
  root: string;
  workspaceRoot?: string;
  apiKey?: string;
  secUserAgent?: string;
  wiki?: LiveWiki;
  operationExecutor?: OperationExecutor;
  initialStage?: KnowledgeStage;
  baselineDeadlineMs?: number;
  deltaDeadlineMs?: number;
  buildService?: StagedBuildService;
}

export interface StagedBuildService {
  getOrCreateBaseline(): Promise<BuildState>;
  getBuild(buildId: string): Promise<BuildState & { availableActions: BuildAction[] }>;
  runPhase(
    buildId: string,
    action: BuildAction,
    operationId?: string,
    signal?: AbortSignal,
  ): Promise<BuildState>;
  runQuality(buildId: string, operationId?: string): Promise<BuildState>;
  setKnowledgeStage(
    buildId: string,
    knowledgeStage: KnowledgeStage,
  ): Promise<BuildState>;
  getLatestQuality(buildId: string): Promise<QualityArtifact>;
  getArtifact(buildId: string, artifactPath: string): Promise<unknown>;
  runPublish(buildId: string): Promise<BuildState>;
}

function errorPayload(error: unknown): SanitizedError {
  return { message: redactSecrets(error) };
}

function numeric(source: unknown, ...paths: string[]): number | undefined {
  for (const path of paths) {
    let value: any = source;
    for (const part of path.split(".")) value = value?.[part];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function pageId(page: any): string {
  return `${page.pageDirectory ?? "concepts"}/${page.slug}`;
}

export function createApp(options: AppOptions) {
  const app = express();
  const workspaceRoot = resolve(
    options.workspaceRoot ?? resolve(options.root, "var", "wiki"),
  );
  const wiki = options.wiki ?? new CompilerClient(workspaceRoot);
  const stagedBaselineExecutor: OperationExecutor = async (_type, report, signal) => {
    const build = await options.buildService!.getOrCreateBaseline();
    for (;;) {
      if (signal.aborted) throw new Error("operation deadline exceeded");
      const current = await options.buildService!.getBuild(build.buildId);
      if (current.stage === "published") return current;
      if (current.stage === "empty") {
        report("fetch");
        await options.buildService!.runPhase(
          build.buildId,
          "fetch",
          randomUUID(),
          signal,
        );
        continue;
      }
      if (current.stage === "fetched") {
        report("ingest");
        await options.buildService!.runPhase(
          build.buildId,
          "ingest",
          randomUUID(),
          signal,
        );
        continue;
      }
      if (current.stage === "ingested") {
        report("compile");
        await options.buildService!.runPhase(
          build.buildId,
          "compile",
          randomUUID(),
          signal,
        );
        continue;
      }
      if (current.qualityStatus === "not_run") {
        report("quality");
        await options.buildService!.runQuality(build.buildId, randomUUID());
        continue;
      }
      if (current.qualityStatus === "failed") {
        const quality = await options.buildService!.getLatestQuality(build.buildId);
        const citationCount = quality.findings.filter((finding) =>
          finding.rule.toLowerCase().includes("citation"),
        ).length;
        throw new Error(
          `Citation quality failed with ${citationCount} finding(s); use advanced build controls`,
        );
      }
      report("publish");
      return options.buildService!.runPublish(build.buildId);
    }
  };
  const executor =
    options.operationExecutor ??
    ((type, report, signal) =>
      type === "baseline" && options.buildService
        ? stagedBaselineExecutor(type, report, signal)
        : executeInWorker(workspaceRoot, type, report, signal));
  const mutationLock = new AsyncLock();
  const operations = new Map<string, OperationRecord>();
  const idempotency = new Map<string, string>();
  let knowledgeStage: KnowledgeStage = options.initialStage ?? "empty";
  let activeOperation: string | undefined;
  let lastError: SanitizedError | undefined;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  const state = async () => {
    const [status, exported, lint, evaluation] = await Promise.all([
      wiki.status(),
      wiki.exportJson(),
      wiki.lint(),
      wiki.fastEval(),
    ]);
    const pages = exported.pages ?? [];
    const graph = buildGraph(
      pages.map((page: any) => ({
        slug: page.slug,
        title: page.title,
        kind: page.kind ?? "concept",
        body: page.body ?? "",
      })),
    );
    return {
      schemaVersion: 1,
      knowledgeStage,
      activeOperation,
      lastError,
      sources: status.sources ?? 0,
      pages: status.pages?.total ?? exported.pageCount ?? pages.length,
      citations: pages.reduce(
        (count: number, page: any) => count + (page.citations?.length ?? 0),
        0,
      ),
      relationships: graph.edges.length,
      graph,
      quality: {
        healthScore: numeric(evaluation, "health.score", "health.healthScore") ?? null,
        citationCoverage:
          numeric(
            evaluation,
            "citationCoverage.coveragePercent",
            "citationCoverage.citationCoveragePercent",
          ) ?? null,
        errors: lint.errors ?? 0,
        warnings: lint.warnings ?? 0,
        brokenCitations: (lint.results ?? []).filter((item: any) =>
          String(item.rule ?? item.code).includes("citation"),
        ).length,
        brokenLinks: (lint.results ?? []).filter((item: any) =>
          String(item.rule ?? item.code).includes("wikilink"),
        ).length,
        stalePages: status.staleCount ?? status.stalePages?.length ?? 0,
        orphanedPages: status.orphanedCount ?? status.orphanedPages?.length ?? 0,
        contradictions: pages.reduce(
          (count: number, page: any) => count + (page.contradictedBy?.length ?? 0),
          0,
        ),
        results: lint.results ?? [],
      },
    };
  };

  app.get("/health", (_request, response) =>
    response.json({
      ok: true,
      liveEnabled: Boolean(options.apiKey && options.secUserAgent),
      compiler: "1.1.0",
      knowledgeStage,
      viewerUrl: "http://127.0.0.1:4320",
    }),
  );
  app.get("/v1/demo/state", async (_request, response, next) => {
    try {
      response.json(await state());
    } catch (error) {
      next(error);
    }
  });
  app.get("/v1/quality", async (_request, response, next) => {
    try {
      response.json((await state()).quality);
    } catch (error) {
      next(error);
    }
  });
  app.get("/v1/wiki/export", async (_request, response, next) => {
    try {
      response.json(await wiki.exportJson());
    } catch (error) {
      next(error);
    }
  });
  app.get("/v1/operations/:operationId", (request, response) => {
    const operation = operations.get(request.params.operationId);
    if (!operation) {
      response.status(404).json({ error: "operation not found" });
      return;
    }
    response.json(operation);
  });

  app.post("/v1/builds/baseline", async (_request, response, next) => {
    if (!options.buildService) {
      response.status(503).json({ error: "Staged builds are not configured" });
      return;
    }
    try {
      response.status(201).json(await options.buildService.getOrCreateBaseline());
    } catch (error) {
      next(error);
    }
  });
  app.get("/v1/builds/:buildId", async (request, response, next) => {
    if (!options.buildService) {
      response.status(503).json({ error: "Staged builds are not configured" });
      return;
    }
    try {
      response.json(await options.buildService.getBuild(request.params.buildId));
    } catch (error) {
      next(error);
    }
  });
  app.get("/v1/builds/:buildId/quality", async (request, response, next) => {
    if (!options.buildService) {
      response.status(503).json({ error: "Staged builds are not configured" });
      return;
    }
    try {
      response.json(await options.buildService.getLatestQuality(request.params.buildId));
    } catch (error) {
      next(error);
    }
  });
  app.get("/v1/builds/:buildId/artifacts/*artifactPath", async (request, response, next) => {
    if (!options.buildService) {
      response.status(503).json({ error: "Staged builds are not configured" });
      return;
    }
    try {
      response.json(
        await options.buildService.getArtifact(
          request.params.buildId,
          String(request.params.artifactPath),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  const queueOperation = (type: OperationType, key: string) => {
    const existingId = idempotency.get(`${type}:${key}`);
    if (existingId) return existingId;
    const operationId = randomUUID();
    const deadlineMs =
      type === "baseline"
        ? (options.baselineDeadlineMs ?? 1_800_000)
        : (options.deltaDeadlineMs ?? 600_000);
    const now = Date.now();
    const record: OperationRecord = {
      operationId,
      type,
      status: "queued",
      phase: "fetch",
      queuedAt: new Date(now).toISOString(),
      deadline: new Date(now + deadlineMs).toISOString(),
    };
    operations.set(operationId, record);
    idempotency.set(`${type}:${key}`, operationId);
    activeOperation = operationId;
    void mutationLock.run(async () => {
      const controller = new AbortController();
      let timedOut = false;
      const remainingMs = new Date(record.deadline).getTime() - Date.now();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Math.max(0, remainingMs));
      try {
        record.status = "running";
        record.startedAt = new Date().toISOString();
        record.result = await executor(
          type,
          (phase, detail) => {
            record.phase = phase;
            record.progress = detail;
          },
          controller.signal,
        );
        if (timedOut) throw new Error("operation deadline exceeded");
        const nextKnowledgeStage: KnowledgeStage =
          type === "baseline" ? "baseline" : "post_delta";
        if (options.buildService) {
          const build = await options.buildService.getOrCreateBaseline();
          await options.buildService.setKnowledgeStage(
            build.buildId,
            nextKnowledgeStage,
          );
        }
        record.status = "completed";
        record.completedAt = new Date().toISOString();
        knowledgeStage = nextKnowledgeStage;
        lastError = undefined;
      } catch (error) {
        record.status = timedOut ? "timed_out" : "failed";
        record.completedAt = new Date().toISOString();
        record.error = errorPayload(error);
        lastError = record.error;
      } finally {
        clearTimeout(timer);
        if (activeOperation === operationId) activeOperation = undefined;
      }
    });
    return operationId;
  };

  const queueBuildOperation = (
    buildId: string,
    action: BuildAction,
    key: string,
  ): string => {
    const identity = `build:${buildId}:${action}:${key}`;
    const existingId = idempotency.get(identity);
    if (existingId) return existingId;
    const operationId = randomUUID();
    const deadlineByAction: Record<BuildAction, number> = {
      fetch: 300_000,
      ingest: 300_000,
      compile: options.baselineDeadlineMs ?? 1_800_000,
      quality: 300_000,
      repair_citations: 300_000,
      publish: 120_000,
    };
    const now = Date.now();
    const record: OperationRecord = {
      operationId,
      type: "build",
      buildId,
      action,
      status: "queued",
      phase: action,
      queuedAt: new Date(now).toISOString(),
      deadline: new Date(now + deadlineByAction[action]).toISOString(),
    };
    operations.set(operationId, record);
    idempotency.set(identity, operationId);
    activeOperation = operationId;
    void mutationLock.run(async () => {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, deadlineByAction[action]);
      try {
        record.status = "running";
        record.startedAt = new Date().toISOString();
        record.result =
          action === "quality"
            ? await options.buildService!.runQuality(buildId, operationId)
            : action === "publish"
              ? await options.buildService!.runPublish(buildId)
            : await options.buildService!.runPhase(
                buildId,
                action,
                operationId,
                controller.signal,
              );
        if (timedOut) throw new Error("operation deadline exceeded");
        record.status = "completed";
        record.completedAt = new Date().toISOString();
        if (action === "publish") {
          knowledgeStage = "baseline";
          lastError = undefined;
        }
      } catch (error) {
        record.status = timedOut ? "timed_out" : "failed";
        record.completedAt = new Date().toISOString();
        record.error = errorPayload(error);
      } finally {
        clearTimeout(timer);
        if (activeOperation === operationId) activeOperation = undefined;
      }
    });
    return operationId;
  };

  for (const action of [
    "fetch",
    "ingest",
    "compile",
    "quality",
    "repair_citations",
    "publish",
  ] as const) {
    app.post(`/v1/builds/:buildId/${action}`, async (request, response) => {
      if (!options.buildService) {
        response.status(503).json({ error: "Staged builds are not configured" });
        return;
      }
      if (action === "fetch" && !options.secUserAgent) {
        response.status(503).json({ error: "Live fetch disabled: SEC_USER_AGENT is absent" });
        return;
      }
      if (["ingest", "compile"].includes(action) && !options.apiKey) {
        response.status(503).json({ error: "Live model operation disabled: OPENAI_API_KEY is absent" });
        return;
      }
      try {
        const key = validateIdempotencyKey(request.header("Idempotency-Key"));
        const identity = `build:${request.params.buildId}:${action}:${key}`;
        const existingId = idempotency.get(identity);
        if (existingId) {
          response.status(202).json({ operationId: existingId });
          return;
        }
        if (activeOperation) {
          response.status(409).json({ error: "another mutation is already queued or running" });
          return;
        }
        const build = await options.buildService.getBuild(request.params.buildId);
        if (!build.availableActions.includes(action)) {
          response.status(409).json({
            error: `action ${action} is not available at stage ${build.stage}`,
            availableActions: build.availableActions,
          });
          return;
        }
        response.status(202).json({
          operationId: queueBuildOperation(request.params.buildId, action, key),
        });
      } catch (error) {
        response.status(400).json({ error: redactSecrets(error) });
      }
    });
  }

  for (const type of ["baseline", "delta"] as const) {
    app.post(`/v1/demo/${type}`, (request, response) => {
      if (!options.apiKey) {
        response
          .status(503)
          .json({ error: "Live operations disabled: OPENAI_API_KEY is absent" });
        return;
      }
      if (!options.secUserAgent) {
        response
          .status(503)
          .json({ error: "Live operations disabled: SEC_USER_AGENT is absent" });
        return;
      }
      try {
        const key = validateIdempotencyKey(request.header("Idempotency-Key"));
        const existingId = idempotency.get(`${type}:${key}`);
        if (existingId) {
          response.status(202).json({ operationId: existingId });
          return;
        }
        if (activeOperation) {
          response.status(409).json({ error: "another mutation is already queued or running" });
          return;
        }
        if (type === "baseline" && knowledgeStage !== "empty") {
          response.status(409).json({ error: "baseline already exists" });
          return;
        }
        if (type === "delta" && knowledgeStage !== "baseline") {
          response.status(409).json({ error: "delta requires a completed baseline" });
          return;
        }
        response.status(202).json({ operationId: queueOperation(type, key) });
      } catch (error) {
        response.status(400).json({ error: redactSecrets(error) });
      }
    });
  }

  app.post("/v1/query", async (request, response, next) => {
    if (!options.apiKey) {
      response
        .status(503)
        .json({ error: "Live query disabled: OPENAI_API_KEY is absent" });
      return;
    }
    if (knowledgeStage === "empty") {
      response.status(409).json({ error: "Build the baseline wiki before querying" });
      return;
    }
    const question = String(request.body?.question ?? "").trim();
    if (!question || question.length > 1000) {
      response.status(400).json({ error: "question must contain 1-1000 characters" });
      return;
    }
    try {
      const started = performance.now();
      const result = await mutationLock.run(() =>
        wiki.query(question, request.body?.save === true),
      );
      const exported = await wiki.exportJson();
      const selected = new Set(result.pageIds ?? []);
      const selectedPages = (exported.pages ?? []).filter((page: any) =>
        selected.has(pageId(page)),
      );
      response.json({
        answer: result.answer,
        pageIds: result.pageIds ?? [],
        selectedPages: result.selectedPages ?? [],
        warnings: result.warnings ?? [],
        savedPage: result.saved,
        durationMs: Math.round(performance.now() - started),
        citations: selectedPages.flatMap((page: any) =>
          (page.citations ?? []).map((citation: any) => ({
            pageId: pageId(page),
            pageTitle: page.title,
            ...citation,
          })),
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response.status(500).json({ error: redactSecrets(error) });
    },
  );
  return app;
}
