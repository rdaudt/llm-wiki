from pathlib import Path

import pytest

from tools.corpus import CorpusError, load_manifest, normalize_filing

FIXTURES = Path(__file__).parent / "fixtures"


def test_manifest_contains_three_baselines_and_pinned_delta() -> None:
    entries = load_manifest(Path("corpus/manifest.json"))
    assert len(entries) == 4
    assert sum(entry.role == "baseline" for entry in entries) == 3
    assert next(entry for entry in entries if entry.role == "delta").accession == (
        "0001045810-26-000052"
    )


def test_normalization_is_deterministic_and_preserves_table() -> None:
    html = (FIXTURES / "nvidia-10k.html").read_text(encoding="utf-8")
    first = normalize_filing(html, expected_form="10-K", sections=["Item 1", "Item 1A", "Item 7"])
    second = normalize_filing(html, expected_form="10-K", sections=["Item 1", "Item 1A", "Item 7"])
    assert first == second
    assert "| Product | Revenue |" in first
    assert "\r" not in first


def test_normalization_rejects_missing_sections() -> None:
    html = (FIXTURES / "nvidia-10k.html").read_text(encoding="utf-8")
    with pytest.raises(CorpusError, match="missing required section"):
        normalize_filing(html, expected_form="10-K", sections=["Item 1", "Item 99"])


def test_normalization_rejects_altered_form() -> None:
    html = (FIXTURES / "nvidia-10k.html").read_text(encoding="utf-8")
    with pytest.raises(CorpusError, match="form mismatch"):
        normalize_filing(html, expected_form="10-Q", sections=["Item 1"])
