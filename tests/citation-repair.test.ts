import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  repairCitationText,
  repairWorkspaceCitations,
} from "../src/citation-repair.js";

const sources = [
  { filename: "nvidia-2026-10k.md", lines: 100 },
  { filename: "amd-2026-10k.md", lines: 80 },
];

describe("citation repair", () => {
  it("normalizes supported syntax and unique aliases", () => {
    const result = repairCitationText(
      "Claim ^[NVIDIA 10-K: lines 10–20]. Another ^[amd-2026-10k.md#L3–L5].",
      sources,
      "page.md",
    );
    expect(result.text).toBe(
      "Claim ^[nvidia-2026-10k.md:10-20]. Another ^[amd-2026-10k.md#L3-L5].",
    );
    expect(result.repairs).toHaveLength(2);
  });

  it("removes only an invalid range when its source is certain", () => {
    const result = repairCitationText(
      "Claim ^[nvidia-2026-10k.md:90-120].",
      sources,
      "page.md",
    );
    expect(result.text).toBe("Claim ^[nvidia-2026-10k.md].");
    expect(result.repairs[0]?.reason).toBe("removed-invalid-range");
  });

  it("leaves unknown or ambiguous sources unchanged", () => {
    const ambiguous = [
      { filename: "nvidia-2025-10k.md", lines: 100 },
      { filename: "nvidia-2026-10k.md", lines: 100 },
    ];
    const input = "Claims ^[NVIDIA 10-K:10-20] and ^[mystery.md:1-2].";
    const result = repairCitationText(input, ambiguous, "page.md");
    expect(result.text).toBe(input);
    expect(result.repairs).toEqual([]);
    expect(result.unresolved).toHaveLength(2);
  });

  it("is idempotent", () => {
    const first = repairCitationText(
      "Claim ^[NVIDIA 10-K: lines 10–20].",
      sources,
      "page.md",
    );
    const second = repairCitationText(first.text, sources, "page.md");
    expect(second.text).toBe(first.text);
    expect(second.repairs).toEqual([]);
  });

  it("repairs workspace pages and records page line numbers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-repair-"));
    await mkdir(path.join(root, "sources"), { recursive: true });
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true });
    await writeFile(
      path.join(root, "sources", "nvidia-2026-10k.md"),
      Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"),
      "utf8",
    );
    const page = path.join(root, "wiki", "concepts", "strategy.md");
    await writeFile(page, "# Strategy\n\nClaim ^[NVIDIA 10-K: lines 2–4].\n", "utf8");

    const result = await repairWorkspaceCitations(root);

    expect(await readFile(page, "utf8")).toContain("^[nvidia-2026-10k.md:2-4]");
    expect(result.repairs[0]).toEqual(
      expect.objectContaining({ page: "wiki/concepts/strategy.md", line: 3 }),
    );
  });
});
