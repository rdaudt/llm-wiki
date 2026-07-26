from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

QUESTIONS = [
    "How do the companies differ in their exposure to AI datacenter growth?",
    "Which supply-chain and geopolitical risks appear across multiple companies?",
    "What changed in NVIDIA’s outlook or risk profile after the quarterly filing?",
]


@dataclass(frozen=True)
class DeltaView:
    banner: str
    created: int
    updated: int
    unchanged: int
    highlights: list[dict[str, Any]]


@dataclass(frozen=True)
class PhaseControl:
    action: str
    label: str
    enabled: bool


@dataclass(frozen=True)
class CitationGroup:
    page_id: str
    page_title: str
    source: str
    ranges: tuple[str, ...]


def _citation_source(citation: dict[str, Any]) -> str:
    for field in ("source", "file", "filename"):
        value = citation.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raw = citation.get("raw")
    if isinstance(raw, str):
        match = re.match(r"\s*([^:#,\]]+\.md)", raw)
        if match:
            return match.group(1)
    return "Unknown source"


def _citation_range(citation: dict[str, Any]) -> str | None:
    lines = citation.get("lines")
    start = citation.get("startLine")
    end = citation.get("endLine")
    if isinstance(lines, dict):
        start = lines.get("start", start)
        end = lines.get("end", end)
    start = citation.get("start", start)
    end = citation.get("end", end)
    if not isinstance(start, int):
        return None
    if not isinstance(end, int):
        end = start
    return str(start) if start == end else f"{start}–{end}"


def group_citations(citations: list[dict[str, Any]]) -> list[CitationGroup]:
    grouped: dict[tuple[str, str, str], list[str]] = {}
    for citation in citations:
        page_id = str(citation.get("pageId", ""))
        page_title = str(citation.get("pageTitle") or page_id or "Wiki page")
        source = _citation_source(citation)
        key = (page_id, page_title, source)
        ranges = grouped.setdefault(key, [])
        line_range = _citation_range(citation)
        if line_range and line_range not in ranges:
            ranges.append(line_range)
    return [
        CitationGroup(
            page_id=page_id,
            page_title=page_title,
            source=source,
            ranges=tuple(ranges),
        )
        for (page_id, page_title, source), ranges in grouped.items()
    ]


def phase_controls(build: dict[str, Any]) -> list[PhaseControl]:
    available = set(build.get("availableActions", []))
    actions = [
        ("fetch", "Fetch and normalize filings"),
        ("ingest", "Ingest sources"),
        ("compile", "Compile wiki"),
        ("quality", "Run quality checks"),
        ("repair_citations", "Repair quality issues"),
        ("publish", "Publish baseline wiki"),
    ]
    return [
        PhaseControl(action=action, label=label, enabled=action in available)
        for action, label in actions
    ]


def sanitize_generated_markdown(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"(?i)javascript\s*:", "", value)
    return html.unescape(value)


def curated_questions(stage: str) -> list[str]:
    if stage == "post_delta":
        return QUESTIONS.copy()
    if stage == "baseline":
        return QUESTIONS[:2]
    return []


def resolve_knowledge_stage(
    build: dict[str, Any],
    state: dict[str, Any],
) -> str:
    stage = str(state.get("knowledgeStage", "empty"))
    if stage in {"empty", "baseline", "post_delta"}:
        return stage
    return "baseline" if build.get("stage") == "published" else "empty"


def format_deadline(value: str, *, now_iso: str | None = None) -> str:
    deadline = datetime.fromisoformat(value.replace("Z", "+00:00"))
    now = (
        datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
        if now_iso
        else datetime.now(tz=ZoneInfo("UTC"))
    )
    remaining = max(0, int((deadline - now).total_seconds()))
    minutes, seconds = divmod(remaining, 60)
    local = deadline.astimezone(ZoneInfo("America/Vancouver"))
    hour = (local.hour - 1) % 12 + 1
    local_label = (
        f"{local.strftime('%b %d, %Y')} {hour}:{local.strftime('%M:%S %p %Z')}"
    )
    return f"{local_label} ({minutes}m {seconds:02d}s remaining)"


def build_delta_view(result: dict[str, Any]) -> DeltaView:
    changes = result.get("changes", {})
    highlights = [
        item
        for item in result.get("highlights", [])
        if "nvidia-q1-fy2027-10q" in str(item.get("citation", "")).lower()
        and item.get("before") != item.get("after")
    ]
    return DeltaView(
        banner="Live compiler run completed",
        created=len(changes.get("created", [])),
        updated=len(changes.get("updated", [])),
        unchanged=len(changes.get("unchanged", [])),
        highlights=highlights,
    )
