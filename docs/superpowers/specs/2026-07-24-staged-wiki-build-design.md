# Staged Wiki Build Design

## Purpose

Replace the opaque, all-or-nothing baseline operation with a persistent staged build. Each
successful phase becomes a restart-safe checkpoint. A failed phase restores only its own
starting checkpoint, retains sanitized diagnostic artifacts, and never changes the published
wiki. Once the workflow is stable, the same phase APIs will power the single **Build baseline
wiki** action while the phase controls move under **Advanced build controls**.

## Workspace layout

```text
var/
  wiki/                              # Published workspace used by the native viewer
  builds/
    baseline-<build-id>/
      workspace/                    # Current successful staging checkpoint
      corpus/                       # Normalized filings and fetch receipts
      checkpoints/<stage>/          # Immutable successful phase snapshots
      failures/<operation-id>/      # Sanitized failed output and diagnostics
      build-state.json
```

The staging workspace must be persisted on disk rather than held only in process memory.
Temporary phase work happens in a sibling directory. A phase promotes its temporary directory
to the staging checkpoint only after validation succeeds. Publication promotes the validated
staging workspace to `var/wiki` using a Windows-safe directory swap while the viewer is stopped
and restarted. The previous published workspace remains recoverable until the swap succeeds.

## State model

The persisted build stage is:

```text
empty → fetched → ingested → compiled → published
```

The compiled stage separately records quality status as `not_run`, `failed`, or `passed`.
`failed` retains the compiled checkpoint and its complete lint report. Quality is read-only, so
it does not roll back generated pages. Recompiling starts from `ingested`; deterministic citation
repair creates a new `compiled` checkpoint with quality reset to `not_run`; rerunning quality
starts from the latest compiled checkpoint. Publish requires quality status `passed`.

`build-state.json` records the build ID, stage, checkpoint identity, timestamps, normalized
corpus receipts, actual compiler source filenames, operation history, quality summary, and
published timestamp. It contains no credentials or raw provider responses.

## Phase APIs and operations

All mutations retain the existing serialization lock and idempotency behavior. Each phase is a
background operation with progress, deadline, sanitized error, and cancellation support.

- `POST /v1/builds/baseline` creates or returns the current baseline build.
- `GET /v1/builds/:buildId` returns persisted stage, available actions, artifacts, and history.
- `POST /v1/builds/:buildId/fetch` fetches and normalizes the pinned baseline filings.
- `POST /v1/builds/:buildId/ingest` creates the staging compiler workspace and ingests the
  checkpointed corpus.
- `POST /v1/builds/:buildId/compile` compiles generated pages without running quality gates.
- `POST /v1/builds/:buildId/quality` runs lint and fast evaluation without mutating pages.
- `POST /v1/builds/:buildId/repair-citations` applies only auditable deterministic repairs.
- `POST /v1/builds/:buildId/publish` atomically promotes a quality-passed build.
- `GET /v1/builds/:buildId/artifacts/...` exposes bounded, sanitized corpus, page, receipt,
  compiler, lint, and repair artifacts.
- `GET /v1/operations/:operationId` remains the polling interface and gains the build ID and
  phase action.

The compatibility endpoint `POST /v1/demo/baseline` will initially orchestrate the same phase
services. During stabilization the Streamlit UI uses explicit phase endpoints. After
stabilization the main action resumes orchestration and the explicit controls remain available
under an advanced section.

## Phase contracts

### Fetch

Fetch validates SEC redirects, host, content type, response size, accession, form, filing date,
report period, required sections, and total corpus size. It writes normalized Markdown and
receipts into a temporary corpus directory. Success validates every pinned filing and promotes
the corpus checkpoint. Retrying later reuses this checkpoint unless the user explicitly
refetches.

### Ingest

Ingest creates a fresh compiler workspace, installs the schema, and calls `ingestText` using
extension-free titles. It records the actual filenames returned by LLM-Wiki and verifies that
each exists in `sources/`, is represented in compiler state, and has a nonzero line count.
Success promotes the complete compiler workspace checkpoint.

### Compile

Compile copies the ingested checkpoint to a temporary workspace and invokes the compiler.
Success requires compiler completion, parseable generated pages, and all required pages.
Citation lint is deliberately excluded. The generated pages, source assignments, compiler
warnings, timing, and attempt metadata remain inspectable after promotion.

Recompile preserves the preceding compiled checkpoint and replaces it only after a new compile
passes these compile-level gates.

### Quality

Quality runs lint and fast evaluation against the compiled staging workspace. It stores every
finding with rule, severity, page, line, citation marker, and message. Citation findings prevent
publication but do not delete or roll back compiled pages. Broken wikilinks and variable quality
scores remain visible without becoming publication gates unless explicitly configured later.

### Citation repair

Automatic repair is conservative and deterministic. It may:

- Normalize ASCII-equivalent citation punctuation and supported line-range syntax.
- Replace a unique, provable filename alias with the actual ingested source filename.
- Remove an invalid range while retaining a broad source citation only when the source mapping
  is certain.

It must never select a source based only on claim semantics or fabricate a range. Unresolvable
markers remain findings. Every transformation records page, line, before, after, and reason.
Repair works on a temporary copy and promotes a new compiled checkpoint only if page parsing and
workspace consistency still pass. Quality must be rerun afterward.

### Publish

Publish is enabled only when the latest quality checkpoint passed citation gates, required pages
exist, and compiler state is consistent with the staged files. It stops the native viewer,
performs the recoverable directory promotion, restarts the viewer, and verifies health. Failure
restores the previous published workspace byte-for-byte.

## Streamlit workflow

The stabilization UI presents buttons according to the server-reported available actions:

1. **Fetch and normalize filings**
2. **Ingest sources**
3. **Compile wiki**
4. **Run quality checks**
5. **Repair citations** or **Recompile affected pages** when applicable
6. **Publish baseline wiki**

Each section shows its checkpoint timestamp and artifacts. Compilation exposes an
**Open staging wiki** link served by a separate loopback viewer on `127.0.0.1:4321`, while
**Open browsable wiki** continues to show only the published workspace on `127.0.0.1:4320`.
The staging viewer is read-only and clearly labelled as unvalidated.

Quality failures render a table containing the exact page, line, rule, citation, and explanation.
The user can rerun only the failed or corrective phase. Paid or network-bearing actions are
labelled; quality and artifact inspection are local.

After stabilization, **Build baseline wiki** invokes the same phase services in sequence,
skipping valid checkpoints. On failure it stops at the failing phase and links to **Advanced
build controls**. No successful paid phase is repeated automatically.

## Recovery and retention

- A phase never mutates its input checkpoint.
- Failed temporary workspaces are moved to the failure directory after secrets and oversized
  provider material are excluded.
- Failure artifacts are diagnostic, not eligible for publication.
- A bounded retention policy keeps the latest successful checkpoint per stage and the latest
  three failures per action; cleanup never removes the published workspace or active build.
- On restart, the adapter validates `build-state.json` against checkpoint contents before
  enabling actions. An inconsistent stage is reported as recoverable rather than guessed.

## Verification

Automated tests cover state transitions, action gating, checkpoint promotion, phase-local
rollback, restart recovery, idempotency, serialization, timeout termination, secret redaction,
artifact retention, citation-detail preservation, conservative repair, Windows viewer locks,
atomic publication, and compatibility orchestration.

Streamlit tests cover all phase buttons, progress, restart-resume behavior, artifact inspection,
quality tables, staging and published viewer links, repair/recompile choices, and final
publication. Process tests cover the adapter on 4310, published viewer on 4320, staging viewer on
4321, and Streamlit on 8501, and confirm stop leaves no listeners on those ports.

The manual cost-bearing test fetches the live filings, ingests once, compiles once, diagnoses and
repairs or selectively recompiles citation failures, passes quality, publishes, browses the
published wiki, and confirms restart preserves the published result and current build history.
