from app.viewmodel import (
    build_delta_view,
    curated_questions,
    format_deadline,
    group_citations,
    phase_controls,
    sanitize_generated_markdown,
)


def test_sanitizes_generated_html_and_unsafe_links() -> None:
    value = sanitize_generated_markdown(
        "Answer <script>alert(1)</script> <img src=x> [bad](javascript:alert(1))"
    )
    assert "<script" not in value
    assert "<img" not in value
    assert "javascript:" not in value


def test_questions_are_unlocked_by_live_knowledge_stage() -> None:
    assert curated_questions("empty") == []
    assert len(curated_questions("baseline")) == 2
    assert len(curated_questions("post_delta")) == 3


def test_delta_view_only_keeps_changes_citing_the_quarter() -> None:
    view = build_delta_view(
        {
            "changes": {
                "created": [{"slug": "new"}],
                "updated": [{"slug": "changed"}],
                "unchanged": ["same"],
            },
            "highlights": [
                {
                    "before": "old",
                    "after": "new",
                    "citation": "nvidia-q1-fy2027-10q.md",
                },
                {"before": "x", "after": "y", "citation": "nvidia-2026-10k.md"},
                {
                    "before": "identical",
                    "after": "identical",
                    "citation": "nvidia-q1-fy2027-10q.md",
                },
            ],
        }
    )
    assert view.banner == "Live compiler run completed"
    assert view.updated == 1
    assert len(view.highlights) == 1
    assert view.highlights[0]["after"] == "new"


def test_deadline_is_shown_in_vancouver_time_with_time_remaining() -> None:
    label = format_deadline(
        "2026-07-24T08:29:44.691Z",
        now_iso="2026-07-24T08:00:00Z",
    )
    assert label == "Jul 24, 2026 1:29:44 AM PDT (29m 44s remaining)"


def test_phase_controls_follow_server_available_actions() -> None:
    controls = phase_controls(
        {
            "stage": "compiled",
            "qualityStatus": "failed",
            "availableActions": ["compile", "quality", "repair_citations"],
        }
    )
    assert [item.label for item in controls] == [
        "Fetch and normalize filings",
        "Ingest sources",
        "Compile wiki",
        "Run quality checks",
        "Repair quality issues",
        "Publish baseline wiki",
    ]
    assert {item.action for item in controls if item.enabled} == {
        "compile",
        "quality",
        "repair_citations",
    }


def test_citations_are_grouped_by_page_and_source_with_unique_ranges() -> None:
    groups = group_citations(
        [
            {
                "pageId": "concepts/client-computing",
                "pageTitle": "Client Computing Group",
                "file": "intel-2026-10k.md",
                "lines": {"start": 30, "end": 35},
            },
            {
                "pageId": "concepts/client-computing",
                "pageTitle": "Client Computing Group",
                "file": "intel-2026-10k.md",
                "lines": {"start": 30, "end": 35},
            },
            {
                "pageId": "concepts/client-computing",
                "pageTitle": "Client Computing Group",
                "source": "intel-2026-10k.md",
                "startLine": 72,
                "endLine": 75,
            },
        ]
    )
    assert len(groups) == 1
    assert groups[0].page_title == "Client Computing Group"
    assert groups[0].source == "intel-2026-10k.md"
    assert groups[0].ranges == ("30–35", "72–75")
