import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";

export const MAX_NORMALIZED_CHARS = 500_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export interface SecFiling {
  id: string;
  company: string;
  cik: string;
  accession: string;
  form: "10-K" | "10-Q";
  filedOn: string;
  periodEnd: string;
  secIndexUrl: string;
  primaryDocumentUrl: string;
  includedSections: string[];
  outputFile: string;
}

export interface NormalizedSecFiling {
  markdown: string;
  chars: number;
  sha256: string;
}

export interface SecReceipt {
  timestamp: string;
  receivedAt: string;
  chars: number;
  sha256: string;
}

export interface FetchedSecFiling extends NormalizedSecFiling {
  receipt: SecReceipt;
}

export interface SecFetchOptions {
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
  maxBytes?: number;
  now?: () => Date;
}

interface Block {
  element: Element;
  text: string;
}

interface Heading {
  index: number;
  key?: string;
  title?: string;
  explicit?: boolean;
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizedDate(value: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numeric) {
    return `${numeric[3]}-${numeric[1]!.padStart(2, "0")}-${numeric[2]!.padStart(2, "0")}`;
  }
  const named = value.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!named) return undefined;
  const month = new Date(`${named[1]} 1, 2000 UTC`).getUTCMonth();
  if (Number.isNaN(month)) return undefined;
  return `${named[3]}-${String(month + 1).padStart(2, "0")}-${named[2]!.padStart(2, "0")}`;
}

function dateInText(text: string, expression: RegExp): string | undefined {
  const match = text.match(expression);
  return match?.[1] ? normalizedDate(match[1]) : undefined;
}

function validateFilingMetadata(text: string, filing: SecFiling): void {
  const form = text.match(/FORM\s+(10-K|10-Q)(?:\s|$)/i)?.[1]?.toUpperCase();
  if (form !== filing.form) throw new Error(`SEC filing form does not match manifest: expected ${filing.form}`);

  const accession = text.match(
    /\b(?:SEC\s+)?ACCESSION(?:\s+(?:NUMBER|NO\.?))?\s*:?\s*(\d{10}-\d{2}-\d{6})\b/i,
  )?.[1];
  if (accession !== filing.accession) throw new Error("SEC filing accession does not match manifest");

  const datePattern =
    "(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}|[A-Za-z]+\\s+\\d{1,2},\\s*\\d{4})";
  const filedOn = dateInText(text, new RegExp(`\\b(?:filed(?:\\s+on)?|filing\\s+date)\\s*:?\\s*${datePattern}`, "i"));
  if (filedOn !== filing.filedOn) throw new Error("SEC filing filed date does not match manifest");

  const periodEnd = dateInText(
    text,
    new RegExp(`\\b(?:(?:fiscal\\s+year|quarterly\\s+period|period)\\s+ended|period\\s+of\\s+report)\\s*:?\\s*${datePattern}`, "i"),
  );
  if (periodEnd !== filing.periodEnd) throw new Error("SEC filing report period does not match manifest");
}

function isLeafBlock(element: Element): boolean {
  return !element.querySelector("p,h1,h2,h3,h4,h5,h6,li,table");
}

function isLargeTableHeading(element: Element): boolean {
  return [...element.querySelectorAll<HTMLElement>("span[style]")].some((span) => {
    const size = span.style.fontSize.match(/^(\d+(?:\.\d+)?)pt$/)?.[1];
    return size !== undefined && Number(size) >= 12;
  });
}

function blocksFor(document: Document): Block[] {
  return [...document.body.querySelectorAll("p,h1,h2,h3,h4,h5,h6,div,li,table")]
    .filter(isLeafBlock)
    .filter((element) => !element.querySelector('a[href^="#"]'))
    .filter(
      (element) =>
        element.tagName.toLowerCase() === "table" ||
        element.closest("td") === null ||
        isLargeTableHeading(element),
    )
    .map((element) => ({ element, text: cleanText(element.textContent ?? "") }))
    .filter((block) => block.text.length > 0);
}

function sectionFromText(text: string, currentPart: string | undefined, form: SecFiling["form"]): Omit<Heading, "index"> {
  if (form === "10-K") {
    const title = text.replace(/:$/, "").trim();
    const annualTitles: Array<[RegExp, string, string]> = [
      [/^(?:Our )?Business$/i, "item 1", "Item 1. Business"],
      [/^Risk Factors$/i, "item 1a", "Item 1A. Risk Factors"],
      [/^Unresolved Staff Comments$/i, "item 1b", "Item 1B. Unresolved Staff Comments"],
      [/^Cybersecurity$/i, "item 1c", "Item 1C. Cybersecurity"],
      [/^Properties$/i, "item 2", "Item 2. Properties"],
      [
        /^Management['’]s Discussion and Analysis(?: of Financial Condition and Results of Operations)?$/i,
        "item 7",
        "Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations",
      ],
      [
        /^(?:Quantitative and Qualitative Disclosures About )?Market Risk$/i,
        "item 7a",
        "Item 7A. Quantitative and Qualitative Disclosures About Market Risk",
      ],
      [
        /^Financial Statements(?: and Supplementary Data)?$/i,
        "item 8",
        "Item 8. Financial Statements and Supplementary Data",
      ],
    ];
    const known = annualTitles.find(([pattern]) => pattern.test(title));
    if (known) return { key: known[1], title: known[2], explicit: false };
  }
  const combined = text.match(/^Part\s+([IVX]+)\s*(?:[.:\-–]\s*)?Item\s+(\d+[A-Z]?)\b\s*[.:\-–]?\s*(.*)$/i);
  const item = text.match(/^Item\s+(\d+[A-Z]?)\b\s*[.:\-–]?\s*(.*)$/i);
  const match = combined ?? item;
  if (!match) return {};
  const part = combined?.[1]?.toUpperCase() ?? currentPart;
  const number = (combined?.[2] ?? item?.[1])!.toUpperCase();
  const detail = cleanText(combined?.[3] ?? item?.[2] ?? "");
  const key = form === "10-Q" && part ? `part ${part.toLowerCase()} item ${number.toLowerCase()}` : `item ${number.toLowerCase()}`;
  const prefix = form === "10-Q" && part ? `Part ${part} Item ${number}` : `Item ${number}`;
  return { key, title: detail ? `${prefix}. ${detail}` : prefix, explicit: true };
}

function headingRecords(blocks: Block[], form: SecFiling["form"]): Heading[] {
  let currentPart: string | undefined;
  const headings: Heading[] = [];
  for (const [index, block] of blocks.entries()) {
    if (block.element.tagName.toLowerCase() === "table") continue;
    const part = block.text.match(/^Part\s+([IVX]+)\b/i)?.[1]?.toUpperCase();
    if (part) currentPart = part;
    const section = sectionFromText(block.text, currentPart, form);
    if (section.key && block.text.length <= 240) headings.push({ index, ...section });
    else if (part) headings.push({ index });
  }
  return headings;
}

function requiredKey(section: string): string {
  return cleanText(section).toLowerCase().replace(/\./g, "");
}

function tableMarkdown(table: Element): string {
  const rows = [...table.querySelectorAll("tr")]
    .map((row) => [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) => cleanText(cell.textContent ?? "")))
    .filter((row) => row.length > 0);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row: string[]) => row.concat(Array(width - row.length).fill("")).map((cell) => cell.replace(/\|/g, "\\|"));
  const first = normalizeRow(rows[0]!);
  const data = rows.slice(1).map(normalizeRow);
  return [`| ${first.join(" | ")} |`, `| ${first.map(() => "---").join(" | ")} |`, ...data.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function blockMarkdown(block: Block): string {
  if (block.element.tagName.toLowerCase() === "table") return tableMarkdown(block.element);
  return block.element.tagName.toLowerCase() === "li" ? `- ${block.text}` : block.text;
}

function normalizeSecFilingHtml(html: string, filing: SecFiling, validateMetadata: boolean): NormalizedSecFiling {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const blocks = blocksFor(document);
  if (validateMetadata) validateFilingMetadata(blocks.map((block) => block.text).join(" "), filing);
  const headings = headingRecords(blocks, filing.form);
  const sections = filing.includedSections.map((requested) => {
    const matches = headings.filter((heading) => heading.key === requiredKey(requested));
    if (matches.length === 0) throw new Error(`Requested SEC section is missing: ${requested}`);
    const explicitMatches = matches.filter((heading) => heading.explicit);
    const preferred = explicitMatches.length > 0 ? explicitMatches : matches;
    if (preferred.length > 1) throw new Error(`Requested SEC section is ambiguous: ${requested}`);
    const heading = preferred[0]!;
    const next = headings.find(
      (candidate) =>
        candidate.index > heading.index && candidate.key !== heading.key,
    );
    const content = blocks.slice(heading.index + 1, next?.index).map(blockMarkdown).filter(Boolean);
    if (content.length === 0) throw new Error(`Requested SEC section has no content: ${requested}`);
    return [`## ${heading.title}`, ...content].join("\n\n");
  });
  const markdown = [
    "---",
    `company: ${filing.company}`,
    `cik: \"${filing.cik}\"`,
    `accession: \"${filing.accession}\"`,
    `form: ${filing.form}`,
    `filed_on: ${filing.filedOn}`,
    `period_end: ${filing.periodEnd}`,
    `original_url: ${filing.primaryDocumentUrl}`,
    "---",
    "",
    `# ${filing.company} ${filing.form}`,
    "",
    sections.join("\n\n"),
    "",
  ].join("\n").replace(/\r\n?/g, "\n");
  if (markdown.length > MAX_NORMALIZED_CHARS) throw new Error(`Normalized SEC text exceeds ${MAX_NORMALIZED_CHARS.toLocaleString("en-US")} characters`);
  return { markdown, chars: markdown.length, sha256: createHash("sha256").update(markdown, "utf8").digest("hex") };
}

export function normalizeSecFiling(html: string, filing: SecFiling): NormalizedSecFiling {
  return normalizeSecFilingHtml(html, filing, true);
}

function assertSecUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !["sec.gov", "www.sec.gov"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("SEC response must resolve to sec.gov or www.sec.gov over HTTPS");
  }
}

async function fetchSecHtml(url: string, userAgent: string, options: SecFetchOptions): Promise<string> {
  assertSecUrl(url);
  const fetcher = options.fetch ?? globalThis.fetch;
  const response = await fetcher(url, { headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": userAgent }, redirect: "follow" });
  assertSecUrl(response.url || url);
  if (!response.ok) throw new Error(`SEC request failed with HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("SEC response is not HTML");
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) throw new Error("SEC response exceeds configured size limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("SEC response exceeds configured size limit");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function fetchAndNormalizeSecFiling(filing: SecFiling, options: SecFetchOptions = {}): Promise<FetchedSecFiling> {
  const userAgent = options.userAgent ?? process.env.SEC_USER_AGENT;
  if (!userAgent?.trim()) throw new Error("SEC_USER_AGENT must be configured");
  const indexHtml = await fetchSecHtml(filing.secIndexUrl, userAgent, options);
  const indexDocument = new JSDOM(indexHtml).window.document;
  validateFilingMetadata(blocksFor(indexDocument).map((block) => block.text).join(" "), filing);
  const expectedPrimaryPath = new URL(filing.primaryDocumentUrl).pathname;
  const primaryListed = [...indexDocument.querySelectorAll("a[href]")].some((anchor) => {
    try {
      const linked = new URL(anchor.getAttribute("href")!, filing.secIndexUrl);
      assertSecUrl(linked.href);
      const linkedPath =
        linked.pathname === "/ix"
          ? linked.searchParams.get("doc")
          : linked.pathname;
      return linkedPath === expectedPrimaryPath;
    } catch {
      return false;
    }
  });
  if (!primaryListed) throw new Error("SEC index does not list the pinned primary document");
  const primaryHtml = await fetchSecHtml(filing.primaryDocumentUrl, userAgent, options);
  const normalized = normalizeSecFilingHtml(primaryHtml, filing, false);
  const receivedAt = (options.now ?? (() => new Date()))().toISOString();
  return { ...normalized, receipt: { timestamp: receivedAt, receivedAt, chars: normalized.chars, sha256: normalized.sha256 } };
}
