# Staged live-wiki runbook

## Normal operation

Run `scripts/start.ps1`. A normal restart preserves `var/builds`, the staging
workspace, and the published workspace. Streamlit opens automatically.

Complete the controls in order:

1. **Fetch and normalize filings** performs SEC network requests and checkpoints
   normalized Markdown plus receipts.
2. **Ingest sources** invokes LLM-Wiki and records its actual source filenames.
3. **Compile wiki** invokes OpenAI and checkpoints pages without running lint.
4. **Run quality checks** runs local lint/evaluation and retains exact findings.
5. **Repair citations** applies only auditable deterministic transformations.
6. **Publish baseline wiki** is enabled only after citation quality passes.

SEC fetches and model operations are networked and potentially cost-bearing.
Quality, inspection, deterministic repair, and publication are local.

## Viewers

- <http://127.0.0.1:4320> shows only published knowledge.
- <http://127.0.0.1:4321> shows the latest compiled or repaired staging
  checkpoint. Treat it as unvalidated until quality passes.

Streamlit shows the build ID, stage, quality status, checkpoint ID, actual
compiler filenames, and retained quality findings.

## Citation failures

Do not refetch or ingest. Inspect the quality table:

- `broken-citation` means the source is absent or its range is out of bounds.
- `malformed-claim-citation` means the marker is not `^[file.md]`,
  `^[file.md:N-N]`, or `^[file.md#LN-LN]`.

Use **Repair citations** only when the mapping is deterministic. The repair
artifact records page, line, before, after, and reason. Unknown or ambiguous
sources remain unresolved. Run quality again. Use **Compile wiki** if the model
output must be replaced.

## Recovery

A mutating phase works on a temporary copy. Success promotes a new immutable
checkpoint; failure removes only temporary work and retains sanitized
diagnostics. Quality does not mutate pages. Publication keeps a backup and
restores it if promotion verification fails.

After interruption, rerun `scripts/start.ps1`; valid checkpoints persist.
Use `scripts/stop.ps1` to stop only PID-owned demo processes.

Use `scripts/reset-demo.ps1` only for a fully empty demo. It stops services,
verifies the exact runtime targets beneath `var`, removes `wiki`,
`staging-wiki`, and `builds`, then restarts.

## Verification

Run `scripts/verify-demo.ps1`. It checks credentials, SEC contact, runtimes,
dependencies, loopback ports 4310/4320/4321/8501, TypeScript, Python, and Ruff
without making SEC or OpenAI calls.

The live release test is manual: fetch, ingest, compile, inspect or repair,
quality, publish, browse both viewers, query, restart, and confirm persistence.

