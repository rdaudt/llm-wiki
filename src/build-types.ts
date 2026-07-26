export type BuildStage = "empty" | "fetched" | "ingested" | "compiled" | "published";
export type QualityStatus = "not_run" | "failed" | "passed";
export type KnowledgeStage = "empty" | "baseline" | "post_delta";
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
  knowledgeStage: KnowledgeStage;
  qualityStatus: QualityStatus;
  checkpointId?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  sourceFiles: BuildSourceFile[];
  latestQualityArtifact?: string;
  latestRepairArtifact?: string;
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

export type BuildWorkerRequest =
  | { action: "fetch"; buildId: string; targetRoot: string }
  | { action: "ingest"; buildId: string; targetRoot: string }
  | { action: "compile"; buildId: string; targetRoot: string }
  | { action: "repair_citations"; buildId: string; targetRoot: string };

export type BuildWorkerResult =
  | { action: "fetch"; filings: number }
  | { action: "ingest"; sourceFiles: BuildSourceFile[] }
  | { action: "compile"; pages: string[] }
  | {
      action: "repair_citations";
      repairs: import("./citation-repair.js").CitationRepair[];
      unresolved: QualityFinding[];
    };

export interface QualityFinding {
  rule: string;
  severity: string;
  page: string;
  line?: number;
  citation?: string;
  message: string;
}

export interface QualityArtifact {
  createdAt: string;
  passed: boolean;
  findings: QualityFinding[];
  lint: unknown;
  evaluation: unknown;
  truncated: boolean;
}
