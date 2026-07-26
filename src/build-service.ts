import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  BuildAction,
  BuildState,
  BuildWorkerRequest,
  BuildWorkerResult,
  KnowledgeStage,
  QualityArtifact,
  QualityFinding,
} from "./build-types.js";
import { BuildStore } from "./build-store.js";
import { redactSecrets } from "./domain.js";

export type BuildPhaseExecutor = (
  request: BuildWorkerRequest,
  signal?: AbortSignal,
) => Promise<BuildWorkerResult>;

export type QualityRunner = (workspaceRoot: string) => Promise<{
  lint: { results?: unknown[] };
  evaluation: unknown;
}>;

export type WorkspacePublisher = (
  sourceRoot: string,
  targetRoot: string,
  commit: () => Promise<BuildState>,
) => Promise<BuildState>;

export interface BuildView extends BuildState {
  availableActions: BuildAction[];
}

export class BuildService {
  constructor(
    readonly store: BuildStore,
    private readonly execute: BuildPhaseExecutor,
    private readonly qualityRunner?: QualityRunner,
    private readonly publisher?: WorkspacePublisher,
  ) {}

  async getOrCreateBaseline(): Promise<BuildState> {
    return this.store.createBaseline();
  }

  async getBuild(buildId: string): Promise<BuildView> {
    const state = await this.store.load(buildId);
    return { ...state, availableActions: this.store.availableActions(state) };
  }

  async runPhase(
    buildId: string,
    action: BuildAction,
    operationId: string = randomUUID(),
    signal?: AbortSignal,
  ): Promise<BuildState> {
    const current = await this.store.load(buildId);
    if (!this.store.availableActions(current).includes(action)) {
      throw new Error(`Action ${action} is not available at stage ${current.stage}`);
    }
    if (action === "quality" || action === "publish") {
      throw new Error(`Action ${action} is not a worker phase`);
    }

    const transaction = await this.store.beginPhase(buildId, action, operationId);
    try {
      const result = await this.execute({
        action,
        buildId,
        targetRoot: transaction.temporaryRoot,
      }, signal);
      let next = this.nextState(current, result);
      if (result.action === "repair_citations") {
        const latestRepairArtifact = await this.store.writeArtifact(
          buildId,
          "repairs",
          operationId,
          {
            createdAt: new Date().toISOString(),
            repairs: result.repairs,
            unresolved: result.unresolved,
          },
        );
        next = { ...next, latestRepairArtifact };
      }
      if (
        (result.action === "compile" || result.action === "repair_citations") &&
        this.publisher
      ) {
        return await this.publisher(
          transaction.temporaryRoot,
          path.join(this.store.varRoot, "staging-wiki"),
          () => this.store.commitPhase(transaction, next),
        );
      }
      return this.store.commitPhase(transaction, next);
    } catch (error) {
      await this.store.failPhase(transaction, {
        operationId,
        action,
        failedAt: new Date().toISOString(),
        error: { message: redactSecrets(error) },
        diagnostics: [],
      });
      throw error;
    }
  }

  async runQuality(
    buildId: string,
    operationId: string = randomUUID(),
  ): Promise<BuildState> {
    const current = await this.store.load(buildId);
    if (!this.store.availableActions(current).includes("quality")) {
      throw new Error(`Action quality is not available at stage ${current.stage}`);
    }
    if (!current.checkpointId) throw new Error("Compiled checkpoint is missing");
    if (!this.qualityRunner) throw new Error("Quality runner is not configured");
    const workspace = `${this.store.checkpointRoot(buildId, current.checkpointId)}/workspace`;
    const result = await this.qualityRunner(workspace);
    const raw = result.lint.results ?? [];
    const limited = raw.slice(0, 2_000);
    const findings = limited.map((item) => this.qualityFinding(item));
    const passed = !raw.some((item) => {
      const finding = this.qualityFinding(item);
      return (
        finding.severity.toLowerCase() === "error" &&
        finding.rule.toLowerCase().includes("citation")
      );
    });
    const artifact: QualityArtifact = {
      createdAt: new Date().toISOString(),
      passed,
      findings,
      lint: result.lint,
      evaluation: result.evaluation,
      truncated: raw.length > limited.length,
    };
    const artifactPath = await this.store.writeArtifact(
      buildId,
      "quality",
      operationId,
      artifact,
    );
    return this.store.updateState({
      ...current,
      qualityStatus: passed ? "passed" : "failed",
      latestQualityArtifact: artifactPath,
    });
  }

  async getLatestQuality(buildId: string): Promise<QualityArtifact> {
    const state = await this.store.load(buildId);
    if (!state.latestQualityArtifact) throw new Error("Quality has not been run");
    return (await this.store.readArtifact(
      buildId,
      state.latestQualityArtifact,
    )) as QualityArtifact;
  }

  async getArtifact(buildId: string, artifactPath: string): Promise<unknown> {
    return this.store.readArtifact(buildId, artifactPath);
  }

  async runPublish(buildId: string): Promise<BuildState> {
    const current = await this.store.load(buildId);
    if (current.stage !== "compiled" || current.qualityStatus !== "passed") {
      throw new Error("Publish requires a quality-passed compiled checkpoint");
    }
    if (!current.checkpointId) throw new Error("Compiled checkpoint is missing");
    if (!this.publisher) throw new Error("Workspace publisher is not configured");
    return await this.publisher(
      path.join(this.store.checkpointRoot(buildId, current.checkpointId), "workspace"),
      path.join(this.store.varRoot, "wiki"),
      () =>
        this.store.updateState({
          ...current,
          stage: "published",
          knowledgeStage: "baseline",
          publishedAt: new Date().toISOString(),
        }),
    );
  }

  async setKnowledgeStage(
    buildId: string,
    knowledgeStage: KnowledgeStage,
  ): Promise<BuildState> {
    const current = await this.store.load(buildId);
    if (knowledgeStage !== "empty" && current.stage !== "published") {
      throw new Error("Live knowledge requires a published baseline");
    }
    return this.store.updateState({ ...current, knowledgeStage });
  }

  private nextState(current: BuildState, result: BuildWorkerResult): BuildState {
    if (result.action === "fetch") {
      return {
        ...current,
        stage: "fetched",
        qualityStatus: "not_run",
        sourceFiles: [],
        latestQualityArtifact: undefined,
      };
    }
    if (result.action === "ingest") {
      return {
        ...current,
        stage: "ingested",
        qualityStatus: "not_run",
        sourceFiles: result.sourceFiles,
        latestQualityArtifact: undefined,
      };
    }
    if (result.action === "compile" || result.action === "repair_citations") {
      return {
        ...current,
        stage: "compiled",
        qualityStatus: "not_run",
        latestQualityArtifact: undefined,
      };
    }
    return result satisfies never;
  }

  private qualityFinding(value: unknown): QualityFinding {
    const item = (value ?? {}) as Record<string, unknown>;
    const message = String(item.message ?? "").slice(0, 4_000);
    const marker = message.match(/\^\[[^\]]+\]/)?.[0];
    return {
      rule: String(item.rule ?? item.code ?? "unknown"),
      severity: String(item.severity ?? "error"),
      page: String(item.file ?? ""),
      ...(typeof item.line === "number" ? { line: item.line } : {}),
      ...(marker ? { citation: marker } : {}),
      message,
    };
  }
}
