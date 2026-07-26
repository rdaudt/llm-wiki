# Staged Wiki Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, phase-driven baseline workflow that checkpoints fetch, ingest, compile, quality, repair, and publish work while retaining exact failure diagnostics.

**Architecture:** A `BuildStore` owns durable build metadata and immutable checkpoints beneath `var/builds`. A phase runner copies the last checkpoint into a temporary sibling, executes one bounded worker action, validates it, and promotes it only on success. The published compiler workspace remains `var/wiki`; a separate staging viewer exposes the current compiled checkpoint during stabilization.

**Tech Stack:** Node 24.x, TypeScript ESM, Express 5.2.1, llm-wiki-compiler 1.1.0, Vitest 4.1.10, Python 3.12.x, Streamlit 1.52.2, pytest 9.0.2, PowerShell.

## Global Constraints

- Runtime remains live-only: no replay snapshots, packaged wiki pages, static answers, or synthetic quality data.
- Published viewer remains `127.0.0.1:4320`; staging viewer uses `127.0.0.1:4321`; adapter uses 4310 and Streamlit uses 8501.
- Every phase works on a temporary copy and promotes only validated results.
- Citation repair must be deterministic, auditable, and must never infer evidence from claim semantics.
- Quality failure retains compiled pages and complete sanitized lint findings.
- Paid or network-bearing phases require explicit user actions during stabilization.
- Existing credentials, child-worker deadlines, serialization, idempotency, secret redaction, and loopback-only constraints remain enforced.

---

## File structure

- Create `src/build-types.ts`: shared state, action, artifact, and operation contracts.
- Create `src/build-store.ts`: filesystem layout, atomic JSON writes, checkpoint copying/promotion, validation, and retention.
- Create `src/citation-repair.ts`: pure conservative citation transformations and audit records.
- Create `src/build-worker.ts`: child-process entry point for fetch, ingest, compile, and repair.
- Create `src/build-service.ts`: state-machine rules, phase transactions, quality, publish, and compatibility orchestration.
- Modify `src/app.ts`: staged REST API and operation metadata.
- Modify `src/server.ts`: construct the build service and recover persisted state.
- Modify `src/compiler-client.ts`: create wiki clients for arbitrary staging roots.
- Modify `src/sec.ts`: expose normalized fetch results without coupling them to compilation.
- Modify `src/operations.ts`: execute typed phase worker requests and retain diagnostic failures.
- Modify `app/streamlit_app.py`: staged controls, artifact tables, quality findings, staging viewer link.
- Modify `app/viewmodel.py`: staged API models and Vancouver progress formatting.
- Modify `scripts/start.ps1`, `scripts/stop.ps1`, `scripts/reset-demo.ps1`, `scripts/verify-demo.ps1`: fourth service and durable build lifecycle.
- Create `tests/build-store.test.ts`, `tests/build-service.test.ts`, `tests/citation-repair.test.ts`.
- Modify `tests/adapter.test.ts`, `tests/operations.test.ts`, `tests/pipeline.test.ts`.
- Modify `python_tests/test_streamlit_app.py`, `python_tests/test_process_scripts.py`, `python_tests/test_viewmodel.py`.
- Modify `README.md`: staged stabilization workflow and eventual one-button behavior.

---

### Task 1: Persisted build contracts and state store

**Files:**
- Create: `src/build-types.ts`
- Create: `src/build-store.ts`
- Create: `tests/build-store.test.ts`

**Interfaces:**
- Produces:

```ts
export type BuildStage = "empty" | "fetched" | "ingested" | "compiled" | "published";
export type QualityStatus = "not_run" | "failed" | "passed";
export type BuildAction = "fetch" | "ingest" | "compile" | "quality" | "repair_citations" | "publish";

export interface BuildState {
  buildId: string;
  kind: "baseline";
  stage: BuildStage;
  qualityStatus: QualityStatus;
  checkpointId?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  sourceFiles: Array<{ filingId: string; filename: string; lines: number }>;
  latestQualityArtifact?: string;
}

export class BuildStore {
  constructor(varRoot: string);
  createBaseline(): Promise<BuildState>;
  load(buildId: string): Promise<BuildState>;
  currentBaseline(): Promise<BuildState | undefined>;
  availableActions(state: BuildState): BuildAction[];
  beginPhase(buildId: string, action: BuildAction): Promise<PhaseTransaction>;
  commitPhase(tx: PhaseTransaction, next: BuildState): Promise<BuildState>;
  failPhase(tx: PhaseTransaction, artifact: FailureArtifact): Promise<void>;
  pruneFailures(buildId: string, action: BuildAction, keep?: number): Promise<void>;
}
```

- [ ] **Step 1: Write failing state-transition and persistence tests**

Create tests that use a temporary directory and assert:

```ts
const store = new BuildStore(temp);
const empty = await store.createBaseline();
expect(store.availableActions(empty)).toEqual(["fetch"]);
const loaded = await store.load(empty.buildId);
expect(loaded).toEqual(empty);
```

Also assert atomic phase promotion leaves the previous checkpoint unchanged, a failed phase retains its sanitized artifact, inconsistent JSON is rejected, and only the latest three failures per action remain.

- [ ] **Step 2: Verify the tests fail**

Run: `rtk test npm test -- --run tests/build-store.test.ts`

Expected: FAIL because `BuildStore` and its contracts do not exist.

- [ ] **Step 3: Implement contracts, safe paths, atomic JSON, and phase transactions**

Use `resolve` plus relative-path containment checks for every build-derived path. Write JSON to a sibling `.tmp-<uuid>` and rename it into place. `beginPhase` copies the current checkpoint to a sibling temporary directory; `commitPhase` renames the completed temporary workspace into `checkpoints/<checkpointId>` and updates state last. `failPhase` moves sanitized diagnostics to `failures/<operationId>` and deletes only the verified temporary directory.

- [ ] **Step 4: Run focused and existing runtime tests**

Run: `rtk test npm test -- --run tests/build-store.test.ts tests/runtime.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/build-types.ts src/build-store.ts tests/build-store.test.ts
rtk git commit -m "feat: add durable staged build store"
```

---

### Task 2: Split live pipeline into independently executable phases

**Files:**
- Create: `src/build-worker.ts`
- Create: `src/build-service.ts`
- Modify: `src/sec.ts`
- Modify: `src/compiler-client.ts`
- Modify: `src/operations.ts`
- Modify: `tests/operations.test.ts`
- Create: `tests/build-service.test.ts`

**Interfaces:**
- Consumes: `BuildStore`, `BuildState`, `BuildAction`, `PhaseTransaction`.
- Produces:

```ts
export interface BuildService {
  getOrCreateBaseline(): Promise<BuildState>;
  getBuild(buildId: string): Promise<BuildView>;
  start(buildId: string, action: BuildAction, idempotencyKey?: string): Promise<string>;
  getArtifact(buildId: string, artifactPath: string): Promise<unknown>;
}

export type BuildWorkerRequest =
  | { action: "fetch"; buildId: string; targetRoot: string }
  | { action: "ingest"; buildId: string; corpusRoot: string; targetRoot: string }
  | { action: "compile"; buildId: string; targetRoot: string }
  | { action: "repair_citations"; buildId: string; targetRoot: string };
```

- [ ] **Step 1: Write failing phase-boundary tests**

Assert fetch never creates a compiler workspace, ingest never calls compile, compile never calls lint, and quality never mutates the checkpoint. Assert each successful phase advances exactly one stage and a failed phase leaves state/checkpoint identity unchanged.

- [ ] **Step 2: Verify tests fail**

Run: `rtk test npm test -- --run tests/build-service.test.ts tests/operations.test.ts`

Expected: FAIL because phased service and typed worker request are absent.

- [ ] **Step 3: Implement worker actions and service state machine**

Move the existing `runPipeline` responsibilities behind four worker actions. Fetch writes normalized Markdown and receipts. Ingest installs schema, ingests extension-free titles, records the exact returned filenames, and verifies source files and compiler state. Compile requires no compiler errors, parseable pages, and the three required page slugs, but does not lint. Quality runs in the adapter process against the immutable compiled checkpoint and writes the full result JSON without modifying pages.

- [ ] **Step 4: Implement deadline, rollback, and diagnostic behavior**

Keep fetch/ingest/compile/repair in terminating child workers. On failure or timeout, terminate the worker, run supported compiler recovery only for compiler-mutating actions, save the sanitized worker error and bounded generated artifacts, and call `failPhase`. Preserve the current async lock and `(buildId, action, idempotencyKey)` identity.

- [ ] **Step 5: Run phase and regression tests**

Run: `rtk test npm test -- --run tests/build-service.test.ts tests/operations.test.ts tests/pipeline.test.ts tests/sec.test.ts`

Expected: all tests pass and no test invokes SEC or OpenAI.

- [ ] **Step 6: Commit**

```powershell
rtk git add src/build-worker.ts src/build-service.ts src/sec.ts src/compiler-client.ts src/operations.ts tests/build-service.test.ts tests/operations.test.ts tests/pipeline.test.ts
rtk git commit -m "feat: execute baseline build as checkpointed phases"
```

---

### Task 3: Preserve exact quality diagnostics

**Files:**
- Modify: `src/build-service.ts`
- Modify: `src/build-types.ts`
- Modify: `tests/build-service.test.ts`
- Modify: `tests/adapter.test.ts`

**Interfaces:**
- Produces:

```ts
export interface QualityFinding {
  rule: string;
  severity: string;
  page: string;
  line?: number;
  citation?: string;
  message: string;
}

export interface QualityArtifact {
  createdAt: string;
  passed: boolean;
  findings: QualityFinding[];
  lint: unknown;
  evaluation: unknown;
}
```

- [ ] **Step 1: Write a failing diagnostic-retention test**

Feed lint results containing a broken citation and malformed claim citation. Assert `qualityStatus` becomes `failed`, the compiled checkpoint ID does not change, and the stored artifact includes exact file, line, marker, and message.

- [ ] **Step 2: Verify the test fails**

Run: `rtk test npm test -- --run tests/build-service.test.ts -t quality`

Expected: FAIL because quality details are currently reduced to rule names and discarded during rollback.

- [ ] **Step 3: Implement lossless sanitized quality artifacts**

Extract the marker from the compiler message only for display; retain the original sanitized message. Bound findings by count and message length while recording truncation explicitly. Citation errors set `failed`; no citation errors set `passed`. Preserve broken-wikilink and variable score results as non-gating findings.

- [ ] **Step 4: Verify**

Run: `rtk test npm test -- --run tests/build-service.test.ts tests/adapter.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/build-service.ts src/build-types.ts tests/build-service.test.ts tests/adapter.test.ts
rtk git commit -m "feat: retain exact wiki quality findings"
```

---

### Task 4: Conservative citation repair

**Files:**
- Create: `src/citation-repair.ts`
- Create: `tests/citation-repair.test.ts`
- Modify: `src/build-worker.ts`
- Modify: `src/build-service.ts`

**Interfaces:**
- Produces:

```ts
export interface CitationRepair {
  page: string;
  line: number;
  before: string;
  after: string;
  reason: "normalized-syntax" | "unique-filename-alias" | "removed-invalid-range";
}

export function repairWorkspaceCitations(root: string): Promise<{
  repairs: CitationRepair[];
  unresolved: QualityFinding[];
}>;
```

- [ ] **Step 1: Write failing pure repair tests**

Cover ASCII dash normalization, `: lines 10-20`, exact unique filename aliases, valid ranges, out-of-range spans converted to broad citations when the filename is certain, ambiguous aliases left unchanged, unknown sources left unchanged, multiple source entries, and idempotence.

- [ ] **Step 2: Verify tests fail**

Run: `rtk test npm test -- --run tests/citation-repair.test.ts`

Expected: FAIL because the repair module does not exist.

- [ ] **Step 3: Implement parser and conservative transformations**

Read actual `sources/*.md`, construct aliases from exact filenames and normalized stems, and transform only `^[...]` markers whose source identity is unique. Validate every numeric span against the cited source line count. Record every byte-changing transformation. Do not use an LLM and do not choose a source from prose meaning.

- [ ] **Step 4: Integrate repair as a compiled-to-compiled transaction**

Copy the compiled checkpoint, repair pages, verify frontmatter/page parsing, promote a new compiled checkpoint, reset quality to `not_run`, and retain `repairs.json`. If there are no safe repairs, complete without changing checkpoint content while preserving unresolved findings.

- [ ] **Step 5: Verify**

Run: `rtk test npm test -- --run tests/citation-repair.test.ts tests/build-service.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
rtk git add src/citation-repair.ts src/build-worker.ts src/build-service.ts tests/citation-repair.test.ts tests/build-service.test.ts
rtk git commit -m "feat: add auditable citation repair phase"
```

---

### Task 5: Staged REST API and compatibility orchestration

**Files:**
- Modify: `src/app.ts`
- Modify: `src/server.ts`
- Modify: `tests/adapter.test.ts`
- Modify: `tests/contracts.test.ts`

**Interfaces:**
- Consumes: `BuildService`.
- Produces endpoints specified in the design, returning `202 { operationId }` for phase starts and `409` with allowed actions for invalid transitions.

- [ ] **Step 1: Write failing API contract tests**

Test build creation/read, action gating, operation polling with `buildId` and action, artifact path confinement, credential gating for paid phases, quality details, publish gating, idempotency, and compatibility orchestration resuming from valid checkpoints.

- [ ] **Step 2: Verify tests fail**

Run: `rtk test npm test -- --run tests/adapter.test.ts tests/contracts.test.ts`

Expected: staged routes return 404.

- [ ] **Step 3: Implement staged routes**

Validate parameters with Zod, return server-derived `availableActions`, never accept filesystem paths from clients, and preserve sanitized error contracts. Keep `/v1/demo/baseline`, but make it call the same service sequence and stop at the first failed phase.

- [ ] **Step 4: Verify**

Run: `rtk test npm test -- --run tests/adapter.test.ts tests/contracts.test.ts tests/build-service.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/app.ts src/server.ts tests/adapter.test.ts tests/contracts.test.ts
rtk git commit -m "feat: expose staged baseline build API"
```

---

### Task 6: Atomic publication and dual viewers

**Files:**
- Modify: `src/build-service.ts`
- Modify: `scripts/start.ps1`
- Modify: `scripts/stop.ps1`
- Modify: `scripts/reset-demo.ps1`
- Modify: `scripts/verify-demo.ps1`
- Modify: `python_tests/test_process_scripts.py`
- Modify: `tests/build-service.test.ts`

**Interfaces:**
- Publish stops PID-owned viewer 4320, swaps only resolved `var/wiki`, restarts viewer, and verifies `/health` plus the viewer listener.
- Staging viewer reads the active compiled checkpoint on 4321 and is restarted after compile or repair promotion.

- [ ] **Step 1: Write failing publication and process tests**

Assert failed publication restores the previous published tree byte-for-byte. Assert start owns listeners 4310, 4320, 4321, and 8501; stop removes all four; unrelated listeners are never killed.

- [ ] **Step 2: Verify tests fail**

Run: `rtk test npm test -- --run tests/build-service.test.ts -t publish`

Run: `rtk proxy python -m pytest python_tests/test_process_scripts.py -q`

Expected: failures because 4321 and atomic staged publication are absent.

- [ ] **Step 3: Implement publish transaction and PID-owned viewer lifecycle**

Use explicit resolved paths and Windows-safe retries. Never recursively remove the workspace root held by a live viewer. Stop only the recorded viewer PID, rename published content to a sibling recovery directory, promote a copy of the quality-passed checkpoint, restart, health-check, then remove recovery data. On any failure restore recovery content and restart the prior viewer.

- [ ] **Step 4: Verify**

Run the focused TypeScript test, then stop local services and run the focused Python process test.

Expected: all tests pass and no listeners remain after the test.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/build-service.ts scripts/start.ps1 scripts/stop.ps1 scripts/reset-demo.ps1 scripts/verify-demo.ps1 tests/build-service.test.ts python_tests/test_process_scripts.py
rtk git commit -m "feat: publish staged wiki atomically"
```

---

### Task 7: Streamlit stabilization workflow

**Files:**
- Modify: `app/viewmodel.py`
- Modify: `app/streamlit_app.py`
- Modify: `python_tests/test_viewmodel.py`
- Modify: `python_tests/test_streamlit_app.py`

**Interfaces:**
- Consumes `BuildView.availableActions`, operation polling, bounded artifacts, and quality details.
- Produces explicit phase controls and published/staging viewer links.

- [ ] **Step 1: Write failing UI tests**

Mock each stage and assert only valid buttons are enabled. Verify paid/network labels, checkpoint timestamps, source filename table, compiled page list, exact citation finding table, repair/recompile actions, Vancouver deadlines, staging warning, and publish enablement only after passed quality.

- [ ] **Step 2: Verify tests fail**

Stop running services, then run:

`rtk proxy python -m pytest python_tests/test_viewmodel.py python_tests/test_streamlit_app.py -q`

Expected: failures because staged controls and views are absent.

- [ ] **Step 3: Implement API models and phase UI**

Render the six actions in order using server-provided gating. Poll only the selected operation and rerun after terminal status. Use placeholders so polling does not append duplicate status lines. Render quality findings without collapsing rule/message detail. Keep curated questions locked until published baseline.

- [ ] **Step 4: Verify**

Run the same Python test command.

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
rtk git add app/viewmodel.py app/streamlit_app.py python_tests/test_viewmodel.py python_tests/test_streamlit_app.py
rtk git commit -m "feat: add staged baseline controls to Streamlit"
```

---

### Task 8: Documentation, full verification, and manual handoff

**Files:**
- Modify: `README.md`
- Create: `docs/runbook.md`

**Interfaces:**
- Documents stabilization workflow, recovery, artifacts, cost-bearing actions, and eventual advanced-control behavior.

- [ ] **Step 1: Update operator documentation**

Document start/stop, the six-button sequence, checkpoint reuse, exact failure inspection, citation repair boundaries, staging versus published viewer, reset behavior, and the fact that live SEC/OpenAI checks are manual and cost-bearing.

- [ ] **Step 2: Run static verification**

```powershell
rtk proxy npm.cmd run build
rtk proxy npm.cmd test -- --run
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop.ps1
rtk proxy python -m pytest python_tests
rtk proxy python -m ruff check app python_tests
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-demo.ps1
```

Expected: build succeeds; all TypeScript and Python tests pass; Ruff is clean; verification performs no paid model call.

- [ ] **Step 3: Run process verification**

Start services, verify health and listeners only on 4310, 4320, 4321, and 8501, then stop and confirm no listeners remain. Restart for user handoff with build stage `empty` or the last intentionally persisted build.

- [ ] **Step 4: Perform diff and secret review**

Run:

```powershell
rtk git diff --check
rtk grep "OPENAI_API_KEY=|Bearer [A-Za-z0-9_-]" src app tests python_tests docs
```

Expected: no whitespace errors and no embedded credentials.

- [ ] **Step 5: Commit**

```powershell
rtk git add README.md docs/runbook.md
rtk git commit -m "docs: document staged live wiki workflow"
```

- [ ] **Step 6: Hand off manual cost-bearing release test**

Ask the user to fetch, ingest, compile, inspect any exact citation findings, repair or selectively recompile, rerun quality, publish, browse both viewers, restart, and confirm state persists. Do not initiate this sequence automatically.
