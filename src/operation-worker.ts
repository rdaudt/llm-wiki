import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OperationPhase, OperationType } from "./app.js";
import { CompilerClient } from "./compiler-client.js";
import {
  runPipeline,
  writeRuntimeReceipts,
  type ManifestFiling,
} from "./pipeline.js";
import { fetchAndNormalizeSecFiling } from "./sec.js";

const type = process.argv[2] as OperationType;
if (!["baseline", "delta"].includes(type)) throw new Error("invalid operation type");
const workspaceRoot = process.env.WIKI_ROOT;
if (!workspaceRoot) throw new Error("WIKI_ROOT is required");

const send = (message: unknown) => process.send?.(message);

try {
  const manifest = JSON.parse(
    await readFile(resolve(process.cwd(), "corpus", "manifest.json"), "utf8"),
  ) as ManifestFiling[];
  const result = await runPipeline(type, {
    manifest,
    wiki: new CompilerClient(workspaceRoot),
    fetchFiling: (filing) => fetchAndNormalizeSecFiling(filing),
    report: (phase: OperationPhase, detail?: Record<string, unknown>) =>
      send({ kind: "progress", phase, detail }),
    writeReceipts: (receipts) => writeRuntimeReceipts(workspaceRoot, receipts),
  });
  send({ kind: "result", result });
  process.exitCode = 0;
} catch (error) {
  send({ kind: "error", error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
