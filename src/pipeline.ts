import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OperationPhase, OperationType } from "./app.js";
import type { SecFiling } from "./sec.js";

const REQUIRED_PAGES = [
  "ai-semiconductor-landscape",
  "company-strategy-comparison",
  "supply-chain-and-geopolitical-risk",
];

export interface ManifestFiling extends SecFiling {
  role: OperationType;
}

export interface PipelineWiki {
  ingestText(input: { text: string; title: string }): Promise<unknown>;
  compile(options: { concurrency: number }): Promise<any>;
  lint(): Promise<any>;
  fastEval(): Promise<any>;
  exportJson(): Promise<any>;
}

export interface PipelineDependencies {
  manifest: ManifestFiling[];
  wiki: PipelineWiki;
  fetchFiling(filing: ManifestFiling): Promise<{
    markdown: string;
    receipt: unknown;
  }>;
  report(phase: OperationPhase, detail?: Record<string, unknown>): void;
  writeReceipts(receipts: unknown[]): Promise<void> | void;
}

function mapPages(exported: any): Map<string, any> {
  return new Map((exported.pages ?? []).map((page: any) => [page.slug, page]));
}

function changes(before: any, after: any) {
  const oldPages = mapPages(before);
  const newPages = mapPages(after);
  const created: any[] = [];
  const updated: any[] = [];
  const unchanged: string[] = [];
  const highlights: any[] = [];
  for (const [slug, page] of newPages) {
    const old = oldPages.get(slug);
    const descriptor = { slug, title: page.title, kind: page.kind ?? "concept" };
    if (!old) created.push(descriptor);
    else if (old.body !== page.body) updated.push(descriptor);
    else unchanged.push(slug);
    if (old && old.body !== page.body) {
      const oldParagraphs = String(old.body ?? "").split(/\n\s*\n/);
      const newParagraphs = String(page.body ?? "").split(/\n\s*\n/);
      for (const [index, paragraph] of newParagraphs.entries()) {
        const citation = paragraph.match(/\^\[([^\]]*nvidia-q1-fy2027-10q[^\]]*)\]/i);
        if (citation && !oldParagraphs.includes(paragraph)) {
          highlights.push({
            page: slug,
            before: oldParagraphs[index] ?? "",
            after: paragraph,
            citation: citation[1],
          });
        }
      }
    }
  }
  return { created, updated, unchanged, highlights };
}

export async function runPipeline(
  type: OperationType,
  dependencies: PipelineDependencies,
): Promise<any> {
  const filings = dependencies.manifest.filter((filing) => filing.role === type);
  if (filings.length === 0) throw new Error(`No ${type} filings are pinned`);
  const before = await dependencies.wiki.exportJson();
  const receipts: unknown[] = [];
  let normalizedCharacters = 0;
  for (const filing of filings) {
    dependencies.report("fetch", { filing: filing.id });
    const fetched = await dependencies.fetchFiling(filing);
    normalizedCharacters += fetched.markdown.length;
    if (normalizedCharacters > 750_000) {
      throw new Error("Combined normalized SEC corpus exceeds 750,000 characters");
    }
    dependencies.report("normalize", {
      filing: filing.id,
      characters: fetched.markdown.length,
    });
    receipts.push({ filing: filing.id, ...((fetched.receipt as object) ?? {}) });
    dependencies.report("ingest", { filing: filing.id });
    await dependencies.wiki.ingestText({
      text: fetched.markdown,
      title: filing.outputFile.replace(/\.md$/i, ""),
    });
  }
  await dependencies.writeReceipts(receipts);
  let compiled: any;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    dependencies.report("compile", {
      sources: filings.length,
      concurrency: 2,
      attempt,
    });
    compiled = await dependencies.wiki.compile({ concurrency: 2 });
    const errors: string[] = compiled.errors ?? [];
    if (errors.length === 0) break;
    const onlyInvalidPages = errors.every((error) =>
      /^Invalid page for ".+" — failed validation$/.test(error),
    );
    if (!onlyInvalidPages || attempt === 3) throw new Error(errors.join("; "));
  }
  dependencies.report("quality");
  const lint = await dependencies.wiki.lint();
  const structural = (lint.results ?? []).filter((item: any) => {
    const rule = String(item.rule ?? item.code ?? "").toLowerCase();
    return (
      rule.includes("citation") &&
      String(item.severity ?? "error").toLowerCase() === "error"
    );
  });
  if (structural.length > 0) {
    const rules = [...new Set(structural.map((item: any) => item.rule ?? item.code))];
    throw new Error(
      `Citation lint failed with ${structural.length} result(s): ${rules.join(", ")}`,
    );
  }
  const evaluation = await dependencies.wiki.fastEval();
  dependencies.report("export");
  const exported = await dependencies.wiki.exportJson();
  const slugs = new Set((exported.pages ?? []).map((page: any) => page.slug));
  const missing = REQUIRED_PAGES.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) throw new Error(`Required page missing: ${missing.join(", ")}`);
  return {
    compile: compiled,
    lint,
    evaluation,
    receipts,
    export: exported,
    changes: changes(before, exported),
    highlights: changes(before, exported).highlights,
  };
}

export async function writeRuntimeReceipts(
  workspaceRoot: string,
  receipts: unknown[],
): Promise<void> {
  const path = join(workspaceRoot, ".llmwiki", "fetch-receipts.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipts, null, 2)}\n`, "utf8");
}
