import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QualityFinding } from "./build-types.js";

export interface CitationSource {
  filename: string;
  lines: number;
}

export interface CitationRepair {
  page: string;
  line: number;
  before: string;
  after: string;
  reason:
    | "normalized-syntax"
    | "unique-filename-alias"
    | "removed-invalid-range";
}

export interface CitationRepairResult {
  text: string;
  repairs: CitationRepair[];
  unresolved: QualityFinding[];
}

const markerPattern = /\^\[([^\]\n]+)\]/g;
const entryPattern =
  /^(.*?)(?:(?::\s*(?:lines?\s*)?(\d+)(?:\s*-\s*(\d+))?)|(?:#L(\d+)(?:\s*-\s*L(\d+))?))$/i;
const multiRangePattern =
  /^([^,]+?):\s*(\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)+)$/;

function alias(value: string): string {
  return value
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function resolveSource(
  token: string,
  sources: CitationSource[],
): CitationSource | undefined {
  const exact = sources.find(
    (source) => source.filename.toLowerCase() === token.trim().toLowerCase(),
  );
  if (exact) return exact;
  const normalized = alias(token);
  const matches = sources.filter((source) => alias(source.filename) === normalized);
  return matches.length === 1 ? matches[0] : undefined;
}

function splitEntries(inner: string): string[] {
  return inner
    .split(/,\s*(?=[^,\]]+?\.md(?:\s*[:#]|\s*(?:,|$)))/i)
    .map((entry) => entry.trim());
}

function markerLine(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

export function repairCitationText(
  text: string,
  sources: CitationSource[],
  page: string,
): CitationRepairResult {
  const repairs: CitationRepair[] = [];
  const unresolved: QualityFinding[] = [];
  markerPattern.lastIndex = 0;
  const transformed = text.replace(markerPattern, (before, inner: string, offset: number) => {
    const line = markerLine(text, offset);
    const normalizedInner = inner.replace(/[–—]/g, "-");
    const entries = multiRangePattern.test(normalizedInner)
      ? [inner.trim()]
      : splitEntries(inner);
    const rewritten: string[] = [];
    let markerReason: CitationRepair["reason"] | undefined;
    let unresolvedMarker = false;
    for (const originalEntry of entries) {
      const normalizedDashes = originalEntry.replace(/[–—]/g, "-");
      const multiRange = multiRangePattern.exec(normalizedDashes);
      if (multiRange) {
        const source = resolveSource(multiRange[1]!.trim(), sources);
        if (!source) {
          rewritten.push(originalEntry);
          unresolvedMarker = true;
          continue;
        }
        const ranges = multiRange[2]!.split(/\s*,\s*/).map((range) => {
          const [startToken, endToken = startToken] = range.split(/\s*-\s*/);
          return { start: Number(startToken), end: Number(endToken) };
        });
        if (
          ranges.some(
            ({ start, end }) =>
              start < 1 || end < start || end > source.lines,
          )
        ) {
          rewritten.push(source.filename);
          markerReason = "removed-invalid-range";
          continue;
        }
        rewritten.push(
          ...ranges.map(
            ({ start, end }) => `${source.filename}:${start}-${end}`,
          ),
        );
        if (!markerReason) {
          markerReason =
            source.filename.toLowerCase() === multiRange[1]!.trim().toLowerCase()
              ? "normalized-syntax"
              : "unique-filename-alias";
        }
        continue;
      }
      const match = entryPattern.exec(normalizedDashes);
      const fileToken = (match?.[1] ?? normalizedDashes).trim();
      const source = resolveSource(fileToken, sources);
      if (!source) {
        rewritten.push(originalEntry);
        unresolvedMarker = true;
        continue;
      }

      const startToken = match?.[2] ?? match?.[4];
      const endToken = match?.[3] ?? match?.[5] ?? startToken;
      if (startToken) {
        const start = Number(startToken);
        const end = Number(endToken);
        if (start < 1 || end < start || end > source.lines) {
          rewritten.push(source.filename);
          markerReason = "removed-invalid-range";
          continue;
        }
        const hashStyle = match?.[4] !== undefined;
        rewritten.push(
          hashStyle
            ? `${source.filename}#L${start}-L${end}`
            : `${source.filename}:${start}-${end}`,
        );
      } else {
        rewritten.push(source.filename);
      }
      if (!markerReason) {
        markerReason =
          source.filename.toLowerCase() === fileToken.toLowerCase()
            ? "normalized-syntax"
            : "unique-filename-alias";
      }
    }
    const after = `^[${rewritten.join(", ")}]`;
    if (unresolvedMarker) {
      unresolved.push({
        rule: "unresolved-citation-repair",
        severity: "error",
        page,
        line,
        citation: before,
        message: `Citation could not be mapped unambiguously: ${before}`,
      });
    }
    if (after !== before && markerReason) {
      repairs.push({ page, line, before, after, reason: markerReason });
    }
    return after;
  });
  return { text: transformed, repairs, unresolved };
}

async function markdownFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(directory, entry.name));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function repairWorkspaceCitations(
  root: string,
): Promise<{ repairs: CitationRepair[]; unresolved: QualityFinding[] }> {
  const sourcePaths = await markdownFiles(path.join(root, "sources"));
  const sources = await Promise.all(
    sourcePaths.map(async (sourcePath) => {
      const content = await readFile(sourcePath, "utf8");
      return {
        filename: path.basename(sourcePath),
        lines: content.length === 0 ? 0 : content.split("\n").length,
      };
    }),
  );
  const pages = [
    ...(await markdownFiles(path.join(root, "wiki", "concepts"))),
    ...(await markdownFiles(path.join(root, "wiki", "queries"))),
  ];
  const repairs: CitationRepair[] = [];
  const unresolved: QualityFinding[] = [];
  for (const pagePath of pages) {
    const relativePage = path.relative(root, pagePath).replaceAll("\\", "/");
    const content = await readFile(pagePath, "utf8");
    const result = repairCitationText(content, sources, relativePage);
    if (result.text !== content) await writeFile(pagePath, result.text, "utf8");
    repairs.push(...result.repairs);
    unresolved.push(...result.unresolved);
  }
  return { repairs, unresolved };
}
