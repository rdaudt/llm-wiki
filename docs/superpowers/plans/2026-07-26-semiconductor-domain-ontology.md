# Semiconductor Domain Ontology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit company entity pages and a rollback-safe ontology phase that derives an evidence-backed semiconductor domain graph from the live compiled wiki.

**Architecture:** Keep LLM-Wiki as the only compilation and answer-generation interface, and add no direct provider calls. Configure LLM-Wiki to generate three company entity pages, then run a deterministic ontology extractor over citation-bearing compiled paragraphs. The extractor writes a versioned audit artifact into the staged workspace; the staged-build service gates publish on a successful ontology checkpoint, and the adapter and Streamlit UI expose the typed domain graph with exact supporting pages and filing ranges.

**Tech Stack:** Node.js 24.x, TypeScript 7, Zod 4, Vitest 4, `llm-wiki-compiler` 1.1.0, Python 3.12, Streamlit, Plotly, pytest, Ruff.

## Global Constraints

- The prominent graph represents real-world semiconductor subjects, not Markdown files.
- Wiki pages are evidence containers; every visible edge must identify its supporting page and exact SEC filing line range.
- Do not add a generic `relatedTo` relationship.
- Do not create nodes or edges from title similarity or semantic similarity alone.
- Only citation-bearing paragraphs may create domain claims.
- Explicit and inferred claims remain distinguishable; inferred claims are hidden by default.
- The first implementation emits explicit claims only. The artifact schema retains `assertion: "explicit" | "inferred"` for future reviewed inference rules.
- Reject ambiguous endpoints, malformed citations, unsupported direction, missing evidence, and temporal claims that cannot be represented honestly.
- Preserve conflicting supported claims with `disputeStatus: "disputed"`; do not silently select one.
- Use stable canonical IDs and canonical ordering for symmetric relationships.
- Keep runtime data under `var/`; do not commit generated entity pages, ontology artifacts, SEC content, embeddings, or live model output.
- Retain the empty → fetch → ingest → compile → quality/repair → ontology → publish workflow and checkpoint rollback semantics.
- Test-only Markdown fixtures may exercise extraction offline but cannot enter runtime ingestion.
- Do not add a direct OpenAI SDK path or bypass LLM-Wiki for compilation or Q&A.
- Do not add a new runtime dependency.

---

## File Structure

### New files

- `src/ontology-types.ts` — Zod-backed ontology artifact, node, edge, evidence, and rejection contracts.
- `src/ontology-catalog.ts` — controlled node catalog, aliases, allowed endpoint types, and lexical relationship rules.
- `src/ontology-evidence.ts` — citation-bearing paragraph parsing and exact evidence extraction.
- `src/ontology-extractor.ts` — deterministic node detection, relation extraction, canonicalization, deduplication, and rejection accounting.
- `src/ontology-workspace.ts` — reads LLM-Wiki export, builds the artifact, enforces structural gates, and writes `.llmwiki/domain-ontology.json`.
- `tests/ontology-types.test.ts` — artifact contract and endpoint validation.
- `tests/ontology-evidence.test.ts` — exact citation and paragraph parsing tests.
- `tests/ontology-extractor.test.ts` — explicit relation, ambiguity, deduplication, conflict, and no-similarity tests.
- `tests/ontology-workspace.test.ts` — bounded artifact and workspace write tests.
- `app/ontology_view.py` — deterministic Plotly layout, filters, labels, and evidence presentation helpers.
- `python_tests/test_ontology_view.py` — graph filtering, layout, and evidence formatting tests.

### Modified files

- `wiki/schema.yaml` — add explicit NVIDIA, AMD, and Intel entity seeds.
- `tests/compiler-compat.test.ts` — verify supported entity seeds without paid calls.
- `src/build-types.ts` — add the ontology action, state, result, and artifact types.
- `src/build-store.ts` — persist ontology status and derive phase availability.
- `src/build-worker.ts` — execute the ontology workspace phase and require company entity pages after compile.
- `src/build-service.ts` — checkpoint ontology output, retain its audit artifact, reset it when upstream pages change, and gate publish.
- `src/app.ts` — queue ontology operations, expose the build ontology endpoint/artifact, and return the published domain graph.
- `src/server.ts` — wire ontology artifact reads through the existing staged-build service.
- `src/domain.ts` — remove the page-wikilink graph from the public demo state once ontology is available; retain unrelated helpers.
- `tests/build-store.test.ts` — ontology availability and reset tests.
- `tests/build-service.test.ts` — ontology checkpoint, rollback, and publish gate tests.
- `tests/adapter.test.ts` — ontology operation, API contract, idempotency, and published-state tests.
- `tests/contracts.test.ts` — replace the public wikilink graph assertion with domain graph mapping assertions.
- `app/viewmodel.py` — add ontology phase controls and graph/evidence view models.
- `app/streamlit_app.py` — add the phase button and replace the grid of page nodes with the typed domain graph.
- `python_tests/test_viewmodel.py` — ontology controls and evidence-selection tests.
- `python_tests/test_streamlit_app.py` — empty, ontology-ready, and published graph UI tests.
- `README.md` — document entity seeds, ontology phase, evidence policy, and graph interpretation.
- `docs/runbook.md` — document phase execution, artifact inspection, rollback, and manual release checks.

---

### Task 1: Configure Explicit Company Entity Pages

**Files:**
- Modify: `wiki/schema.yaml`
- Modify: `tests/compiler-compat.test.ts`
- Modify: `src/build-worker.ts`

**Interfaces:**
- Consumes: LLM-Wiki schema fields `kinds`, `seedPages`, `kind`, `summary`, and `relatedSlugs`.
- Produces: required generated slugs `nvidia`, `advanced-micro-devices`, and `intel`, each with frontmatter `kind: entity`.

- [ ] **Step 1: Write the failing schema contract test**

Add this test to `tests/compiler-compat.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

it("declares the three filing owners as entity seeds", async () => {
  const raw = await readFile(path.resolve("wiki/schema.yaml"), "utf8");
  for (const title of ["NVIDIA", "Advanced Micro Devices", "Intel"]) {
    expect(raw).toMatch(
      new RegExp(
        `- title: ${title}\\n\\s+kind: entity\\n\\s+summary: [^\\n]+\\n\\s+relatedSlugs:\\n(?:\\s+- [a-z0-9-]+\\n){2,}`,
      ),
    );
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
rtk test npm test -- --run tests/compiler-compat.test.ts
```

Expected: FAIL because no `entity` seeds exist.

- [ ] **Step 3: Add the entity seeds**

Append these entries to `seedPages` in `wiki/schema.yaml`:

```yaml
  - title: NVIDIA
    kind: entity
    summary: NVIDIA company profile grounded in the compiled SEC filing evidence.
    relatedSlugs:
      - nvidia-data-center-platform-gpus-grace-cpu-dpu-nvlink-nvlink-fusion
      - cuda-and-cuda-x-software-ecosystem
      - nvidia-blackwell-architecture-and-blackwell-ultra
  - title: Advanced Micro Devices
    kind: entity
    summary: AMD company profile grounded in the compiled SEC filing evidence.
    relatedSlugs:
      - amd-data-center-product-portfolio
      - amd-client-gaming-product-portfolio
      - amd-ai-strategy-and-strategic-partnerships
  - title: Intel
    kind: entity
    summary: Intel company profile grounded in the compiled SEC filing evidence.
    relatedSlugs:
      - client-computing-group-ccg-product-families-and-market-focus
      - data-center-and-ai-dcai-portfolio-xeon-accelerators-networking-and-gpus
      - intel-foundry-strategy-and-process-node-roadmap-intel-7-4-3-18a-14a
```

Do not change `defaultKind: concept`; ordinary topics must remain concepts.

- [ ] **Step 4: Make entity pages structural compile gates**

Replace the required-page declaration in `src/build-worker.ts` with:

```ts
const REQUIRED_PAGES = [
  { slug: "ai-semiconductor-landscape", kind: "overview" },
  { slug: "company-strategy-comparison", kind: "comparison" },
  { slug: "supply-chain-and-geopolitical-risk", kind: "comparison" },
  { slug: "nvidia", kind: "entity" },
  { slug: "advanced-micro-devices", kind: "entity" },
  { slug: "intel", kind: "entity" },
] as const;
```

Update the compile gate to compare both slug and kind:

```ts
const pages = (exported.pages ?? []).map((page: any) => ({
  slug: String(page.slug),
  kind: String(page.kind ?? "concept"),
}));
const missing = REQUIRED_PAGES.filter(
  (required) =>
    !pages.some(
      (page) => page.slug === required.slug && page.kind === required.kind,
    ),
);
if (missing.length > 0) {
  throw new Error(
    `Required page missing or mistyped: ${missing
      .map((page) => `${page.slug}:${page.kind}`)
      .join(", ")}`,
  );
}
return { action: "compile", pages: pages.map((page) => page.slug) };
```

- [ ] **Step 5: Run compiler compatibility and worker tests**

Run:

```powershell
rtk test npm test -- --run tests/compiler-compat.test.ts tests/build-service.test.ts
```

Expected: PASS with no provider calls.

- [ ] **Step 6: Commit**

```powershell
rtk git add wiki/schema.yaml tests/compiler-compat.test.ts src/build-worker.ts
rtk git commit -m "feat: seed company entity pages"
```

---

### Task 2: Define the Ontology Contract and Controlled Catalog

**Files:**
- Create: `src/ontology-types.ts`
- Create: `src/ontology-catalog.ts`
- Create: `tests/ontology-types.test.ts`

**Interfaces:**
- Produces: `OntologyArtifact`, `OntologyNode`, `OntologyEdge`, `PageBinding`, `EvidenceRef`, `OntologyNodeType`, `OntologyRelationType`, `ontologyArtifactSchema`, `ONTOLOGY_CATALOG`, and `RELATION_RULES`.
- Consumes: no runtime state and no provider.

- [ ] **Step 1: Write failing artifact-contract tests**

Create `tests/ontology-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ontologyArtifactSchema,
  relationEndpoints,
} from "../src/ontology-types.js";

const evidence = {
  pageId: "concepts/nvidia-blackwell",
  pageTitle: "NVIDIA Blackwell",
  source: "nvidia-2026-10k.md",
  start: 120,
  end: 124,
  filingDate: "2026-02-25",
  polarity: "asserted",
  excerpt: "NVIDIA offers the Blackwell platform.",
};

describe("ontology contract", () => {
  it("accepts an explicit cited domain edge", () => {
    expect(
      ontologyArtifactSchema.parse({
        schemaVersion: 1,
        ruleVersion: "1.0.0",
        createdAt: "2026-07-26T12:00:00.000Z",
        nodes: [
          { id: "company/nvidia", type: "Company", label: "NVIDIA", evidence: [evidence] },
          {
            id: "product-or-platform/blackwell",
            type: "ProductOrPlatform",
            label: "Blackwell",
            evidence: [evidence],
          },
        ],
        edges: [
          {
            id: "offers:company/nvidia:product-or-platform/blackwell",
            type: "offers",
            source: "company/nvidia",
            target: "product-or-platform/blackwell",
            assertion: "explicit",
            confidence: 1,
            disputeStatus: "undisputed",
            evidence: [evidence],
          },
        ],
        pageBindings: [{
          pageId: "concepts/nvidia-blackwell",
          pageTitle: "NVIDIA Blackwell",
          relation: "discusses",
          nodeIds: ["company/nvidia", "product-or-platform/blackwell"],
          evidence: [evidence],
        }],
        rejections: {
          malformedCitation: 0,
          missingCitation: 0,
          unknownFilingDate: 0,
          ambiguousEndpoints: 0,
          unsupportedRelation: 0,
        },
      }),
    ).toBeTruthy();
  });

  it("rejects a generic relation and invalid endpoint types", () => {
    expect(relationEndpoints("relatedTo")).toBeUndefined();
    expect(relationEndpoints("offers")).toEqual({
      from: ["Company", "BusinessSegment"],
      to: ["ProductOrPlatform"],
      symmetric: false,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
rtk test npm test -- --run tests/ontology-types.test.ts
```

Expected: FAIL because the ontology modules do not exist.

- [ ] **Step 3: Implement the Zod contract**

Create `src/ontology-types.ts` with these exported contracts:

```ts
import { z } from "zod";

export const ontologyNodeTypes = [
  "Company",
  "BusinessSegment",
  "ProductOrPlatform",
  "Technology",
  "Market",
  "Strategy",
  "Risk",
  "RegulationOrConstraint",
] as const;
export type OntologyNodeType = (typeof ontologyNodeTypes)[number];

export const ontologyRelationTypes = [
  "operates",
  "offers",
  "pursues",
  "exposedTo",
  "uses",
  "targets",
  "succeeds",
  "competesWith",
  "focusesOn",
  "dependsOn",
  "partnersWith",
  "manufacturesThrough",
  "licensesFrom",
  "affects",
  "causedBy",
  "restricts",
  "mitigates",
] as const;
export type OntologyRelationType = (typeof ontologyRelationTypes)[number];

export interface EndpointRule {
  from: OntologyNodeType[];
  to: OntologyNodeType[];
  symmetric: boolean;
}

const endpointRules: Record<OntologyRelationType, EndpointRule> = {
  operates: { from: ["Company"], to: ["BusinessSegment"], symmetric: false },
  offers: {
    from: ["Company", "BusinessSegment"],
    to: ["ProductOrPlatform"],
    symmetric: false,
  },
  pursues: { from: ["Company"], to: ["Strategy"], symmetric: false },
  exposedTo: { from: ["Company"], to: ["Risk"], symmetric: false },
  uses: { from: ["ProductOrPlatform"], to: ["Technology"], symmetric: false },
  targets: {
    from: ["ProductOrPlatform", "Strategy"],
    to: ["Market"],
    symmetric: false,
  },
  succeeds: {
    from: ["ProductOrPlatform"],
    to: ["ProductOrPlatform"],
    symmetric: false,
  },
  competesWith: {
    from: ["Company", "ProductOrPlatform"],
    to: ["Company", "ProductOrPlatform"],
    symmetric: true,
  },
  focusesOn: {
    from: ["BusinessSegment"],
    to: ["Market"],
    symmetric: false,
  },
  dependsOn: {
    from: ["Company", "Strategy"],
    to: ["Company", "Technology"],
    symmetric: false,
  },
  partnersWith: { from: ["Company"], to: ["Company"], symmetric: true },
  manufacturesThrough: {
    from: ["Company"],
    to: ["Company"],
    symmetric: false,
  },
  licensesFrom: { from: ["Company"], to: ["Company"], symmetric: false },
  affects: {
    from: ["Risk"],
    to: ["Company", "ProductOrPlatform", "Strategy", "Market"],
    symmetric: false,
  },
  causedBy: {
    from: ["Risk"],
    to: ["RegulationOrConstraint", "Company", "Technology"],
    symmetric: false,
  },
  restricts: {
    from: ["RegulationOrConstraint"],
    to: ["Company", "ProductOrPlatform", "Market"],
    symmetric: false,
  },
  mitigates: { from: ["Strategy"], to: ["Risk"], symmetric: false },
};

export function relationEndpoints(value: string): EndpointRule | undefined {
  return endpointRules[value as OntologyRelationType];
}

export const evidenceRefSchema = z.object({
  pageId: z.string().min(1),
  pageTitle: z.string().min(1),
  source: z.string().regex(/\.md$/i),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  filingDate: z.string().date(),
  polarity: z.enum(["asserted", "denied"]),
  excerpt: z.string().min(1).max(1_000),
}).refine((value) => value.end >= value.start, "evidence range is reversed");

export const ontologyNodeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*\/[a-z0-9-]+$/),
  type: z.enum(ontologyNodeTypes),
  label: z.string().min(1),
  evidence: z.array(evidenceRefSchema).min(1),
});

export const ontologyEdgeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ontologyRelationTypes),
  source: z.string().min(1),
  target: z.string().min(1),
  assertion: z.enum(["explicit", "inferred"]),
  confidence: z.number().min(0).max(1),
  disputeStatus: z.enum(["undisputed", "disputed"]),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  evidence: z.array(evidenceRefSchema).min(1),
});

export const pageBindingSchema = z.object({
  pageId: z.string().min(1),
  pageTitle: z.string().min(1),
  relation: z.enum(["describes", "compares", "discusses"]),
  nodeIds: z.array(z.string().min(1)).min(1),
  evidence: z.array(evidenceRefSchema).min(1),
});

const ontologyArtifactBaseSchema = z.object({
  schemaVersion: z.literal(1),
  ruleVersion: z.literal("1.0.0"),
  createdAt: z.string().datetime(),
  nodes: z.array(ontologyNodeSchema).max(500),
  edges: z.array(ontologyEdgeSchema).max(1_000),
  pageBindings: z.array(pageBindingSchema).max(2_000).default([]),
  rejections: z.object({
    malformedCitation: z.number().int().nonnegative(),
    missingCitation: z.number().int().nonnegative(),
    unknownFilingDate: z.number().int().nonnegative(),
    ambiguousEndpoints: z.number().int().nonnegative(),
    unsupportedRelation: z.number().int().nonnegative(),
  }),
});

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type OntologyNode = z.infer<typeof ontologyNodeSchema>;
export type OntologyEdge = z.infer<typeof ontologyEdgeSchema>;
export type PageBinding = z.infer<typeof pageBindingSchema>;
export type OntologyArtifact = z.infer<typeof ontologyArtifactSchema>;
```

Task 2 Step 5 exports the refined `ontologyArtifactSchema`. It checks every edge
endpoint exists, endpoint types satisfy `relationEndpoints`, symmetric
endpoints are canonically ordered, `competesWith` connects like node types, and
`source !== target`. It must also verify every `pageBindings[].nodeIds` value
references a materialized domain node.

- [ ] **Step 4: Implement the controlled catalog and lexical rules**

Create `src/ontology-catalog.ts`:

```ts
import type {
  OntologyNodeType,
  OntologyRelationType,
} from "./ontology-types.js";

export interface CatalogEntry {
  id: string;
  type: OntologyNodeType;
  label: string;
  aliases: string[];
}

export interface RelationRule {
  type: OntologyRelationType;
  triggers: RegExp[];
}

export const ONTOLOGY_CATALOG: CatalogEntry[] = [
  { id: "company/nvidia", type: "Company", label: "NVIDIA", aliases: ["NVIDIA", "NVIDIA Corporation"] },
  { id: "company/amd", type: "Company", label: "AMD", aliases: ["AMD", "Advanced Micro Devices"] },
  { id: "company/intel", type: "Company", label: "Intel", aliases: ["Intel", "Intel Corporation"] },
  { id: "company/tsmc", type: "Company", label: "TSMC", aliases: ["TSMC", "Taiwan Semiconductor Manufacturing Company"] },
  { id: "company/asml", type: "Company", label: "ASML", aliases: ["ASML"] },
  { id: "business-segment/intel-ccg", type: "BusinessSegment", label: "Intel CCG", aliases: ["Client Computing Group", "CCG"] },
  { id: "business-segment/intel-dcai", type: "BusinessSegment", label: "Intel DCAI", aliases: ["Data Center and AI", "DCAI"] },
  { id: "business-segment/intel-foundry", type: "BusinessSegment", label: "Intel Foundry", aliases: ["Intel Foundry"] },
  { id: "product-or-platform/blackwell", type: "ProductOrPlatform", label: "Blackwell", aliases: ["Blackwell", "Blackwell Ultra"] },
  { id: "product-or-platform/rubin", type: "ProductOrPlatform", label: "Rubin", aliases: ["Rubin"] },
  { id: "product-or-platform/cuda", type: "ProductOrPlatform", label: "CUDA", aliases: ["CUDA", "CUDA-X"] },
  { id: "product-or-platform/nvidia-ai-enterprise", type: "ProductOrPlatform", label: "NVIDIA AI Enterprise", aliases: ["NVIDIA AI Enterprise"] },
  { id: "product-or-platform/nvidia-drive", type: "ProductOrPlatform", label: "NVIDIA DRIVE", aliases: ["NVIDIA DRIVE", "DRIVE"] },
  { id: "product-or-platform/xeon", type: "ProductOrPlatform", label: "Xeon", aliases: ["Xeon"] },
  { id: "product-or-platform/amd-instinct", type: "ProductOrPlatform", label: "AMD Instinct", aliases: ["AMD Instinct", "Instinct"] },
  { id: "product-or-platform/epyc", type: "ProductOrPlatform", label: "EPYC", aliases: ["EPYC"] },
  { id: "product-or-platform/ryzen", type: "ProductOrPlatform", label: "Ryzen", aliases: ["Ryzen"] },
  { id: "technology/gpu", type: "Technology", label: "GPU", aliases: ["GPU", "GPUs"] },
  { id: "technology/cpu", type: "Technology", label: "CPU", aliases: ["CPU", "CPUs"] },
  { id: "technology/dpu", type: "Technology", label: "DPU", aliases: ["DPU", "DPUs"] },
  { id: "technology/nvlink", type: "Technology", label: "NVLink", aliases: ["NVLink", "NVLink Fusion"] },
  { id: "technology/fpga", type: "Technology", label: "FPGA", aliases: ["FPGA", "adaptive SoC", "adaptive SoCs"] },
  { id: "technology/advanced-packaging", type: "Technology", label: "Advanced packaging", aliases: ["advanced packaging", "EMIB", "Foveros"] },
  { id: "technology/intel-18a", type: "Technology", label: "Intel 18A", aliases: ["Intel 18A", "18A"] },
  { id: "technology/intel-14a", type: "Technology", label: "Intel 14A", aliases: ["Intel 14A", "14A"] },
  { id: "market/data-center-ai", type: "Market", label: "Data-center AI", aliases: ["data center AI", "AI data center", "AI datacenter"] },
  { id: "market/client-computing", type: "Market", label: "Client computing", aliases: ["client computing", "PC market"] },
  { id: "market/gaming", type: "Market", label: "Gaming", aliases: ["gaming"] },
  { id: "market/embedded", type: "Market", label: "Embedded", aliases: ["embedded"] },
  { id: "market/automotive", type: "Market", label: "Automotive", aliases: ["automotive", "autonomous vehicle"] },
  { id: "market/networking", type: "Market", label: "Networking", aliases: ["networking"] },
  { id: "strategy/foundry", type: "Strategy", label: "Foundry strategy", aliases: ["foundry strategy"] },
  { id: "strategy/ai-ecosystem", type: "Strategy", label: "AI ecosystem strategy", aliases: ["AI ecosystem", "full-stack platform"] },
  { id: "strategy/strategic-partnerships", type: "Strategy", label: "Strategic partnerships", aliases: ["strategic partnership", "strategic partnerships"] },
  { id: "strategy/manufacturing", type: "Strategy", label: "Manufacturing strategy", aliases: ["manufacturing strategy", "manufacturing model"] },
  { id: "risk/restricted-market-access", type: "Risk", label: "Restricted market access", aliases: ["restricted market access", "loss of market access"] },
  { id: "risk/supply-chain-dependency", type: "Risk", label: "Supply-chain dependency", aliases: ["supply chain dependency", "supply-chain dependency"] },
  { id: "risk/geopolitical-exposure", type: "Risk", label: "Geopolitical exposure", aliases: ["geopolitical risk", "geopolitical exposure"] },
  { id: "risk/ip-dependency", type: "Risk", label: "IP dependency", aliases: ["intellectual property dependency", "third-party intellectual property"] },
  { id: "risk/competitive-pressure", type: "Risk", label: "Competitive pressure", aliases: ["competitive pressure", "intense competition"] },
  { id: "regulation-or-constraint/us-export-controls", type: "RegulationOrConstraint", label: "US export controls", aliases: ["U.S. export controls", "US export controls", "export controls"] },
  { id: "regulation-or-constraint/licensing-requirements", type: "RegulationOrConstraint", label: "Licensing requirements", aliases: ["licensing requirement", "licensing requirements", "export license"] },
];

export const RELATION_RULES: RelationRule[] = [
  { type: "operates", triggers: [/\boperates?\b/i, /\boperating segment\b/i] },
  { type: "offers", triggers: [/\boffers?\b/i, /\bprovides?\b/i, /\bportfolio includes?\b/i] },
  { type: "pursues", triggers: [/\bpursues?\b/i, /\bstrategy\b/i] },
  { type: "exposedTo", triggers: [/\bexposed to\b/i, /\bsubject to\b/i] },
  { type: "uses", triggers: [/\buses?\b/i, /\bincludes?\b/i, /\bbased on\b/i] },
  { type: "targets", triggers: [/\btargets?\b/i, /\bdesigned for\b/i, /\bserves?\b/i] },
  { type: "succeeds", triggers: [/\bsucceeds?\b/i, /\bsuccessor to\b/i, /\bnext generation of\b/i] },
  { type: "competesWith", triggers: [/\bcompetes? with\b/i, /\bcompetitor\b/i] },
  { type: "focusesOn", triggers: [/\bfocuses? on\b/i, /\bserves?\b/i] },
  { type: "dependsOn", triggers: [/\bdepends? on\b/i, /\brelies? on\b/i] },
  { type: "partnersWith", triggers: [/\bpartners? with\b/i, /\bpartnership with\b/i] },
  { type: "manufacturesThrough", triggers: [/\bmanufactured by\b/i, /\bfoundry partner\b/i] },
  { type: "licensesFrom", triggers: [/\blicenses? from\b/i, /\blicensed from\b/i] },
  { type: "affects", triggers: [/\baffects?\b/i, /\bimpacts?\b/i] },
  { type: "causedBy", triggers: [/\bcaused by\b/i, /\bresulting from\b/i] },
  { type: "restricts", triggers: [/\brestricts?\b/i, /\blimits?\b/i, /\bprohibits?\b/i] },
  { type: "mitigates", triggers: [/\bmitigates?\b/i, /\breduces? the risk\b/i] },
];
```

Keep aliases ordered longest-first at detection time and use Unicode-aware word
boundaries so `AI` does not match inside unrelated words.

- [ ] **Step 5: Validate endpoint types in the artifact schema**

Insert this artifact-level `superRefine` before the four exported inferred
types, so `OntologyArtifact` derives from the final refined schema:

```ts
export const ontologyArtifactSchema = ontologyArtifactBaseSchema.superRefine(
  (artifact, context) => {
    const nodes = new Map(artifact.nodes.map((node) => [node.id, node]));
    for (const [index, edge] of artifact.edges.entries()) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      const endpoints = relationEndpoints(edge.type);
      if (!source || !target || !endpoints) {
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "edge endpoint is missing",
        });
        continue;
      }
      if (
        !endpoints.from.includes(source.type) ||
        !endpoints.to.includes(target.type) ||
        (edge.type === "competesWith" && source.type !== target.type) ||
        source.id === target.id
      ) {
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "edge violates the ontology endpoint contract",
        });
      }
      if (endpoints.symmetric && source.id.localeCompare(target.id) > 0) {
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "symmetric edge is not canonically ordered",
        });
      }
    }
  },
);
```

- [ ] **Step 6: Run the contract tests**

Run:

```powershell
rtk test npm test -- --run tests/ontology-types.test.ts
rtk tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
rtk git add src/ontology-types.ts src/ontology-catalog.ts tests/ontology-types.test.ts
rtk git commit -m "feat: define semiconductor ontology contract"
```

---

### Task 3: Parse Citation-Bearing Evidence

**Files:**
- Create: `src/ontology-evidence.ts`
- Create: `tests/ontology-evidence.test.ts`

**Interfaces:**
- Consumes: `{ pageId, pageTitle, body }`.
- Produces: `parseEvidenceParagraphs(page, filingDates): EvidenceParseResult`.

- [ ] **Step 1: Write failing evidence-parser tests**

Create `tests/ontology-evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEvidenceParagraphs } from "../src/ontology-evidence.js";

describe("ontology evidence parser", () => {
  it("preserves every exact citation range on a paragraph", () => {
    const parsed = parseEvidenceParagraphs({
      pageId: "concepts/blackwell",
      pageTitle: "Blackwell",
      body:
        "NVIDIA offers Blackwell for data center AI. " +
        "^[nvidia-2026-10k.md:120-124] ^[nvidia-2026-10k.md:140-141]",
    }, { "nvidia-2026-10k.md": "2026-02-25" });

    expect(parsed.paragraphs).toHaveLength(1);
    expect(parsed.paragraphs[0]?.evidence).toEqual([
      expect.objectContaining({ source: "nvidia-2026-10k.md", start: 120, end: 124 }),
      expect.objectContaining({ source: "nvidia-2026-10k.md", start: 140, end: 141 }),
    ]);
  });

  it("does not treat uncited prose as evidence", () => {
    const parsed = parseEvidenceParagraphs({
      pageId: "concepts/blackwell",
      pageTitle: "Blackwell",
      body: "NVIDIA offers Blackwell.\n\nAMD competes with NVIDIA.",
    }, {});
    expect(parsed.paragraphs).toEqual([]);
    expect(parsed.missingCitation).toBe(2);
  });

  it("counts malformed and reversed citation ranges", () => {
    const parsed = parseEvidenceParagraphs({
      pageId: "concepts/blackwell",
      pageTitle: "Blackwell",
      body: "Claim. ^[NVIDIA filing lines 10-20]\n\nClaim. ^[nvidia.md:20-10]",
    }, { "nvidia.md": "2026-02-25" });
    expect(parsed.paragraphs).toEqual([]);
    expect(parsed.malformedCitation).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
rtk test npm test -- --run tests/ontology-evidence.test.ts
```

Expected: FAIL because `parseEvidenceParagraphs` does not exist.

- [ ] **Step 3: Implement exact paragraph parsing**

Create `src/ontology-evidence.ts`:

```ts
import type { EvidenceRef } from "./ontology-types.js";

export interface EvidencePage {
  pageId: string;
  pageTitle: string;
  body: string;
}

export interface EvidenceParagraph {
  text: string;
  evidence: EvidenceRef[];
}

export interface EvidenceParseResult {
  paragraphs: EvidenceParagraph[];
  malformedCitation: number;
  missingCitation: number;
  unknownFilingDate: number;
}

const marker = /\^\[([a-z0-9._-]+\.md):(\d+)-(\d+)\]/gi;
const markerLike = /\^\[[^\]\n]+\]/g;

export function parseEvidenceParagraphs(
  page: EvidencePage,
  filingDates: Readonly<Record<string, string>>,
): EvidenceParseResult {
  const result: EvidenceParseResult = {
    paragraphs: [],
    malformedCitation: 0,
    missingCitation: 0,
    unknownFilingDate: 0,
  };
  for (const raw of page.body.replaceAll("\r\n", "\n").split(/\n\s*\n/)) {
    const paragraph = raw.trim();
    if (!paragraph || paragraph.startsWith("---")) continue;
    const exact = [...paragraph.matchAll(marker)];
    const markerCount = [...paragraph.matchAll(markerLike)].length;
    result.malformedCitation += markerCount - exact.length;
    if (exact.length === 0) {
      if (markerCount === 0) result.missingCitation += 1;
      continue;
    }
    const excerpt = paragraph
      .replace(markerLike, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1_000);
    const evidence = exact.flatMap((match): EvidenceRef[] => {
      const start = Number(match[2]);
      const end = Number(match[3]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        result.malformedCitation += 1;
        return [];
      }
      const filingDate = filingDates[match[1]!];
      if (!filingDate) {
        result.unknownFilingDate += 1;
        return [];
      }
      return [{
        pageId: page.pageId,
        pageTitle: page.pageTitle,
        source: match[1]!,
        start,
        end,
        filingDate,
        polarity: "asserted",
        excerpt,
      }];
    });
    if (evidence.length > 0) result.paragraphs.push({ text: excerpt, evidence });
  }
  return result;
}
```

Adjust the malformed counter so a reversed range is counted once and a valid
marker is not counted as malformed.

- [ ] **Step 4: Run parser tests and TypeScript**

Run:

```powershell
rtk test npm test -- --run tests/ontology-evidence.test.ts
rtk tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/ontology-evidence.ts tests/ontology-evidence.test.ts
rtk git commit -m "feat: parse ontology evidence paragraphs"
```

---

### Task 4: Extract and Audit Explicit Domain Relationships

**Files:**
- Create: `src/ontology-extractor.ts`
- Create: `tests/ontology-extractor.test.ts`

**Interfaces:**
- Consumes: `extractOntology(pages: OntologySourcePage[], filingDates: Readonly<Record<string, string>>, createdAt?: string): OntologyArtifact`.
- Produces: validated, deterministic, explicit-only `OntologyArtifact`.
- Depends on: `ONTOLOGY_CATALOG`, `RELATION_RULES`, `relationEndpoints`, and `parseEvidenceParagraphs`.

- [ ] **Step 1: Write failing extraction tests**

Create `tests/ontology-extractor.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";
import { extractOntology } from "../src/ontology-extractor.js";

const page = (body: string) => [{
  pageId: "concepts/blackwell",
  pageTitle: "Blackwell",
  pageKind: "concept" as const,
  body,
}];

describe("ontology extraction", () => {
  it("creates an explicit edge only from a cited trigger and typed endpoints", () => {
    const artifact = extractOntology(
      page("NVIDIA offers Blackwell for data center AI. ^[nvidia-2026-10k.md:120-124]"),
      { "nvidia-2026-10k.md": "2026-02-25" },
      "2026-07-26T12:00:00.000Z",
    );
    expect(artifact.edges).toContainEqual(
      expect.objectContaining({
        type: "offers",
        source: "company/nvidia",
        target: "product-or-platform/blackwell",
        assertion: "explicit",
      }),
    );
  });

  it("does not create an edge from co-occurrence without a relation trigger", () => {
    const artifact = extractOntology(
      page("NVIDIA and Blackwell are discussed here. ^[nvidia-2026-10k.md:120-124]"),
      { "nvidia-2026-10k.md": "2026-02-25" },
      "2026-07-26T12:00:00.000Z",
    );
    expect(artifact.edges).toEqual([]);
  });

  it("rejects ambiguous endpoint pairs", () => {
    const artifact = extractOntology(
      page("NVIDIA and AMD offer Blackwell and EPYC. ^[nvidia-2026-10k.md:120-124]"),
      { "nvidia-2026-10k.md": "2026-02-25" },
      "2026-07-26T12:00:00.000Z",
    );
    expect(artifact.edges).toEqual([]);
    expect(artifact.rejections.ambiguousEndpoints).toBeGreaterThan(0);
  });

  it("canonicalizes and merges symmetric edges and evidence", () => {
    const artifact = extractOntology([
      {
        pageId: "concepts/competition-a",
        pageTitle: "Competition A",
        pageKind: "comparison" as const,
        body: "NVIDIA competes with AMD. ^[nvidia-2026-10k.md:10-12]",
      },
      {
        pageId: "concepts/competition-b",
        pageTitle: "Competition B",
        pageKind: "comparison" as const,
        body: "AMD competes with NVIDIA. ^[amd-2026-10k.md:20-22]",
      },
    ], {
      "nvidia-2026-10k.md": "2026-02-25",
      "amd-2026-10k.md": "2026-02-04",
    }, "2026-07-26T12:00:00.000Z");
    const edge = artifact.edges.find((item) => item.type === "competesWith");
    expect(edge).toMatchObject({
      source: "company/amd",
      target: "company/nvidia",
    });
    expect(edge?.evidence).toHaveLength(2);
  });
});
```

Also add tests that:

- node aliases match whole terms and longest aliases first;
- `relatedTo` can never be emitted;
- an uncited paragraph emits no node or edge;
- the same directed edge merges evidence deterministically;
- endpoint ordering in prose determines directed edge direction;
- cited asserted and denied forms of the same edge mark
  `disputeStatus: "disputed"` rather than deleting either claim.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
rtk test npm test -- --run tests/ontology-extractor.test.ts
```

Expected: FAIL because `extractOntology` does not exist.

- [ ] **Step 3: Implement canonical node detection**

Create `src/ontology-extractor.ts` with these core helpers:

```ts
import {
  ONTOLOGY_CATALOG,
  RELATION_RULES,
  type CatalogEntry,
} from "./ontology-catalog.js";
import { parseEvidenceParagraphs } from "./ontology-evidence.js";
import {
  ontologyArtifactSchema,
  relationEndpoints,
  type EvidenceRef,
  type OntologyArtifact,
  type OntologyEdge,
  type OntologyNode,
  type OntologyRelationType,
} from "./ontology-types.js";

export interface OntologySourcePage {
  pageId: string;
  pageTitle: string;
  pageKind: "concept" | "entity" | "comparison" | "overview";
  body: string;
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAlias(text: string, alias: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(alias)}(?=$|[^\\p{L}\\p{N}])`, "iu")
    .test(text);
}

function detectedEntries(text: string): CatalogEntry[] {
  return ONTOLOGY_CATALOG
    .filter((entry) =>
      [...entry.aliases]
        .sort((left, right) => right.length - left.length)
        .some((alias) => containsAlias(text, alias)),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function earliestAliasIndex(entry: CatalogEntry, text: string): number {
  return entry.aliases
    .map((alias) => text.search(
      new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(alias)}(?=$|[^\\p{L}\\p{N}])`, "iu"),
    ))
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), Number.POSITIVE_INFINITY);
}
```

- [ ] **Step 4: Implement typed pair selection and rejection**

For each citation-bearing paragraph and each triggered rule:

```ts
function candidatePairs(
  entries: CatalogEntry[],
  relation: OntologyRelationType,
  paragraphText: string,
  triggerIndex: number,
): Array<[CatalogEntry, CatalogEntry]> {
  const endpoints = relationEndpoints(relation);
  if (!endpoints) return [];
  const from = entries.filter((entry) => endpoints.from.includes(entry.type));
  const to = entries.filter((entry) => endpoints.to.includes(entry.type));
  const pairs = from.flatMap((source) =>
    to
      .filter((target) => target.id !== source.id)
      .map((target): [CatalogEntry, CatalogEntry] => [source, target]),
  );
  return pairs.filter(([source, target]) => {
    const sourceIndex = earliestAliasIndex(source, paragraphText);
    const targetIndex = earliestAliasIndex(target, paragraphText);
    return Number.isFinite(sourceIndex) &&
      Number.isFinite(targetIndex) &&
      sourceIndex < triggerIndex &&
      triggerIndex < targetIndex &&
      (relation !== "competesWith" || source.type === target.type);
  });
}
```

For each trigger match, pass `match.index` to `candidatePairs`. Accept a rule
only when it yields exactly one compatible pair. Count zero pairs as
`unsupportedRelation` and more than one pair as `ambiguousEndpoints`. This
first version supports only the explicit `source … trigger … target` syntax;
unsupported reverse syntax is rejected rather than guessed.

- [ ] **Step 5: Implement stable edges and evidence merging**

Use these canonical keys:

```ts
function canonicalEndpoints(
  type: OntologyRelationType,
  source: string,
  target: string,
): [string, string] {
  return relationEndpoints(type)?.symmetric && source.localeCompare(target) > 0
    ? [target, source]
    : [source, target];
}

function edgeId(type: OntologyRelationType, source: string, target: string): string {
  const [left, right] = canonicalEndpoints(type, source, target);
  return `${type}:${left}:${right}`;
}

function evidenceKey(value: EvidenceRef): string {
  return `${value.pageId}\0${value.source}\0${value.start}\0${value.end}`;
}
```

Merge duplicate evidence by `evidenceKey`, sort nodes by ID, sort edges by ID,
sort evidence by page/source/start/end, and set:

```ts
  {
    assertion: "explicit",
    confidence: 1,
    disputeStatus:
      polarities.has("asserted") && polarities.has("denied")
        ? "disputed"
        : "undisputed",
  }
```

Do not implement inferred extraction in this task.

- [ ] **Step 6: Implement extraction, conflict retention, and final validation**

Complete the exported function with this accumulator flow:

```ts
interface EdgeAccumulator {
  type: OntologyRelationType;
  source: CatalogEntry;
  target: CatalogEntry;
  evidence: Map<string, EvidenceRef>;
  polarities: Set<"asserted" | "denied">;
}

function deniedAt(text: string, triggerIndex: number): boolean {
  const prefix = text.slice(Math.max(0, triggerIndex - 40), triggerIndex);
  return /\b(?:does not|no longer|is not|are not|ceased|stopped)\b/i.test(prefix);
}

export function extractOntology(
  pages: OntologySourcePage[],
  filingDates: Readonly<Record<string, string>>,
  createdAt = new Date().toISOString(),
): OntologyArtifact {
  const accumulators = new Map<string, EdgeAccumulator>();
  const rejections = {
    malformedCitation: 0,
    missingCitation: 0,
    unknownFilingDate: 0,
    ambiguousEndpoints: 0,
    unsupportedRelation: 0,
  };

  for (const page of pages) {
    const parsed = parseEvidenceParagraphs(page, filingDates);
    rejections.malformedCitation += parsed.malformedCitation;
    rejections.missingCitation += parsed.missingCitation;
    rejections.unknownFilingDate += parsed.unknownFilingDate;

    for (const paragraph of parsed.paragraphs) {
      const entries = detectedEntries(paragraph.text);
      for (const rule of RELATION_RULES) {
        for (const trigger of rule.triggers) {
          const match = paragraph.text.match(trigger);
          if (match?.index === undefined) continue;
          const pairs = candidatePairs(
            entries,
            rule.type,
            paragraph.text,
            match.index,
          );
          if (pairs.length === 0) {
            rejections.unsupportedRelation += 1;
            continue;
          }
          if (pairs.length > 1) {
            rejections.ambiguousEndpoints += 1;
            continue;
          }

          const [rawSource, rawTarget] = pairs[0]!;
          const [sourceId, targetId] = canonicalEndpoints(
            rule.type,
            rawSource.id,
            rawTarget.id,
          );
          const source = sourceId === rawSource.id ? rawSource : rawTarget;
          const target = targetId === rawTarget.id ? rawTarget : rawSource;
          const id = edgeId(rule.type, source.id, target.id);
          const accumulator = accumulators.get(id) ?? {
            type: rule.type,
            source,
            target,
            evidence: new Map<string, EvidenceRef>(),
            polarities: new Set<"asserted" | "denied">(),
          };
          const polarity = deniedAt(paragraph.text, match.index)
            ? "denied"
            : "asserted";
          accumulator.polarities.add(polarity);
          for (const item of paragraph.evidence) {
            const evidence = { ...item, polarity };
            accumulator.evidence.set(evidenceKey(evidence), evidence);
          }
          accumulators.set(id, accumulator);
        }
      }
    }
  }

  const nodes = new Map<string, OntologyNode>();
  const edges: OntologyEdge[] = [];
  for (const [id, accumulator] of accumulators) {
    if (!accumulator.polarities.has("asserted")) continue;
    const evidence = [...accumulator.evidence.values()].sort((left, right) =>
      evidenceKey(left).localeCompare(evidenceKey(right)),
    );
    for (const entry of [accumulator.source, accumulator.target]) {
      const existing = nodes.get(entry.id);
      const combined = new Map(
        [...(existing?.evidence ?? []), ...evidence].map((item) => [
          evidenceKey(item),
          item,
        ]),
      );
      nodes.set(entry.id, {
        id: entry.id,
        type: entry.type,
        label: entry.label,
        evidence: [...combined.values()].sort((left, right) =>
          evidenceKey(left).localeCompare(evidenceKey(right)),
        ),
      });
    }
    edges.push({
      id,
      type: accumulator.type,
      source: accumulator.source.id,
      target: accumulator.target.id,
      assertion: "explicit",
      confidence: 1,
      disputeStatus:
        accumulator.polarities.has("denied") ? "disputed" : "undisputed",
      evidence,
    });
  }

  const pageKinds = new Map(
    pages.map((page) => [page.pageId, page.pageKind]),
  );
  const pageTitles = new Map(
    pages.map((page) => [page.pageId, page.pageTitle]),
  );
  const nodesByPage = new Map<string, Set<string>>();
  for (const node of nodes.values()) {
    for (const item of node.evidence) {
      const ids = nodesByPage.get(item.pageId) ?? new Set<string>();
      ids.add(node.id);
      nodesByPage.set(item.pageId, ids);
    }
  }
  const pageBindings = [...nodesByPage.entries()]
    .map(([pageId, ids]) => {
      const nodeIds = [...ids].sort();
      const pageKind = pageKinds.get(pageId) ?? "concept";
      const relation =
        pageKind === "comparison"
          ? "compares"
          : pageKind === "entity" || nodeIds.length === 1
            ? "describes"
            : "discusses";
      const evidence = [...nodes.values()]
        .filter((node) => nodeIds.includes(node.id))
        .flatMap((node) =>
          node.evidence.filter((item) => item.pageId === pageId),
        )
        .filter(
          (item, index, all) =>
            all.findIndex((candidate) =>
              evidenceKey(candidate) === evidenceKey(item),
            ) === index,
        )
        .sort((left, right) =>
          evidenceKey(left).localeCompare(evidenceKey(right)),
        );
      return {
        pageId,
        pageTitle: pageTitles.get(pageId) ?? pageId,
        relation,
        nodeIds,
        evidence,
      };
    })
    .sort((left, right) => left.pageId.localeCompare(right.pageId));

  return ontologyArtifactSchema.parse({
    schemaVersion: 1,
    ruleVersion: "1.0.0",
    createdAt,
    nodes: [...nodes.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
    pageBindings,
    rejections,
  });
}
```

Before merging evidence, detect `does not`, `no longer`, `is not`, `are not`,
`ceased`, or `stopped` within the 40 characters before the matched trigger.
Set that evidence record's `polarity` to `"denied"`. A denied occurrence alone
does not create an edge. When at least one asserted occurrence and one denied
occurrence support the same canonical edge, retain all evidence and set
`disputeStatus: "disputed"`.

Only materialize nodes that participate in an accepted edge. This prevents
co-occurrence-only dots from cluttering the graph.

- [ ] **Step 7: Run extractor tests and all TypeScript tests**

Run:

```powershell
rtk test npm test -- --run tests/ontology-extractor.test.ts
rtk test npm test
rtk tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
rtk git add src/ontology-extractor.ts tests/ontology-extractor.test.ts
rtk git commit -m "feat: extract cited domain relationships"
```

---

### Task 5: Build a Bounded Ontology Workspace Artifact

**Files:**
- Create: `src/ontology-workspace.ts`
- Create: `tests/ontology-workspace.test.ts`
- Modify: `src/compiler-client.ts`

**Interfaces:**
- Consumes: `buildWorkspaceOntology(workspaceRoot: string, filingDates: Readonly<Record<string, string>>, createdAt?: string, exportJson?: () => Promise<any>): Promise<OntologyArtifact>`.
- Produces: `<workspace>/.llmwiki/domain-ontology.json`.
- Depends on: `CompilerClient.exportJson()` and `extractOntology`.

- [ ] **Step 1: Write failing workspace tests**

Create `tests/ontology-workspace.test.ts`:

```ts
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceOntology } from "../src/ontology-workspace.js";

describe("workspace ontology", () => {
  it("writes the validated artifact under .llmwiki", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ontology-workspace-"));
    await mkdir(path.join(root, ".llmwiki"), { recursive: true });
    const exportJson = vi.fn(async () => ({
      pages: [{
        pageDirectory: "concepts",
        slug: "blackwell",
        title: "Blackwell",
        body: "NVIDIA offers Blackwell. ^[nvidia-2026-10k.md:10-12]",
      }],
    }));

    const artifact = await buildWorkspaceOntology(
      root,
      { "nvidia-2026-10k.md": "2026-02-25" },
      "2026-07-26T12:00:00.000Z",
      exportJson,
    );

    expect(artifact.edges).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(path.join(root, ".llmwiki", "domain-ontology.json"), "utf8"),
      ),
    ).toEqual(artifact);
  });

  it("fails when no explicit cited relationships are found", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ontology-empty-"));
    await expect(
      buildWorkspaceOntology(root, {}, undefined, async () => ({ pages: [] })),
    ).rejects.toThrow(/no explicit cited domain relationships/i);
  });
});
```

Add a size-bound test that generates enough edges to exceed 2 MiB and expects a
clear failure before `domain-ontology.json` is written.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
rtk test npm test -- --run tests/ontology-workspace.test.ts
```

Expected: FAIL because the workspace builder does not exist.

- [ ] **Step 3: Implement the workspace builder**

Create `src/ontology-workspace.ts`:

```ts
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CompilerClient } from "./compiler-client.js";
import { extractOntology } from "./ontology-extractor.js";
import type { OntologyArtifact } from "./ontology-types.js";

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

export async function buildWorkspaceOntology(
  workspaceRoot: string,
  filingDates: Readonly<Record<string, string>>,
  createdAt = new Date().toISOString(),
  exportJson: () => Promise<any> = () => new CompilerClient(workspaceRoot).exportJson(),
): Promise<OntologyArtifact> {
  const exported = await exportJson();
  const pages = (exported.pages ?? [])
    .filter((page: any) => page.pageDirectory === "concepts")
    .map((page: any) => ({
      pageId: `concepts/${String(page.slug)}`,
      pageTitle: String(page.title),
      pageKind: String(page.kind ?? "concept") as
        | "concept"
        | "entity"
        | "comparison"
        | "overview",
      body: String(page.body ?? ""),
    }));
  const artifact = extractOntology(pages, filingDates, createdAt);
  if (artifact.edges.length === 0) {
    throw new Error("No explicit cited domain relationships were found");
  }
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Domain ontology artifact exceeds 2 MiB");
  }
  const directory = path.join(workspaceRoot, ".llmwiki");
  const destination = path.join(directory, "domain-ontology.json");
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, serialized, "utf8");
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return artifact;
}
```

- [ ] **Step 4: Add a compiler-client ontology reader**

Add to `src/compiler-client.ts`:

```ts
async ontology() {
  const raw = await readFile(
    path.join(this.root, ".llmwiki", "domain-ontology.json"),
    "utf8",
  );
  return ontologyArtifactSchema.parse(JSON.parse(raw));
}
```

Store a normalized `root` property in the constructor and import `readFile`,
`path`, and `ontologyArtifactSchema`. Missing or invalid artifacts must throw;
do not return an empty success object.

- [ ] **Step 5: Run workspace tests**

Run:

```powershell
rtk test npm test -- --run tests/ontology-workspace.test.ts
rtk tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
rtk git add src/ontology-workspace.ts tests/ontology-workspace.test.ts src/compiler-client.ts
rtk git commit -m "feat: build bounded ontology artifacts"
```

---

### Task 6: Add the Rollback-Safe Ontology Build Phase

**Files:**
- Modify: `src/build-types.ts`
- Modify: `src/build-store.ts`
- Modify: `src/build-worker.ts`
- Modify: `src/build-service.ts`
- Modify: `tests/build-store.test.ts`
- Modify: `tests/build-service.test.ts`

**Interfaces:**
- Adds action: `"ontology"`.
- Adds state: `ontologyStatus: "not_run" | "failed" | "built"` and `latestOntologyArtifact?: string`.
- Adds worker result: `{ action: "ontology"; artifact: OntologyArtifact }`.
- Publish requires `qualityStatus === "passed"` and `ontologyStatus === "built"`.

- [ ] **Step 1: Write failing build-store availability tests**

Extend `tests/build-store.test.ts`:

```ts
it("enables ontology only after quality and publish only after ontology", async () => {
  const store = new BuildStore(await temporaryRoot());
  const created = await store.createBaseline();
  const compiled = {
    ...created,
    stage: "compiled" as const,
    qualityStatus: "passed" as const,
    ontologyStatus: "not_run" as const,
  };
  expect(store.availableActions(compiled)).toContain("ontology");
  expect(store.availableActions(compiled)).not.toContain("publish");
  expect(
    store.availableActions({ ...compiled, ontologyStatus: "built" }),
  ).toContain("publish");
});
```

Update existing state expectations to include `ontologyStatus: "not_run"`.

- [ ] **Step 2: Write failing service phase tests**

Extend `tests/build-service.test.ts` with:

```ts
it("checkpoints ontology and retains its exact audit artifact", async () => {
  // Advance a temporary build through compile and passing quality.
  // The ontology worker writes .llmwiki/domain-ontology.json and returns ARTIFACT.
  const built = await builds.runPhase(buildId, "ontology", "ontology-op");
  expect(built.ontologyStatus).toBe("built");
  expect(built.latestOntologyArtifact).toBe("artifacts/ontology/ontology-op.json");
  expect(await builds.getLatestOntology(buildId)).toEqual(ARTIFACT);
});

it("rolls back ontology workspace and records failure without enabling publish", async () => {
  // Make only the ontology worker throw.
  const before = await store.load(buildId);
  await expect(
    builds.runPhase(buildId, "ontology", "ontology-failed"),
  ).rejects.toThrow(/ontology extraction failed/i);
  const after = await store.load(buildId);
  expect(after.checkpointId).toBe(before.checkpointId);
  expect(after.ontologyStatus).toBe("failed");
  expect(store.availableActions(after)).not.toContain("publish");
});
```

Define one small valid `ARTIFACT` constant using the contract from Task 2.

- [ ] **Step 3: Extend build types and persisted state**

In `src/build-types.ts`:

```ts
export type OntologyStatus = "not_run" | "failed" | "built";

export type BuildAction =
  | "fetch"
  | "ingest"
  | "compile"
  | "quality"
  | "repair_citations"
  | "ontology"
  | "publish";

export interface BuildState {
  // existing fields
  ontologyStatus: OntologyStatus;
  latestOntologyArtifact?: string;
}
```

Add ontology request/result variants:

```ts
| { action: "ontology"; buildId: string; targetRoot: string }

| {
    action: "ontology";
    artifact: import("./ontology-types.js").OntologyArtifact;
  }
```

Update `stateSchema` and initial state in `src/build-store.ts`.

- [ ] **Step 4: Derive safe action availability**

Use this compiled-stage policy in `BuildStore.availableActions`:

```ts
if (state.stage === "compiled") {
  const actions: BuildAction[] = ["compile", "quality", "repair_citations"];
  if (state.qualityStatus === "passed") actions.push("ontology");
  if (
    state.qualityStatus === "passed" &&
    state.ontologyStatus === "built"
  ) {
    actions.push("publish");
  }
  return actions;
}
```

- [ ] **Step 5: Execute ontology in the child worker**

In `src/build-worker.ts`, route explicitly rather than allowing ontology to fall
through to citation repair:

```ts
if (request.action === "ontology") {
  report("ontology", { detail: "extracting cited domain relationships" });
  const filings = await baselineManifest();
  const filingDates = Object.fromEntries(
    filings.map((filing) => [filing.outputFile, filing.filedOn]),
  );
  const artifact = await buildWorkspaceOntology(
    path.join(request.targetRoot, "workspace"),
    filingDates,
  );
  return { action: "ontology", artifact };
}
if (request.action === "repair_citations") {
  report("repair_citations");
  const repaired = await repairWorkspaceCitations(
    path.join(request.targetRoot, "workspace"),
  );
  return { action: "repair_citations", ...repaired };
}
return request satisfies never;
```

- [ ] **Step 6: Commit ontology artifacts and reset downstream state**

In `BuildService.runPhase`, after checkpoint commit:

```ts
if (result.action === "ontology") {
  const latestOntologyArtifact = await this.store.writeArtifact(
    buildId,
    "ontology",
    operationId,
    result.artifact,
  );
  const updated = await this.store.updateState({
    ...committed,
    ontologyStatus: "built",
    latestOntologyArtifact,
  });
  if (this.publisher) {
    await this.publisher(
      path.join(this.store.checkpointRoot(buildId, updated.checkpointId!), "workspace"),
      path.join(this.store.varRoot, "staging-wiki"),
    );
  }
  return updated;
}
```

`nextState` must set `ontologyStatus: "not_run"` and clear
`latestOntologyArtifact` for fetch, ingest, compile, and citation repair.
`runQuality` must reset ontology when quality fails. A passing quality rerun on
the exact ontology checkpoint may retain `built`.

In the ontology catch path, call `failPhase` first, then persist
`ontologyStatus: "failed"` against the unchanged checkpoint.

- [ ] **Step 7: Add the artifact reader and publish gate**

Add:

```ts
async getLatestOntology(buildId: string): Promise<OntologyArtifact> {
  const state = await this.store.load(buildId);
  if (!state.latestOntologyArtifact) {
    throw new Error("Ontology has not been built");
  }
  return ontologyArtifactSchema.parse(
    await this.store.readArtifact(buildId, state.latestOntologyArtifact),
  );
}
```

Change publish validation to:

```ts
if (
  current.stage !== "compiled" ||
  current.qualityStatus !== "passed" ||
  current.ontologyStatus !== "built"
) {
  throw new Error(
    "Publish requires a quality-passed compiled checkpoint with a built ontology",
  );
}
```

- [ ] **Step 8: Run staged-build tests**

Run:

```powershell
rtk test npm test -- --run tests/build-store.test.ts tests/build-service.test.ts
rtk tsc -p tsconfig.json --noEmit
```

Expected: PASS, including rollback and publish gating.

- [ ] **Step 9: Commit**

```powershell
rtk git add src/build-types.ts src/build-store.ts src/build-worker.ts src/build-service.ts tests/build-store.test.ts tests/build-service.test.ts
rtk git commit -m "feat: add checkpointed ontology phase"
```

---

### Task 7: Expose the Ontology Operation and Public Graph

**Files:**
- Modify: `src/app.ts`
- Modify: `src/server.ts`
- Modify: `src/domain.ts`
- Modify: `tests/adapter.test.ts`
- Modify: `tests/contracts.test.ts`

**Interfaces:**
- Adds: `POST /v1/builds/:buildId/ontology`.
- Adds: `GET /v1/builds/:buildId/ontology`.
- Adds: `GET /v1/ontology` for the published baseline.
- Changes `GET /v1/demo/state.graph` to the typed domain graph contract.

- [ ] **Step 1: Write failing adapter tests**

Add to `tests/adapter.test.ts`:

```ts
it("queues ontology idempotently only when the build allows it", async () => {
  const first = await request(app)
    .post("/v1/builds/baseline-test/ontology")
    .set("Idempotency-Key", "ontology-1");
  const second = await request(app)
    .post("/v1/builds/baseline-test/ontology")
    .set("Idempotency-Key", "ontology-1");
  expect(first.status).toBe(202);
  expect(second.body.operationId).toBe(first.body.operationId);
});

it("returns the exact retained ontology artifact", async () => {
  const response = await request(app).get("/v1/builds/baseline-test/ontology");
  expect(response.status).toBe(200);
  expect(response.body).toEqual(ARTIFACT);
});

it("does not substitute the old wikilink graph when ontology is absent", async () => {
  const response = await request(appWithoutOntology).get("/v1/demo/state");
  expect(response.body.graph).toEqual({
    schemaVersion: 1,
    nodes: [],
    edges: [],
  });
});
```

Update the `StagedBuildService` stub with `getLatestOntology`.

- [ ] **Step 2: Run adapter tests and verify they fail**

Run:

```powershell
rtk test npm test -- --run tests/adapter.test.ts tests/contracts.test.ts
```

Expected: FAIL because ontology routes and graph mapping do not exist.

- [ ] **Step 3: Extend operation types and deadlines**

In `src/app.ts`:

```ts
export type OperationPhase =
  | "fetch"
  | "normalize"
  | "ingest"
  | "compile"
  | "quality"
  | "repair_citations"
  | "ontology"
  | "publish"
  | "export";
```

Add `ontology: 300_000` to `deadlineByAction`, and include `"ontology"` in the
registered build action list. Ontology is local and must not require
`OPENAI_API_KEY` or `SEC_USER_AGENT`.

- [ ] **Step 4: Add exact artifact routes**

Extend `StagedBuildService`:

```ts
getLatestOntology(buildId: string): Promise<OntologyArtifact>;
```

Add:

```ts
app.get("/v1/builds/:buildId/ontology", async (request, response, next) => {
  if (!options.buildService) {
    response.status(503).json({ error: "Staged builds are not configured" });
    return;
  }
  try {
    response.json(
      await options.buildService.getLatestOntology(request.params.buildId),
    );
  } catch (error) {
    next(error);
  }
});
```

`GET /v1/ontology` must return only the current published baseline's retained
artifact. Return `404 { error: "published ontology is unavailable" }` if the
baseline is not published or has no ontology artifact.

- [ ] **Step 5: Map the artifact to the public graph**

Replace the current `buildGraph` page-wikilink projection with:

```ts
export interface DomainGraphData {
  schemaVersion: 1;
  nodes: Array<{
    id: string;
    label: string;
    type: OntologyNodeType;
    evidenceCount: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: OntologyRelationType;
    assertion: "explicit" | "inferred";
    confidence: number;
    disputeStatus: "undisputed" | "disputed";
    evidence: EvidenceRef[];
  }>;
}

export function ontologyGraph(
  artifact: OntologyArtifact | undefined,
): DomainGraphData {
  if (!artifact) return { schemaVersion: 1, nodes: [], edges: [] };
  return {
    schemaVersion: 1,
    nodes: artifact.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      evidenceCount: node.evidence.length,
    })),
    edges: artifact.edges.map((edge) => ({ ...edge })),
  };
}
```

Remove `buildGraph` from `state()` and calculate `relationships` from
`graph.edges.length`. Load the graph in `state()` with:

```ts
let artifact: OntologyArtifact | undefined;
if (options.buildService) {
  const baseline = await options.buildService.getOrCreateBaseline();
  if (
    baseline.stage === "published" &&
    baseline.ontologyStatus === "built"
  ) {
    artifact = await options.buildService.getLatestOntology(baseline.buildId);
  }
}
const graph = ontologyGraph(artifact);
```

Do not silently fall back to page wikilinks. If a state claims a built ontology
but its artifact is missing or invalid, surface the error rather than returning
an empty success graph.

- [ ] **Step 6: Keep baseline automation honest**

In `stagedBaselineExecutor`, add:

```ts
if (
  current.qualityStatus === "passed" &&
  current.ontologyStatus !== "built"
) {
  report("ontology");
  await options.buildService!.runPhase(
    build.buildId,
    "ontology",
    randomUUID(),
    signal,
  );
  continue;
}
```

Publish remains the final action.

- [ ] **Step 7: Run adapter and contract tests**

Run:

```powershell
rtk test npm test -- --run tests/adapter.test.ts tests/contracts.test.ts
rtk tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
rtk git add src/app.ts src/server.ts src/domain.ts tests/adapter.test.ts tests/contracts.test.ts
rtk git commit -m "feat: expose the audited domain graph"
```

---

### Task 8: Present the Domain Graph and Its Evidence in Streamlit

**Files:**
- Create: `app/ontology_view.py`
- Create: `python_tests/test_ontology_view.py`
- Modify: `app/viewmodel.py`
- Modify: `app/streamlit_app.py`
- Modify: `python_tests/test_viewmodel.py`
- Modify: `python_tests/test_streamlit_app.py`

**Interfaces:**
- Consumes: the `DomainGraphData` returned by `/v1/demo/state` and exact ontology artifact returned by `/v1/builds/:buildId/ontology`.
- Produces: `filter_graph`, `graph_figure`, `edge_options`, and `format_edge_evidence`.

- [ ] **Step 1: Write failing view-model tests**

Add to `python_tests/test_viewmodel.py`:

```python
def test_phase_controls_include_ontology_before_publish() -> None:
    controls = phase_controls(
        {
            "stage": "compiled",
            "qualityStatus": "passed",
            "ontologyStatus": "not_run",
            "availableActions": ["compile", "quality", "repair_citations", "ontology"],
        }
    )
    assert [item.label for item in controls] == [
        "Fetch and normalize filings",
        "Ingest sources",
        "Compile wiki",
        "Run quality checks",
        "Repair quality issues",
        "Build domain ontology",
        "Publish baseline wiki",
    ]
    assert {item.action for item in controls if item.enabled} == {
        "compile",
        "quality",
        "repair_citations",
        "ontology",
    }
```

- [ ] **Step 2: Write failing ontology-view tests**

Create `python_tests/test_ontology_view.py`:

```python
from app.ontology_view import edge_options, filter_graph, format_edge_evidence

GRAPH = {
    "schemaVersion": 1,
    "nodes": [
        {"id": "company/nvidia", "label": "NVIDIA", "type": "Company", "evidenceCount": 1},
        {"id": "product-or-platform/blackwell", "label": "Blackwell", "type": "ProductOrPlatform", "evidenceCount": 1},
    ],
    "edges": [
        {
            "id": "offers:company/nvidia:product-or-platform/blackwell",
            "source": "company/nvidia",
            "target": "product-or-platform/blackwell",
            "type": "offers",
            "assertion": "explicit",
            "confidence": 1,
            "disputeStatus": "undisputed",
            "evidence": [{
                "pageId": "concepts/blackwell",
                "pageTitle": "Blackwell",
                "source": "nvidia-2026-10k.md",
                "start": 10,
                "end": 12,
                "filingDate": "2026-02-25",
                "polarity": "asserted",
                "excerpt": "NVIDIA offers Blackwell.",
            }],
        },
    ],
}

def test_inferred_edges_are_hidden_by_default() -> None:
    inferred = {**GRAPH["edges"][0], "assertion": "inferred", "id": "inferred"}
    filtered = filter_graph({**GRAPH, "edges": [GRAPH["edges"][0], inferred]})
    assert [edge["id"] for edge in filtered["edges"]] == [
        "offers:company/nvidia:product-or-platform/blackwell"
    ]

def test_edge_label_and_evidence_are_auditable() -> None:
    assert edge_options(GRAPH)[0].label == "NVIDIA — offers → Blackwell"
    rows = format_edge_evidence(GRAPH["edges"][0])
    assert rows[0]["Filing evidence"] == "nvidia-2026-10k.md:10-12"
    assert rows[0]["Wiki page"] == "Blackwell"
    assert rows[0]["Filing date"] == "2026-02-25"
    assert rows[0]["Polarity"] == "asserted"
```

- [ ] **Step 3: Run Python tests and verify they fail**

Run:

```powershell
rtk pytest python_tests/test_viewmodel.py python_tests/test_ontology_view.py
```

Expected: FAIL because the ontology phase control and view module do not exist.

- [ ] **Step 4: Add ontology phase controls**

Update the actions in `app/viewmodel.py`:

```python
actions = [
    ("fetch", "Fetch and normalize filings"),
    ("ingest", "Ingest sources"),
    ("compile", "Compile wiki"),
    ("quality", "Run quality checks"),
    ("repair_citations", "Repair quality issues"),
    ("ontology", "Build domain ontology"),
    ("publish", "Publish baseline wiki"),
]
```

- [ ] **Step 5: Implement deterministic filtering and evidence formatting**

Create `app/ontology_view.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from math import cos, pi, sin
from typing import Any

import plotly.graph_objects as go

NODE_COLORS = {
    "Company": "#2563eb",
    "BusinessSegment": "#7c3aed",
    "ProductOrPlatform": "#16a34a",
    "Technology": "#0891b2",
    "Market": "#d97706",
    "Strategy": "#9333ea",
    "Risk": "#dc2626",
    "RegulationOrConstraint": "#475569",
}

@dataclass(frozen=True)
class EdgeOption:
    id: str
    label: str

def filter_graph(
    graph: dict[str, Any],
    *,
    node_types: set[str] | None = None,
    relation_types: set[str] | None = None,
    include_inferred: bool = False,
) -> dict[str, Any]:
    nodes = [
        node for node in graph.get("nodes", [])
        if node_types is None or node.get("type") in node_types
    ]
    known = {node["id"] for node in nodes}
    edges = [
        edge for edge in graph.get("edges", [])
        if edge.get("source") in known
        and edge.get("target") in known
        and (relation_types is None or edge.get("type") in relation_types)
        and (include_inferred or edge.get("assertion") == "explicit")
    ]
    connected = {endpoint for edge in edges for endpoint in (edge["source"], edge["target"])}
    return {
        "schemaVersion": 1,
        "nodes": [node for node in nodes if node["id"] in connected],
        "edges": edges,
    }

def edge_options(graph: dict[str, Any]) -> list[EdgeOption]:
    labels = {node["id"]: node["label"] for node in graph.get("nodes", [])}
    return [
        EdgeOption(
            id=edge["id"],
            label=f"{labels[edge['source']]} — {edge['type']} → {labels[edge['target']]}",
        )
        for edge in graph.get("edges", [])
    ]

def format_edge_evidence(edge: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "Wiki page": evidence["pageTitle"],
            "Filing evidence": (
                f"{evidence['source']}:{evidence['start']}-{evidence['end']}"
            ),
            "Filing date": evidence["filingDate"],
            "Polarity": evidence["polarity"],
            "Excerpt": evidence["excerpt"],
        }
        for evidence in edge.get("evidence", [])
    ]
```

- [ ] **Step 6: Implement a deterministic typed graph figure**

In `app/ontology_view.py`, add `graph_figure(graph)` that:

- groups nodes by type in the fixed order of `NODE_COLORS`;
- places groups on separate angular sectors;
- sorts nodes by ID before assigning coordinates;
- renders one edge trace per relationship type so the legend is meaningful;
- renders one node trace per node type;
- includes node type and evidence count in hover text;
- uses dashed lines for inferred edges and a red outline for disputed edges;
- never uses random coordinates.

The function signature is:

```python
def graph_figure(graph: dict[str, Any]) -> go.Figure:
    ...
```

Set `uirevision="domain-ontology-v1"` so filters do not unnecessarily reset
zoom.

- [ ] **Step 7: Replace the page-wikilink graph in Streamlit**

In `app/streamlit_app.py`:

1. Remove the existing `knowledge_graph` function.
2. Import `edge_options`, `filter_graph`, `format_edge_evidence`, and
   `graph_figure`.
3. Add `"ontology": 300` to `timeouts`.
4. Show `ontologyStatus` beside stage and quality.
5. When the graph has data:
   - show multiselect filters for node types and relationship types;
   - show an unchecked `Include inferred relationships` checkbox;
   - render `graph_figure(filter_graph(...))`;
   - show an edge selectbox using `edge_options`;
   - display relationship type, explicit/inferred status, confidence, dispute
     status, and `st.dataframe(format_edge_evidence(edge))`.
6. When the graph is empty, display:

```python
st.info("Build and publish the domain ontology to display cited industry relationships.")
```

Do not fall back to page nodes.

- [ ] **Step 8: Add Streamlit integration assertions**

Update `python_tests/test_streamlit_app.py` so the first seven buttons are:

```python
[
    "Fetch and normalize filings",
    "Ingest sources",
    "Compile wiki",
    "Run quality checks",
    "Repair quality issues",
    "Build domain ontology",
    "Publish baseline wiki",
]
```

Extend `python_tests/test_ontology_view.py` with:

```python
from app.ontology_view import graph_figure

def test_graph_figure_uses_typed_traces_without_random_layout() -> None:
    first = graph_figure(GRAPH)
    second = graph_figure(GRAPH)
    assert first.to_plotly_json() == second.to_plotly_json()
    assert {trace.name for trace in first.data} >= {
        "Company",
        "ProductOrPlatform",
        "offers",
    }
```

In the existing empty-state `AppTest`, assert that the ontology button is
disabled before quality passes and the info panel says:

```python
"Build and publish the domain ontology to display cited industry relationships."
```

The graph/evidence behavior is tested through the pure view functions above;
the manual release check in Task 9 verifies Streamlit against a live artifact.

- [ ] **Step 9: Run Python tests and lint**

Run:

```powershell
rtk pytest python_tests/test_viewmodel.py python_tests/test_ontology_view.py python_tests/test_streamlit_app.py
rtk ruff check app python_tests
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
rtk git add app/ontology_view.py app/viewmodel.py app/streamlit_app.py python_tests/test_ontology_view.py python_tests/test_viewmodel.py python_tests/test_streamlit_app.py
rtk git commit -m "feat: present the cited industry graph"
```

---

### Task 9: Document, Verify, and Manually Exercise the Complete Flow

**Files:**
- Modify: `README.md`
- Modify: `docs/runbook.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: documented operator workflow and release evidence.

- [ ] **Step 1: Update README workflow**

Document this exact sequence:

```text
Fetch and normalize filings
→ Ingest sources
→ Compile wiki (including NVIDIA, AMD, and Intel entity pages)
→ Run quality checks / repair eligible issues
→ Build domain ontology
→ Inspect typed nodes, relationships, and exact evidence
→ Publish baseline wiki
```

State explicitly that:

- the ontology phase is deterministic and makes no model call;
- only citation-bearing compiled paragraphs can create edges;
- the node catalog defines recognizable domain objects but does not assert
  facts;
- entity pages are generated by LLM-Wiki from configured seeds;
- inferred edges are hidden by default and none are emitted in version 1;
- the page graph and the domain graph are different layers.

- [ ] **Step 2: Update the runbook**

Add:

- `ontologyStatus` meanings;
- the five-minute ontology deadline;
- the checkpoint and rollback behavior;
- build artifact location:
  `var/builds/<buildId>/artifacts/ontology/<operationId>.json`;
- workspace artifact location:
  `<checkpoint>/workspace/.llmwiki/domain-ontology.json`;
- how to inspect `GET /v1/builds/<buildId>/ontology`;
- how to interpret rejection counters;
- recovery: fix catalog/rule/evidence defects, rerun quality if pages changed,
  then rerun ontology;
- warning that editing generated runtime artifacts is unsupported.

- [ ] **Step 3: Run the complete offline verification suite**

Run:

```powershell
rtk npm run build
rtk test npm test
rtk pytest python_tests
rtk ruff check app python_tests
rtk proxy powershell -NoProfile -File scripts/verify-demo.ps1
```

Expected:

- TypeScript build passes.
- All Vitest tests pass.
- All pytest tests pass.
- Ruff reports no findings.
- `verify-demo.ps1` validates tools, configuration shape, dependencies, and
  ports without making SEC or paid provider calls.

- [ ] **Step 4: Run a manual cost-bearing release check**

With valid `OPENAI_API_KEY` and monitored `SEC_USER_AGENT`:

1. Run `scripts/reset-demo.ps1`.
2. Run `scripts/start.ps1`.
3. Confirm the wiki starts empty.
4. Complete fetch, ingest, and compile.
5. In the staging viewer, confirm NVIDIA, Advanced Micro Devices, and Intel have
   `kind: entity`.
6. Run quality and repair until citation errors are zero.
7. Run **Build domain ontology**.
8. Confirm the graph contains only typed domain nodes and explicit cited edges.
9. Select at least one edge of every relationship type produced and verify its
   page, filing, and line range against the source Markdown.
10. Confirm no edge appears solely because two pages share a source or similar
    wording.
11. Review the passing rollback test from Task 6; do not inject a failure into
    the live release workspace.
12. Publish and confirm `/v1/demo/state` and Streamlit show the same graph.
13. Confirm the native LLM-Wiki viewer still shows the generated entity pages.
14. Stop services and confirm ports 4310, 4320, 4321, and 8501 have no listeners.

- [ ] **Step 5: Commit documentation**

```powershell
rtk git add README.md docs/runbook.md
rtk git commit -m "docs: explain the domain ontology workflow"
```

- [ ] **Step 6: Final repository verification**

Run:

```powershell
rtk git status --short
rtk git log --oneline -10
```

Expected: only pre-existing unrelated untracked paths remain; implementation
files are committed in the task-sized commits listed above.
