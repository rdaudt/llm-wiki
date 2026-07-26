import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  BuildAction,
  BuildState,
  FailureArtifact,
  PhaseTransaction,
} from "./build-types.js";

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const stateSchema = z.object({
  buildId: z.string().regex(identifierPattern),
  kind: z.literal("baseline"),
  stage: z.enum(["empty", "fetched", "ingested", "compiled", "published"]),
  knowledgeStage: z.enum(["empty", "baseline", "post_delta"]).optional(),
  qualityStatus: z.enum(["not_run", "failed", "passed"]),
  checkpointId: z.string().regex(identifierPattern).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().optional(),
  sourceFiles: z.array(
    z.object({
      filingId: z.string(),
      filename: z.string(),
      lines: z.number().int().nonnegative(),
    }),
  ),
  latestQualityArtifact: z.string().optional(),
  latestRepairArtifact: z.string().optional(),
}).transform((state) => ({
  ...state,
  knowledgeStage:
    state.knowledgeStage ?? (state.stage === "published" ? "baseline" : "empty"),
}));

function checkedIdentifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export class BuildStore {
  readonly varRoot: string;
  readonly buildsRoot: string;

  constructor(varRoot: string) {
    this.varRoot = path.resolve(varRoot);
    this.buildsRoot = path.join(this.varRoot, "builds");
  }

  buildRoot(buildId: string): string {
    return path.join(this.buildsRoot, checkedIdentifier(buildId, "build ID"));
  }

  checkpointRoot(buildId: string, checkpointId: string): string {
    return path.join(
      this.buildRoot(buildId),
      "checkpoints",
      checkedIdentifier(checkpointId, "checkpoint ID"),
    );
  }

  async createBaseline(): Promise<BuildState> {
    const current = await this.currentBaseline();
    if (current) return current;
    const now = new Date().toISOString();
    const state: BuildState = {
      buildId: `baseline-${randomUUID()}`,
      kind: "baseline",
      stage: "empty",
      knowledgeStage: "empty",
      qualityStatus: "not_run",
      createdAt: now,
      updatedAt: now,
      sourceFiles: [],
    };
    await mkdir(this.buildRoot(state.buildId), { recursive: true });
    await this.writeState(state);
    await atomicJson(path.join(this.buildsRoot, "current-baseline.json"), {
      buildId: state.buildId,
    });
    return state;
  }

  async currentBaseline(): Promise<BuildState | undefined> {
    try {
      const pointer = JSON.parse(
        await readFile(path.join(this.buildsRoot, "current-baseline.json"), "utf8"),
      );
      if (typeof pointer?.buildId !== "string") throw new Error("Invalid baseline pointer");
      return await this.load(pointer.buildId);
    } catch (error: any) {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async load(buildId: string): Promise<BuildState> {
    try {
      const raw = JSON.parse(
        await readFile(path.join(this.buildRoot(buildId), "build-state.json"), "utf8"),
      );
      const parsed = stateSchema.safeParse(raw);
      if (!parsed.success) throw new Error("Invalid build state");
      return parsed.data;
    } catch (error: any) {
      if (error instanceof SyntaxError || error?.name === "ZodError") {
        throw new Error("Invalid build state");
      }
      throw error;
    }
  }

  availableActions(state: BuildState): BuildAction[] {
    if (state.stage === "empty") return ["fetch"];
    if (state.stage === "fetched") return ["fetch", "ingest"];
    if (state.stage === "ingested") return ["fetch", "ingest", "compile"];
    if (state.stage === "compiled") {
      const actions: BuildAction[] = ["compile", "quality", "repair_citations"];
      if (state.qualityStatus === "passed") actions.push("publish");
      return actions;
    }
    return [];
  }

  async beginPhase(
    buildId: string,
    action: BuildAction,
    operationId: string = randomUUID(),
  ): Promise<PhaseTransaction> {
    const state = await this.load(buildId);
    checkedIdentifier(operationId, "operation ID");
    const temporaryRoot = path.join(
      this.buildRoot(buildId),
      "temporary",
      `${action}-${operationId}`,
    );
    await rm(temporaryRoot, { recursive: true, force: true });
    await mkdir(temporaryRoot, { recursive: true });
    if (state.checkpointId) {
      await cp(this.checkpointRoot(buildId, state.checkpointId), temporaryRoot, {
        recursive: true,
      });
    }
    return {
      buildId,
      action,
      operationId,
      previousCheckpointId: state.checkpointId,
      temporaryRoot,
    };
  }

  async commitPhase(transaction: PhaseTransaction, next: BuildState): Promise<BuildState> {
    if (next.buildId !== transaction.buildId) throw new Error("Build ID cannot change");
    const checkpointId = `${transaction.action}-${Date.now()}-${randomUUID()}`;
    const destination = this.checkpointRoot(transaction.buildId, checkpointId);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(transaction.temporaryRoot, destination);
    const committed: BuildState = {
      ...next,
      checkpointId,
      updatedAt: new Date().toISOString(),
    };
    await this.writeState(committed);
    return committed;
  }

  async failPhase(
    transaction: PhaseTransaction,
    artifact: FailureArtifact,
  ): Promise<void> {
    if (
      artifact.operationId !== transaction.operationId ||
      artifact.action !== transaction.action
    ) {
      throw new Error("Failure artifact does not match phase transaction");
    }
    const failureRoot = path.join(
      this.buildRoot(transaction.buildId),
      "failures",
      transaction.action,
      transaction.operationId,
    );
    await mkdir(failureRoot, { recursive: true });
    await atomicJson(path.join(failureRoot, "failure.json"), artifact);
    await rm(transaction.temporaryRoot, { recursive: true, force: true });
    await this.pruneFailures(transaction.buildId, transaction.action);
  }

  async listFailures(
    buildId: string,
    action: BuildAction,
  ): Promise<FailureArtifact[]> {
    const actionRoot = path.join(this.buildRoot(buildId), "failures", action);
    let operationIds: string[];
    try {
      operationIds = await readdir(actionRoot);
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const artifacts = await Promise.all(
      operationIds.map(async (operationId) =>
        JSON.parse(
          await readFile(path.join(actionRoot, operationId, "failure.json"), "utf8"),
        ),
      ),
    );
    return artifacts.sort((left, right) => right.failedAt.localeCompare(left.failedAt));
  }

  async pruneFailures(
    buildId: string,
    action: BuildAction,
    keep = 3,
  ): Promise<void> {
    const failures = await this.listFailures(buildId, action);
    for (const artifact of failures.slice(keep)) {
      await rm(
        path.join(
          this.buildRoot(buildId),
          "failures",
          action,
          checkedIdentifier(artifact.operationId, "operation ID"),
        ),
        { recursive: true, force: true },
      );
    }
  }

  async writeArtifact(
    buildId: string,
    category: string,
    artifactId: string,
    value: unknown,
  ): Promise<string> {
    checkedIdentifier(category, "artifact category");
    checkedIdentifier(artifactId, "artifact ID");
    const relativePath = path.join("artifacts", category, `${artifactId}.json`);
    await atomicJson(path.join(this.buildRoot(buildId), relativePath), value);
    return relativePath.replaceAll("\\", "/");
  }

  async readArtifact(buildId: string, relativePath: string): Promise<unknown> {
    const normalized = relativePath.replaceAll("\\", "/");
    if (
      normalized.startsWith("/") ||
      normalized.includes("../") ||
      !normalized.startsWith("artifacts/")
    ) {
      throw new Error("Invalid artifact path");
    }
    return JSON.parse(
      await readFile(path.join(this.buildRoot(buildId), normalized), "utf8"),
    );
  }

  async updateState(state: BuildState): Promise<BuildState> {
    const updated = { ...state, updatedAt: new Date().toISOString() };
    await this.writeState(updated);
    return updated;
  }

  private async writeState(state: BuildState): Promise<void> {
    const parsed = stateSchema.safeParse(state);
    if (!parsed.success) throw new Error("Invalid build state");
    await atomicJson(
      path.join(this.buildRoot(state.buildId), "build-state.json"),
      parsed.data,
    );
  }
}
