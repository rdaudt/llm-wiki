import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  fetchAndNormalizeSecFiling,
  normalizeSecFiling,
  type SecFiling,
} from "../src/sec.js";

const tenK: SecFiling = {
  id: "nvidia-2026-10k",
  company: "NVIDIA",
  cik: "0001045810",
  accession: "0001045810-26-000021",
  form: "10-K",
  filedOn: "2026-02-25",
  periodEnd: "2026-01-25",
  secIndexUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/0001045810-26-000021-index.htm",
  primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm",
  includedSections: ["Item 1", "Item 1A", "Item 7"],
  outputFile: "nvidia-2026-10k.md",
};

const tenQ: SecFiling = {
  ...tenK,
  id: "nvidia-q1-fy2027-10q",
  accession: "0001045810-26-000052",
  form: "10-Q",
  filedOn: "2026-05-20",
  periodEnd: "2026-04-26",
  secIndexUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000052/0001045810-26-000052-index.htm",
  primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000052/nvda-20260426.htm",
  includedSections: ["Part I Item 2", "Part II Item 1A"],
  outputFile: "nvidia-q1-fy2027-10q.md",
};

async function fixture(name: string) {
  return readFile(new URL(`./fixtures/sec/${name}`, import.meta.url), "utf8");
}

describe("SEC filing normalizer", () => {
  it("extracts required annual sections, preserves tables, and produces deterministic LF UTF-8 markdown", async () => {
    const result = normalizeSecFiling(await fixture("nvidia-10k.html"), tenK);

    expect(result.markdown).toContain("## Item 1. Business");
    expect(result.markdown).toContain("## Item 1A. Risk Factors");
    expect(result.markdown).toContain("## Item 7. Management's Discussion");
    expect(result.markdown).toContain("| Platform | Focus |");
    expect(result.markdown).toContain("| Data Center | AI |");
    expect(result.markdown).not.toContain("Item 7A");
    expect(result.markdown).not.toContain("\r");
    expect(Buffer.from(result.markdown, "utf8").toString("utf8")).toBe(result.markdown);
    expect(result.chars).toBe(result.markdown.length);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(normalizeSecFiling(await fixture("nvidia-10k.html"), tenK)).toEqual(result);
  });

  it("extracts the NVIDIA quarterly MD&A and changed risk-factor sections", async () => {
    const result = normalizeSecFiling(await fixture("nvidia-10q.html"), tenQ);

    expect(result.markdown).toContain("## Part I Item 2. Management's Discussion");
    expect(result.markdown).toContain("## Part II Item 1A. Risk Factors");
    expect(result.markdown).toContain("| Metric | Value |");
    expect(result.markdown).not.toContain("Unregistered Sales");
  });

  it("extracts annual sections whose body headings omit SEC item numbers", () => {
    const html = `<!doctype html><p>FORM 10-K</p>
      <p>Accession Number: 0001045810-26-000021</p><p>Filed 02/25/2026</p>
      <p>For the fiscal year ended January 25, 2026</p>
      <table><tr><td>Item 1.</td><td>Business:</td></tr></table>
      <table><tr><td><div><span style="font-size:18pt">Our Business</span></div></td></tr></table>
      <p>Products and markets.</p>
      <table><tr><td><div><span style="font-size:8pt">Our Business</span></div></td></tr></table>
      <div>Risk Factors</div><p>Material risks.</p>
      <div>Management's Discussion and Analysis of Financial Condition and Results of Operations</div>
      <p>Management analysis.</p><div>Quantitative and Qualitative Disclosures</div>`;
    const result = normalizeSecFiling(html, tenK);
    expect(result.markdown).toContain("## Item 1. Business");
    expect(result.markdown).toContain("## Item 1A. Risk Factors");
    expect(result.markdown).toContain("## Item 7. Management's Discussion");
  });

  it("rejects a filing whose declared form, filed date, or report period disagrees with the manifest", async () => {
    const html = await fixture("nvidia-10k.html");
    expect(() => normalizeSecFiling(html.replace("FORM 10-K", "FORM 10-Q"), tenK)).toThrow(/form/i);
    expect(() => normalizeSecFiling(html.replace("02/25/2026", "02/24/2026"), tenK)).toThrow(/filed/i);
    expect(() => normalizeSecFiling(html.replace("January 25, 2026", "January 24, 2026"), tenK)).toThrow(/period/i);
  });

  it("rejects missing and ambiguous requested sections", async () => {
    const html = await fixture("nvidia-10k.html");
    expect(() =>
      normalizeSecFiling(
        html
          .replace("<h2>Item 1A. Risk Factors</h2>", "")
          .replace("<div>Risk Factors</div>", ""),
        tenK,
      ),
    ).toThrow(/missing/i);
    expect(() => normalizeSecFiling(html.replace("<h2>Item 1A. Risk Factors</h2>", "<h2>Item 1A. Risk Factors</h2><h2>Item 1A. Risk Factors</h2>"), tenK)).toThrow(/ambiguous/i);
  });

  it("fetches only validated SEC HTML with the configured user agent and returns a receipt", async () => {
    const html = (await fixture("nvidia-10k.html")).replace(/<p>(?:Commission File Number|Accession Number|FORM 10-K|Filed |For the fiscal year ended).*?<\/p>\n?/g, "");
    const indexHtml = await fixture("nvidia-10k-index.html");
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const result = await fetchAndNormalizeSecFiling(tenK, {
      userAgent: "llm-wiki contact@example.com",
      now: () => new Date("2026-07-23T12:00:00.000Z"),
      fetch: async (input, init) => {
        calls.push({ input, init });
        return new Response(input === tenK.secIndexUrl ? indexHtml : html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });

    expect(calls.map((call) => call.input)).toEqual([tenK.secIndexUrl, tenK.primaryDocumentUrl]);
    expect(calls[0]?.init?.headers).toMatchObject({ "User-Agent": "llm-wiki contact@example.com" });
    expect(result.receipt).toMatchObject({ timestamp: "2026-07-23T12:00:00.000Z", receivedAt: "2026-07-23T12:00:00.000Z", chars: result.chars, sha256: result.sha256 });
  });

  it("rejects non-SEC redirects, non-HTML responses, overlarge bodies, and missing SEC_USER_AGENT", async () => {
    const html = await fixture("nvidia-10k.html");
    const indexHtml = await fixture("nvidia-10k-index.html");
    const options = { userAgent: "llm-wiki contact@example.com", fetch: async (input: RequestInfo | URL) => new Response(input === tenK.secIndexUrl ? indexHtml : html, { headers: { "content-type": "text/html" } }) };
    await expect(fetchAndNormalizeSecFiling(tenK, options)).resolves.toBeDefined();
    await expect(fetchAndNormalizeSecFiling(tenK, { ...options, fetch: async () => new Response(html, { headers: { "content-type": "text/plain" } }) })).rejects.toThrow(/HTML/i);
    await expect(fetchAndNormalizeSecFiling(tenK, {
      ...options,
      fetch: async () => {
        const response = new Response(html, { headers: { "content-type": "text/html" } });
        Object.defineProperty(response, "url", { value: "https://evil.example/filing" });
        return response;
      },
    })).rejects.toThrow(/SEC/i);
    await expect(fetchAndNormalizeSecFiling(tenK, { ...options, maxBytes: 8 })).rejects.toThrow(/size/i);
    await expect(
      fetchAndNormalizeSecFiling(tenK, {
        fetch: options.fetch,
        userAgent: " ",
      }),
    ).rejects.toThrow(/SEC_USER_AGENT/i);
  });

  it("enforces the 500,000 character normalized corpus cap", async () => {
    const body = "x".repeat(500_001);
    const html = `<!doctype html><p>FORM 10-K</p><p>Accession Number: 0001045810-26-000021</p><p>Filed 02/25/2026</p><p>For the fiscal year ended January 25, 2026</p><h2>Item 1. Business</h2><p>${body}</p><h2>Item 1A. Risk Factors</h2><p>x</p><h2>Item 7. Management's Discussion</h2><p>x</p>`;
    expect(() => normalizeSecFiling(html, tenK)).toThrow(/500,000/i);
  });
});
