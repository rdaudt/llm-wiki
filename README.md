# AI Industry Intelligence Wiki

A local, offline-first leadership showcase of durable, interconnected knowledge compiled from public semiconductor-company SEC filings. The browser talks only to Streamlit; Streamlit calls an Express adapter bound to `127.0.0.1:4310`.

## Quick start

Requirements: Windows, Node 24.x, Python 3.12.x. Copy `.env.example` to `.env`; add credentials only to `.env` or the process environment.

```powershell
.\scripts\bootstrap.ps1
.\scripts\start.ps1
```

Without `OPENAI_API_KEY`, read-only pages and the checksum-oriented replay boundary remain available; live query and compilation are disabled.

## Five-minute runbook

- **0:00–0:45:** Introduce compiled knowledge, the three baseline filings, and baseline metrics.
- **0:45–1:45:** Trace the knowledge graph, comparison page, and company-level SEC citations.
- **1:45–3:15:** Select **Add NVIDIA quarterly evidence**. Call out the 60-second deadline and mode badge.
- **3:15–4:15:** Review created/updated/unchanged counts and both evidence-backed claim changes.
- **4:15–5:00:** Show quality gates and explain that saved synthesis becomes future retrieval context.

## Pre-demo checklist

- Confirm OpenAI balance and `OPENAI_API_KEY` only if using live mode.
- Confirm `SEC_USER_AGENT` contains an application name and monitored contact.
- Run `scripts/verify-demo.ps1`; confirm ports 4310 and 8501 are available.
- Run `scripts/reset-demo.ps1` after the services start.
- Exercise the replay once and confirm its timestamp and reason are visible.
- Set browser zoom and presentation resolution before the audience arrives.

## Recovery

If a provider call fails or crosses the 60-second deadline, the adapter returns the verified replay contract and labels the reason. Reset with `scripts/reset-demo.ps1`. Stop only POC-owned processes with `scripts/stop.ps1`; it uses recorded process IDs and does not kill unrelated Node or Python processes.

## Verification

```powershell
.\scripts\verify-demo.ps1
```

Offline CI runs TypeScript build/tests and Python tests/lint on Windows with Node 24 and Python 3.12. SEC-network and OpenAI runs are explicit manual release checks.

