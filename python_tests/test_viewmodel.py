from app.viewmodel import build_delta_view, sanitize_generated_markdown


def test_sanitizes_generated_html_and_unsafe_links() -> None:
    value = sanitize_generated_markdown(
        "Answer <script>alert(1)</script> <img src=x> [bad](javascript:alert(1))"
    )
    assert "<script" not in value
    assert "<img" not in value
    assert "javascript:" not in value


def test_delta_view_exposes_replay_reason_and_evidence() -> None:
    view = build_delta_view(
        {
            "mode": "replay",
            "replayReason": "timeout",
            "changes": {"created": [{}], "updated": [{}, {}], "unchanged": ["a"]},
            "highlights": [{"before": "old", "after": "new", "citation": "nvidia-q1-fy2027-10q"}],
        }
    )
    assert view.banner == "Replay of verified run — timeout"
    assert view.updated == 2
    assert view.highlights[0]["citation"] == "nvidia-q1-fy2027-10q"
