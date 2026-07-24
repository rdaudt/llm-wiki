export type BuildStage = "empty" | "fetched" | "ingested" | "compiled" | "published";
export type QualityStatus = "not_run" | "failed" | "passed";
export type BuildAction =
  | "fetch"
  | "ingest"
  | "compile"
  | "quality"
  | "repair_citations"
  | "publish";

export interface BuildSourceFile {
  filingId: string;
  filename: string;
  lines: number;
}

export interface BuildState {
  buildId: string;
  kind: "baseline";
  stage: BuildStage;
  qualityStatus: QualityStatus;
  checkpointId?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  sourceFiles: BuildSourceFile[];
  latestQualityArtifact?: string;
}

export interface PhaseTransaction {
  buildId: string;
  action: BuildAction;
  operationId: string;
  previousCheckpointId?: string;
  temporaryRoot: string;
}

export interface FailureArtifact {
  operationId: string;
  action: BuildAction;
  failedAt: string;
  error: { message: string };
  diagnostics: unknown[];
}

