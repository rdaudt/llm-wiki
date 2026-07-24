# Live LLM-Wiki SEC demo

This loopback-only demo builds an LLM-Wiki from pinned public SEC filings. It
contains no packaged wiki pages, prepared answers, replay snapshots, or
synthetic success metrics. All knowledge comes from live SEC and OpenAI work.

## Requirements

- Windows with Node 24.x and Python 3.12.x
- `OPENAI_API_KEY`
- `SEC_USER_AGENT` containing an application name and monitored contact address
- Access to the filing URLs pinned in `corpus/manifest.json`

Compilation, embeddings, and Q&A consume paid OpenAI capacity. SEC requests
must comply with SEC access policies.

## Setup and start

```powershell
Copy-Item .env.example .env
# Edit .env and provide OPENAI_API_KEY and SEC_USER_AGENT.
.\scripts\bootstrap.ps1
.\scripts\verify-demo.ps1
.\scripts\start.ps1
```

Normal startup preserves successful checkpoints and published knowledge:

- adapter: <http://127.0.0.1:4310>
- published LLM-Wiki viewer: <http://127.0.0.1:4320>
- staging LLM-Wiki viewer: <http://127.0.0.1:4321>
- Streamlit: <http://127.0.0.1:8501>

Only Streamlit opens automatically.

## Stabilization workflow

1. **Fetch and normalize filings** checkpoints normalized SEC Markdown and receipts.
2. **Ingest sources** records the exact filenames returned by LLM-Wiki.
3. **Compile wiki** checkpoints generated pages without running citation lint.
4. **Run quality checks** retains exact page, line, marker, rule, and message data.
5. Use **Repair citations** for conservative deterministic fixes, or recompile.
6. Run quality again, then **Publish baseline wiki** when it passes.
7. Browse published pages and ask the two baseline questions.
8. Compile the NVIDIA quarterly delta and ask the third question.

Each successful phase is restart-safe. A failed phase restores only its
starting checkpoint and retains bounded, secret-redacted diagnostics. Quality
is read-only and never deletes generated pages. There is no fixture fallback.

See [the operator runbook](docs/runbook.md) for recovery and artifact details.

## Reset and stop

```powershell
.\scripts\stop.ps1
.\scripts\start.ps1       # preserves checkpoints and published knowledge
.\scripts\reset-demo.ps1  # explicitly clears builds and both workspaces
```

## Verification

```powershell
.\scripts\verify-demo.ps1
```

Verification checks credentials, SEC contact, runtime versions, dependencies,
loopback ports, TypeScript build/tests, and Python tests/lint. It performs no
SEC request and no paid model call. The full live workflow remains a manual,
networked, cost-bearing release test.

