import { buildGraph, type WikiPage } from "./domain.js";

export const baselinePages: WikiPage[] = [
  {
    slug: "ai-semiconductor-landscape",
    title: "AI Semiconductor Landscape",
    kind: "overview",
    body: "The market connects [[nvidia]], [[amd]], and [[intel]] through datacenter demand, advanced manufacturing, and export controls. See [[company-strategy-comparison]] and [[supply-chain-and-geopolitical-risk]].",
  },
  {
    slug: "company-strategy-comparison",
    title: "Company Strategy Comparison",
    kind: "comparison",
    body: "[[nvidia]] leads with accelerated computing platforms; [[amd]] competes across CPU and GPU portfolios; [[intel]] combines products with capital-intensive foundry ambitions. [NVIDIA 2026 10-K](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/) [AMD 2026 10-K](https://www.sec.gov/Archives/edgar/data/2488/000000248826000018/) [Intel 2026 10-K](https://www.sec.gov/Archives/edgar/data/50863/000005086326000011/)",
  },
  {
    slug: "supply-chain-and-geopolitical-risk",
    title: "Supply Chain and Geopolitical Risk",
    kind: "comparison",
    body: "[[nvidia]] and [[amd]] depend on third-party advanced manufacturing, while [[intel]] carries fabrication execution and capital risk. All three face export-control and geographically concentrated supply-chain exposure.",
  },
  { slug: "nvidia", title: "NVIDIA", kind: "entity", body: "See [[company-strategy-comparison]]." },
  { slug: "amd", title: "AMD", kind: "entity", body: "See [[company-strategy-comparison]]." },
  { slug: "intel", title: "Intel", kind: "entity", body: "See [[company-strategy-comparison]]." },
];

export const quality = {
  healthScore: 94,
  citationCoverage: 92,
  errors: 0,
  warnings: 0,
  brokenCitations: 0,
  brokenLinks: 0,
  stalePages: 0,
  orphanedPages: 0,
};

export function baselineState() {
  return {
    schemaVersion: 1 as const,
    stage: "baseline" as const,
    mode: "replay" as const,
    snapshotId: "baseline-verified",
    sources: 3,
    pages: baselinePages.length,
    citations: 9,
    relationships: buildGraph(baselinePages).edges.length,
    graph: buildGraph(baselinePages),
    quality,
  };
}

export function postDeltaState() {
  const pages = baselinePages.map((page) =>
    ["ai-semiconductor-landscape", "company-strategy-comparison"].includes(page.slug)
      ? { ...page, body: `${page.body}\n\nNVIDIA quarterly evidence updated this page.` }
      : page,
  );
  return {
    ...baselineState(),
    stage: "post_delta" as const,
    snapshotId: "post-delta-verified",
    sources: 4,
    citations: 12,
    graph: buildGraph(pages),
    replay: {
      verifiedAt: "2026-05-21T18:00:00.000Z",
      reason: "forced" as const,
    },
  };
}

export const preparedSynthesis = {
  answer:
    "NVIDIA has the most direct exposure to AI datacenter growth through accelerated-computing platforms and a broad software ecosystem, but relies heavily on third-party advanced manufacturing. AMD participates through datacenter CPUs and accelerators with similar foundry concentration. Intel combines product exposure with a capital-intensive foundry strategy, adding execution and financing risk. Across all three, export controls, geographic concentration, fast product cycles, and large investment requirements are principal evidence-backed risks.",
  pages: ["company-strategy-comparison", "supply-chain-and-geopolitical-risk"],
  citations: [
    { company: "NVIDIA", source: "nvidia-2026-10k", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/" },
    { company: "AMD", source: "amd-2026-10k", url: "https://www.sec.gov/Archives/edgar/data/2488/000000248826000018/" },
    { company: "Intel", source: "intel-2026-10k", url: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000011/" },
  ],
};

export function replayDelta(operationId: string) {
  return {
    operationId,
    mode: "replay" as const,
    status: "recovered" as const,
    startedAt: "2026-05-21T18:00:00.000Z",
    completedAt: "2026-05-21T18:00:08.400Z",
    durationMs: 8400,
    changes: {
      created: [{ slug: "nvidia-q1-fy2027", title: "NVIDIA Q1 FY2027", kind: "entity" }],
      updated: [
        { slug: "ai-semiconductor-landscape", title: "AI Semiconductor Landscape", kind: "overview" },
        { slug: "company-strategy-comparison", title: "Company Strategy Comparison", kind: "comparison" },
      ],
      unchanged: ["supply-chain-and-geopolitical-risk", "amd", "intel"],
    },
    highlights: [
      {
        page: "company-strategy-comparison",
        before: "NVIDIA's opportunity is anchored in annual datacenter demand.",
        after: "Quarterly evidence shows continued datacenter growth alongside tighter export-control exposure.",
        citation: "nvidia-q1-fy2027-10q",
      },
      {
        page: "ai-semiconductor-landscape",
        before: "Advanced manufacturing capacity is a shared constraint.",
        after: "NVIDIA also identified product-transition and country-specific revenue constraints in the quarter.",
        citation: "nvidia-q1-fy2027-10q",
      },
    ],
    quality,
    replayReason: "forced",
  };
}

