import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CompilerClient } from "./compiler-client.js";
import type {
  BuildSourceFile,
  BuildWorkerRequest,
  BuildWorkerResult,
} from "./build-types.js";
import type { ManifestFiling } from "./pipeline.js";
import { fetchAndNormalizeSecFiling } from "./sec.js";
import { repairWorkspaceCitations } from "./citation-repair.js";

const REQUIRED_PAGES = [
  "ai-semiconductor-landscape",
  "company-strategy-comparison",
  "supply-chain-and-geopolitical-risk",
];

type Progress = (phase: string, detail?: Record<string, unknown>) => void;

async function baselineManifest(): Promise<ManifestFiling[]> {
  const manifest = JSON.parse(
    await readFile(path.resolve(process.cwd(), "corpus", "manifest.json"), "utf8"),
  ) as ManifestFiling[];
  return manifest.filter((filing) => filing.role === "baseline");
}

async function fetchPhase(
  request: BuildWorkerRequest & { action: "fetch" },
  report: Progress,
): Promise<BuildWorkerResult> {
  const filings = await baselineManifest();
  const corpusRoot = path.join(request.targetRoot, "corpus");
  await mkdir(corpusRoot, { recursive: true });
  const receipts: unknown[] = [];
  let totalCharacters = 0;
  for (const filing of filings) {
    report("fetch", { filing: filing.id });
    const fetched = await fetchAndNormalizeSecFiling(filing);
    totalCharacters += fetched.markdown.length;
    if (totalCharacters > 750_000) {
      throw new Error("Combined normalized SEC corpus exceeds 750,000 characters");
    }
    report("normalize", { filing: filing.id, characters: fetched.markdown.length });
    await writeFile(path.join(corpusRoot, filing.outputFile), fetched.markdown, "utf8");
    receipts.push({ filing: filing.id, ...((fetched.receipt as object) ?? {}) });
  }
  await writeFile(
    path.join(corpusRoot, "receipts.json"),
    `${JSON.stringify(receipts, null, 2)}\n`,
    "utf8",
  );
  return { action: "fetch", filings: filings.length };
}

async function ingestPhase(
  request: BuildWorkerRequest & { action: "ingest" },
  report: Progress,
): Promise<BuildWorkerResult> {
  const filings = await baselineManifest();
  const workspace = path.join(request.targetRoot, "workspace");
  await mkdir(path.join(workspace, ".llmwiki"), { recursive: true });
  await cp(
    path.resolve(process.cwd(), "wiki", "schema.yaml"),
    path.join(workspace, ".llmwiki", "schema.yaml"),
  );
  const wiki = new CompilerClient(workspace);
  const sourceFiles: BuildSourceFile[] = [];
  for (const filing of filings) {
    report("ingest", { filing: filing.id });
    const markdown = await readFile(
      path.join(request.targetRoot, "corpus", filing.outputFile),
      "utf8",
    );
    const ingested = (await wiki.ingestText({
      text: markdown,
      title: filing.outputFile.replace(/\.md$/i, ""),
    })) as { filename?: string };
    if (!ingested.filename) throw new Error(`Ingest did not return a filename for ${filing.id}`);
    await readFile(path.join(workspace, "sources", ingested.filename), "utf8");
    sourceFiles.push({
      filingId: filing.id,
      filename: ingested.filename,
      lines: markdown.split("\n").length,
    });
  }
  await wiki.status();
  return { action: "ingest", sourceFiles };
}

async function compilePhase(
  request: BuildWorkerRequest & { action: "compile" },
  report: Progress,
): Promise<BuildWorkerResult> {
  const wiki = new CompilerClient(path.join(request.targetRoot, "workspace"));
  let compiled: any;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    report("compile", { concurrency: 2, attempt });
    compiled = await wiki.compile({ concurrency: 2 });
    const errors: string[] = compiled.errors ?? [];
    if (errors.length === 0) break;
    const retryable = errors.every((error) =>
      /^Invalid page for ".+" — failed validation$/.test(error),
    );
    if (!retryable || attempt === 3) throw new Error(errors.join("; "));
  }
  const exported = await wiki.exportJson();
  const pages = (exported.pages ?? []).map((page: any) => String(page.slug));
  const missing = REQUIRED_PAGES.filter((slug) => !pages.includes(slug));
  if (missing.length > 0) throw new Error(`Required page missing: ${missing.join(", ")}`);
  return { action: "compile", pages };
}

export async function runBuildWorkerRequest(
  request: BuildWorkerRequest,
  report: Progress = () => undefined,
): Promise<BuildWorkerResult> {
  if (request.action === "fetch") return fetchPhase(request, report);
  if (request.action === "ingest") return ingestPhase(request, report);
  if (request.action === "compile") return compilePhase(request, report);
  report("repair_citations");
  const repaired = await repairWorkspaceCitations(
    path.join(request.targetRoot, "workspace"),
  );
  return { action: "repair_citations", ...repaired };
}

const serialized = process.env.BUILD_WORKER_REQUEST;
if (serialized) {
  const send = (message: unknown) => process.send?.(message);
  try {
    const request = JSON.parse(serialized) as BuildWorkerRequest;
    const result = await runBuildWorkerRequest(request, (phase, detail) =>
      send({ kind: "progress", phase, detail }),
    );
    send({ kind: "result", result });
  } catch (error) {
    send({ kind: "error", error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}
