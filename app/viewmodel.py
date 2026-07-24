from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DeltaView:
    banner: str
    created: int
    updated: int
    unchanged: int
    highlights: list[dict[str, Any]]


def sanitize_generated_markdown(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"(?i)javascript\s*:", "", value)
    return html.unescape(value)


def build_delta_view(result: dict[str, Any]) -> DeltaView:
    reason = result.get("replayReason", "forced")
    mode = result.get("mode")
    banner = f"Replay of verified run — {reason}" if mode == "replay" else "Live compiler run"
    changes = result["changes"]
    return DeltaView(
        banner=banner,
        created=len(changes["created"]),
        updated=len(changes["updated"]),
        unchanged=len(changes["unchanged"]),
        highlights=result["highlights"],
    )
