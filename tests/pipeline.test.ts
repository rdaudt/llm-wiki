import { describe, expect, it, vi } from "vitest";
import { runPipeline, type PipelineWiki } from "../src/pipeline.js";

const manifest = [
  { id: "annual-a", role: "baseline", outputFile: "annual-a.md" },
  { id: "annual-b", role: "baseline", outputFile: "annual-b.md" },
  { id: "annual-c", role: "baseline", outputFile: "annual-c.md" },
  { id: "quarter", role: "delta", outputFile: "nvidia-q1-fy2027-10q.md" },
] as any[];

function wiki(overrides: Partial<PipelineWiki> = {}): PipelineWiki {
  return {
    ingestText: vi.fn().mockResolvedValue({}),
    compile: vi.fn().mockResolvedValue({ errors: [], pages: [] }),
    lint: vi.fn().mockResolvedValue({ errors: 0, warnings: 0, results: [] }),
    fastEval: vi.fn().mockResolvedValue({ health: {}, citationCoverage: {} }),
    exportJson: vi.fn().mockResolvedValue({
      pages: [
        { slug: "ai-semiconductor-landscape", body: "", citations: [] },
        { slug: "company-strategy-comparison", body: "", citations: [] },
        { slug: "supply-chain-and-geopolitical-risk", body: "", citations: [] },
      ],
    }),
    ...overrides,
  };
}

describe("live compiler pipeline", () => {
  it("ingests only baseline filings and compiles with concurrency two", async () => {
    const client = wiki();
    const phases: string[] = [];
    const result = await runPipeline("baseline", {
      manifest,
      wiki: client,
      fetchFiling: vi.fn(async (filing: any) => ({
        markdown: `# ${filing.id}`,
        receipt: { timestamp: "now", chars: 3, sha256: "hash" },
      })),
      report: (phase) => phases.push(phase),
      writeReceipts: vi.fn(),
    });
    expect(client.ingestText).toHaveBeenCalledTimes(3);
    expect(client.ingestText).toHaveBeenNthCalledWith(1, {
      text: "# annual-a",
      title: "annual-a",
    });
    expect(client.ingestText).toHaveBeenNthCalledWith(2, {
      text: "# annual-b",
      title: "annual-b",
    });
    expect(client.ingestText).toHaveBeenNthCalledWith(3, {
      text: "# annual-c",
      title: "annual-c",
    });
    expect(client.compile).toHaveBeenCalledWith({ concurrency: 2 });
    expect(phases).toEqual(
      expect.arrayContaining(["fetch", "normalize", "ingest", "compile", "quality", "export"]),
    );
    expect(result.receipts).toHaveLength(3);
  });

  it("rejects compiler errors, missing required pages, and broken structure", async () => {
    await expect(
      runPipeline("baseline", {
        manifest,
        wiki: wiki({
          compile: vi.fn().mockResolvedValue({ errors: ["provider failed"] }),
        }),
        fetchFiling: vi.fn(async () => ({
          markdown: "text",
          receipt: {},
        })),
        report: vi.fn(),
        writeReceipts: vi.fn(),
      }),
    ).rejects.toThrow(/provider failed/);

    await expect(
      runPipeline("baseline", {
        manifest,
        wiki: wiki({ exportJson: vi.fn().mockResolvedValue({ pages: [] }) }),
        fetchFiling: vi.fn(async () => ({ markdown: "text", receipt: {} })),
        report: vi.fn(),
        writeReceipts: vi.fn(),
      }),
    ).rejects.toThrow(/required page/i);

    await expect(
      runPipeline("baseline", {
        manifest,
        wiki: wiki({
          lint: vi.fn().mockResolvedValue({
            errors: 1,
            results: [{ rule: "broken-citation", severity: "error" }],
          }),
        }),
        fetchFiling: vi.fn(async () => ({ markdown: "text", receipt: {} })),
        report: vi.fn(),
        writeReceipts: vi.fn(),
      }),
    ).rejects.toThrow(/lint/i);
  });

  it("surfaces unresolved generated wikilinks without aborting the live build", async () => {
    const result = await runPipeline("baseline", {
      manifest,
      wiki: wiki({
        lint: vi.fn().mockResolvedValue({
          errors: 1,
          warnings: 0,
          results: [{ rule: "broken-wikilink", severity: "error" }],
        }),
      }),
      fetchFiling: vi.fn(async () => ({ markdown: "text", receipt: {} })),
      report: vi.fn(),
      writeReceipts: vi.fn(),
    });
    expect(result.lint.results).toHaveLength(1);
  });

  it("retries transient invalid generated pages before accepting compilation", async () => {
    const client = wiki({
      compile: vi
        .fn()
        .mockResolvedValueOnce({
          errors: ['Invalid page for "Intel segments" — failed validation'],
        })
        .mockResolvedValueOnce({ errors: [], pages: [] }),
    });
    await runPipeline("baseline", {
      manifest,
      wiki: client,
      fetchFiling: vi.fn(async () => ({ markdown: "text", receipt: {} })),
      report: vi.fn(),
      writeReceipts: vi.fn(),
    });
    expect(client.compile).toHaveBeenCalledTimes(2);
  });

  it("caps the combined normalized corpus at 750,000 characters", async () => {
    await expect(
      runPipeline("baseline", {
        manifest,
        wiki: wiki(),
        fetchFiling: vi.fn(async () => ({
          markdown: "x".repeat(260_000),
          receipt: {},
        })),
        report: vi.fn(),
        writeReceipts: vi.fn(),
      }),
    ).rejects.toThrow(/750,000/);
  });
});
