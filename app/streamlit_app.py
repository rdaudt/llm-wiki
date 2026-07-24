from __future__ import annotations

import sys
import time
import uuid
from pathlib import Path

import httpx
import plotly.graph_objects as go
import streamlit as st

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.viewmodel import (  # noqa: E402
    build_delta_view,
    curated_questions,
    format_deadline,
    group_citations,
    phase_controls,
    sanitize_generated_markdown,
)

BASE_URL = "http://127.0.0.1:4310"
VIEWER_URL = "http://127.0.0.1:4320"
STAGING_VIEWER_URL = "http://127.0.0.1:4321"


def get(path: str) -> dict:
    return httpx.get(f"{BASE_URL}{path}", timeout=10).raise_for_status().json()


def post(path: str) -> dict:
    return httpx.post(f"{BASE_URL}{path}", timeout=10).raise_for_status().json()


def knowledge_graph(graph: dict) -> go.Figure:
    nodes = graph.get("nodes", [])
    index = {node["id"]: position for position, node in enumerate(nodes)}
    x = [(position % 3) * 1.2 for position in range(len(nodes))]
    y = [-(position // 3) for position in range(len(nodes))]
    edge_x: list[float | None] = []
    edge_y: list[float | None] = []
    for edge in graph.get("edges", []):
        if edge["source"] not in index or edge["target"] not in index:
            continue
        source, target = index[edge["source"]], index[edge["target"]]
        edge_x.extend([x[source], x[target], None])
        edge_y.extend([y[source], y[target], None])
    figure = go.Figure()
    figure.add_trace(go.Scatter(x=edge_x, y=edge_y, mode="lines", hoverinfo="skip"))
    figure.add_trace(
        go.Scatter(
            x=x,
            y=y,
            mode="markers+text",
            text=[node["label"] for node in nodes],
            textposition="bottom center",
            marker={"size": 20, "color": "#76b900"},
            customdata=[node["kind"] for node in nodes],
            hovertemplate="%{text}<br>%{customdata}<extra></extra>",
        )
    )
    figure.update_layout(
        height=390,
        margin={"l": 10, "r": 10, "t": 10, "b": 10},
        showlegend=False,
        xaxis={"visible": False},
        yaxis={"visible": False},
    )
    return figure


def run_operation(path: str, timeout_seconds: int) -> dict | None:
    try:
        response = httpx.post(
            f"{BASE_URL}{path}",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            timeout=10,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        st.error(f"Could not start live operation: {error}")
        return None
    operation_id = response.json()["operationId"]
    panel = st.status("Live operation queued", expanded=True)
    progress_line = panel.empty()
    deadline = time.monotonic() + timeout_seconds + 10
    while time.monotonic() < deadline:
        try:
            operation = get(f"/v1/operations/{operation_id}")
        except httpx.HTTPError as error:
            panel.update(label=f"Operation status unavailable: {error}", state="error")
            return None
        detail = operation.get("progress") or {}
        filing = detail.get("filing", "preparing corpus")
        progress_line.write(
            f"{operation['phase']} · {filing} · deadline "
            f"{format_deadline(operation['deadline'])}"
        )
        if operation["status"] == "completed":
            panel.update(label="Live operation completed", state="complete")
            return operation.get("result") or {}
        if operation["status"] in {"failed", "timed_out"}:
            message = (operation.get("error") or {}).get("message", "Operation failed")
            panel.update(label=message, state="error")
            return None
        time.sleep(0.5)
    panel.update(label="Operation polling deadline exceeded", state="error")
    return None


st.set_page_config(page_title="AI Industry Intelligence Wiki", layout="wide")
st.title("AI Industry Intelligence Wiki")
st.caption("Live compilation from pinned public SEC filings")
st.markdown(f"[Open browsable wiki]({VIEWER_URL})")

try:
    health = get("/health")
    state = get("/v1/demo/state")
    exported = get("/v1/wiki/export")
    build = post("/v1/builds/baseline")
    build = get(f"/v1/builds/{build['buildId']}")
except httpx.HTTPError:
    st.error("The loopback adapter is unavailable. Run scripts/start.ps1.")
    st.stop()

stage = "baseline" if build["stage"] == "published" else state["knowledgeStage"]
live_enabled = bool(health["liveEnabled"])

st.header("1. Build durable knowledge")
st.caption(
    f"Build {build['buildId']} · stage {build['stage']} · "
    f"quality {build['qualityStatus']} · checkpoint "
    f"{build.get('checkpointId', 'none')}"
)
if build["stage"] in {"compiled", "published"}:
    st.markdown(
        f"[Open staging wiki — unvalidated until quality passes]({STAGING_VIEWER_URL})"
    )

timeouts = {
    "fetch": 300,
    "ingest": 300,
    "compile": 1800,
    "quality": 300,
    "repair_citations": 300,
    "publish": 120,
}
network_actions = {"fetch", "ingest", "compile"}
for control in phase_controls(build):
    disabled = not control.enabled or (
        control.action in network_actions and not live_enabled
    )
    if st.button(
        control.label,
        key=f"build-{control.action}",
        type="primary" if control.action == "publish" else "secondary",
        disabled=disabled,
    ):
        if (
            run_operation(
                f"/v1/builds/{build['buildId']}/{control.action}",
                timeouts[control.action],
            )
            is not None
        ):
            st.rerun()

if build.get("sourceFiles"):
    st.subheader("Ingested compiler sources")
    st.dataframe(build["sourceFiles"], use_container_width=True, hide_index=True)

if build["qualityStatus"] != "not_run":
    try:
        build_quality = get(f"/v1/builds/{build['buildId']}/quality")
        if build_quality.get("findings"):
            st.subheader("Exact quality findings")
            st.dataframe(
                build_quality["findings"],
                use_container_width=True,
                hide_index=True,
            )
        if build_quality.get("truncated"):
            st.warning("The quality artifact was bounded; additional findings were truncated.")
    except httpx.HTTPError as error:
        st.error(f"Could not load the retained quality artifact: {error}")

if stage == "empty":
    st.info("Complete the phases above to publish the baseline wiki.")
else:
    metrics = st.columns(4)
    for column, label, value in zip(
        metrics,
        ["Sources", "Wiki pages", "Citations", "Relationships"],
        [state["sources"], state["pages"], state["citations"], state["relationships"]],
        strict=True,
    ):
        column.metric(label, value)
    st.plotly_chart(knowledge_graph(state["graph"]), use_container_width=True)
if not live_enabled:
    st.caption(
        "Network/model phases require OPENAI_API_KEY and SEC_USER_AGENT; "
        "no fixture or replay is substituted."
    )

st.header("2. Browse compiled pages")
pages = exported.get("pages", [])
if not pages:
    st.caption("No compiled pages yet.")
for page in pages:
    with st.expander(f"{page['title']} · {page.get('kind', 'concept')}"):
        st.markdown(sanitize_generated_markdown(page.get("body", "")))
        for source in page.get("sources", []):
            st.caption(f"Source: {source}")

st.header("3. Add quarterly evidence")
delta_disabled = stage != "baseline" or not live_enabled
if st.button("Compile NVIDIA quarterly delta", disabled=delta_disabled):
    result = run_operation("/v1/demo/delta", 600)
    if result is not None:
        st.session_state["delta_result"] = result
        st.rerun()
delta = st.session_state.get("delta_result")
if delta:
    view = build_delta_view(delta)
    st.success(view.banner)
    counts = st.columns(3)
    counts[0].metric("Created", view.created)
    counts[1].metric("Updated", view.updated)
    counts[2].metric("Unchanged", view.unchanged)
    for number, highlight in enumerate(view.highlights, 1):
        st.subheader(f"Evidence-backed change {number}")
        left, right = st.columns(2)
        left.markdown(f"**Before**\n\n{sanitize_generated_markdown(highlight['before'])}")
        right.markdown(f"**After**\n\n{sanitize_generated_markdown(highlight['after'])}")
        st.caption(f"Quarterly evidence: {highlight['citation']}")

st.header("4. Trust and reuse")
quality = state["quality"]
trust = st.columns(4)
trust[0].metric("Health", quality["healthScore"] if quality["healthScore"] is not None else "—")
trust[1].metric(
    "Citation coverage",
    f"{quality['citationCoverage']}%" if quality["citationCoverage"] is not None else "—",
)
trust[2].metric("Broken links", quality["brokenLinks"])
trust[3].metric("Orphans", quality["orphanedPages"])
st.write(
    f"Broken citations: {quality['brokenCitations']} · stale pages: {quality['stalePages']} · "
    f"contradictions: {quality['contradictions']} · errors: {quality['errors']} · "
    f"warnings: {quality['warnings']}"
)

st.divider()
st.header("Ask the live wiki")
questions = curated_questions(stage)
selected = st.selectbox("Curated question", questions) if questions else ""
freeform = st.text_input("Optional free-form question")
question = freeform.strip() or selected
if st.button("Ask", disabled=not live_enabled or not question or stage == "empty"):
    try:
        answer = httpx.post(
            f"{BASE_URL}/v1/query",
            json={"question": question, "save": not bool(freeform.strip())},
            timeout=65,
        ).raise_for_status().json()
        st.caption("AI-generated answer — verify against citations")
        st.markdown(sanitize_generated_markdown(answer["answer"]))
        citation_groups = group_citations(answer.get("citations", []))
        if citation_groups:
            st.markdown("**Sources**")
        for citation in citation_groups:
            ranges = (
                f" · lines {', '.join(citation.ranges)}"
                if citation.ranges
                else ""
            )
            st.caption(f"{citation.page_title} · {citation.source}{ranges}")
    except httpx.HTTPError as error:
        st.error(str(error))
