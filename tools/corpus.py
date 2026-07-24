from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


class CorpusError(ValueError):
    pass


@dataclass(frozen=True)
class CorpusEntry:
    id: str
    company: str
    cik: str
    accession: str
    form: str
    filedOn: str
    periodEnd: str
    role: str
    secIndexUrl: str
    primaryDocumentUrl: str
    includedSections: list[str]
    outputFile: str
    normalizedChars: int
    sha256: str


def load_manifest(path: Path) -> list[CorpusEntry]:
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = [CorpusEntry(**item) for item in data]
    if {entry.company for entry in entries if entry.role == "baseline"} != {
        "NVIDIA",
        "AMD",
        "Intel",
    }:
        raise CorpusError("manifest must contain all three baseline companies")
    if sum(entry.role == "delta" for entry in entries) != 1:
        raise CorpusError("manifest must contain exactly one delta")
    for entry in entries:
        if urlparse(entry.primaryDocumentUrl).hostname not in {"sec.gov", "www.sec.gov"}:
            raise CorpusError("all sources must be hosted by sec.gov")
    return entries


class _MarkdownParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []
        self.hidden = 0
        self.in_cell = False
        self.cell = ""
        self.row: list[str] = []
        self.table_rows: list[list[str]] = []
        self.form = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = dict(attrs)
        if tag in {"nav", "script", "style"}:
            self.hidden += 1
        if attrs_map.get("data-form"):
            self.form = attrs_map["data-form"] or ""
        if tag in {"h1", "h2", "h3"}:
            self.lines.append("## ")
        if tag in {"p", "div"}:
            self.lines.append("")
        if tag == "table":
            self.table_rows = []
        if tag == "tr":
            self.row = []
        if tag in {"td", "th"}:
            self.in_cell = True
            self.cell = ""

    def handle_endtag(self, tag: str) -> None:
        if tag in {"nav", "script", "style"} and self.hidden:
            self.hidden -= 1
        if tag in {"td", "th"}:
            self.in_cell = False
            self.row.append(_space(self.cell))
        if tag == "tr" and self.row:
            self.table_rows.append(self.row)
        if tag == "table" and self.table_rows:
            width = len(self.table_rows[0])
            self.lines.append("| " + " | ".join(self.table_rows[0]) + " |")
            self.lines.append("| " + " | ".join(["---"] * width) + " |")
            self.lines.extend("| " + " | ".join(row) + " |" for row in self.table_rows[1:])

    def handle_data(self, data: str) -> None:
        if self.hidden:
            return
        if self.in_cell:
            self.cell += data
        else:
            self.lines.append(data)


def _space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_filing(html: str, *, expected_form: str, sections: list[str]) -> str:
    parser = _MarkdownParser()
    parser.feed(html)
    if parser.form and parser.form != expected_form:
        raise CorpusError(f"form mismatch: expected {expected_form}, found {parser.form}")
    text = "\n".join(_space(line) for line in parser.lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    starts: list[tuple[int, str]] = []
    for section in sections:
        pattern = re.compile(rf"(?im)^##\s+{re.escape(section)}(?:[.\s:]|$)")
        match = pattern.search(text)
        if not match:
            raise CorpusError(f"missing required section: {section}")
        starts.append((match.start(), section))
    headings = list(re.finditer(r"(?im)^##\s+(?:Part\s+[IVX]+\s+)?Item\s+\w+", text))
    chunks: list[str] = []
    for start, _ in sorted(starts):
        end = min(
            (heading.start() for heading in headings if heading.start() > start),
            default=len(text),
        )
        chunks.append(text[start:end].strip())
    return "\n\n".join(chunks).strip() + "\n"


def fetch_sec(entry: CorpusEntry, user_agent: str, max_bytes: int = 25_000_000) -> str:
    if not user_agent or "@" not in user_agent:
        raise CorpusError("SEC_USER_AGENT must identify an application and contact")
    request = urllib.request.Request(  # noqa: S310
        entry.primaryDocumentUrl,
        headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        final = urlparse(response.geturl())
        if final.hostname not in {"sec.gov", "www.sec.gov"}:
            raise CorpusError("SEC redirect left sec.gov")
        content_type = response.headers.get_content_type()
        if content_type not in {"text/html", "application/xhtml+xml"}:
            raise CorpusError(f"unexpected content type: {content_type}")
        payload = response.read(max_bytes + 1)
        if len(payload) > max_bytes:
            raise CorpusError("SEC response exceeds size limit")
        return payload.decode("utf-8", errors="replace")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def verify_sources(entries: list[CorpusEntry], source_dir: Path) -> None:
    total = 0
    for entry in entries:
        path = source_dir / entry.outputFile
        if not path.is_file():
            raise CorpusError(f"missing normalized source: {entry.outputFile}")
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        if b"\r" in raw:
            raise CorpusError(f"source is not LF-normalized: {entry.outputFile}")
        if len(text) != entry.normalizedChars:
            raise CorpusError(f"character count mismatch: {entry.outputFile}")
        if hashlib.sha256(raw).hexdigest() != entry.sha256:
            raise CorpusError(f"checksum mismatch: {entry.outputFile}")
        total += len(text)
    if total > 500_000:
        raise CorpusError("normalized corpus exceeds 500,000 characters")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("corpus/manifest.json"))
    args = parser.parse_args()
    entries = load_manifest(args.manifest)
    verify_sources(entries, args.manifest.parent / "sources")
    print(f"verified {len(entries)} pinned SEC sources and checksums")


if __name__ == "__main__":
    main()
