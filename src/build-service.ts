import { randomUUID } from "node:crypto";
import type {
  BuildAction,
  BuildState,
  BuildWorkerRequest,
  BuildWorkerResult,
} from "./build-types.js";
import { BuildStore } from "./build-store.js";
import { redactSecrets } from "./domain.js";

export type BuildPhaseExecutor = (
  request: BuildWorkerRequest,
) => Promise<BuildWorkerResult>;

export interface BuildView extends BuildState {
  availableActions: BuildAction[];
}

export class BuildService {
  constructor(
    readonly store: BuildStore,
    private readonly execute: BuildPhaseExecutor,
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
      });
      const next = this.nextState(current, result);
      return await this.store.commitPhase(transaction, next);
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
}

