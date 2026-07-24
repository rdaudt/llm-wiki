from __future__ import annotations

import os
import uuid

import httpx
import plotly.graph_objects as go
import streamlit as st

from app.viewmodel import (
    build_delta_view,
    sanitize_generated_markdown,
)

BASE_URL = os.getenv("ADAPTER_URL", "http://127.0.0.1:4310")


def get(path: str) -> dict:
    return httpx.get(f"{BASE_URL}{path}", timeout=5).raise_for_status().json()


def knowledge_graph(graph: dict) -> go.Figure:
    nodes = graph["nodes"]
    index = {node["id"]: position for position, node in enumerate(nodes)}
    x = [(position % 3) * 1.2 for position in range(len(nodes))]
    y = [-(position // 3) for position in range(len(nodes))]
    edge_x: list[float | None] = []
    edge_y: list[float | None] = []
    for edge in graph["edges"]:
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


st.set_page_config(page_title="AI Industry Intelligence Wiki", layout="wide")
st.title("AI Industry Intelligence Wiki")
st.caption("A five-minute leadership showcase using only public SEC filings")

try:
    state = get("/v1/demo/state")
    export = get("/v1/wiki/export")
except httpx.HTTPError:
    st.error("The loopback adapter is unavailable. Run scripts/start.ps1.")
    st.stop()

st.header("1. From documents to durable knowledge")
metrics = st.columns(4)
for column, label, value in zip(
    metrics,
    ["Sources", "Wiki pages", "Citations", "Relationships"],
    [state["sources"], state["pages"], state["citations"], state["relationships"]],
    strict=True,
):
    column.metric(label, value)
st.plotly_chart(knowledge_graph(state["graph"]), use_container_width=True)
st.info(
    "RAG answers a question from retrieved passages. This wiki compiles evidence into durable, "
    "linked pages that become context for later updates and questions."
)

st.header("2. What the wiki already understands")
st.caption("AI-generated synthesis — verify against the linked filings.")
st.markdown(sanitize_generated_markdown(export["synthesis"]["answer"]), unsafe_allow_html=False)
for citation in export["synthesis"]["citations"]:
    st.markdown(f"- [{citation['company']} — {citation['source']}]({citation['url']})")
with st.expander("Evidence and normalized source excerpts"):
    st.write(
        "The tracked source corpus contains filing identity, Business, Risk Factors, and MD&A."
    )
st.code("wiki/company-strategy-comparison.md", language=None)

st.header("3. New evidence changes understanding")
if st.button(
    "Add NVIDIA quarterly evidence",
    type="primary",
    disabled=state["stage"] == "post_delta",
):
    with st.spinner("Compiling the pinned NVIDIA filing (60-second deadline)…"):
        response = httpx.post(
            f"{BASE_URL}/v1/demo/delta",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            timeout=65,
        )
        response.raise_for_status()
        st.session_state["delta"] = response.json()
        st.rerun()
delta = st.session_state.get("delta")
if delta:
    view = build_delta_view(delta)
    st.warning(view.banner)
    counts = st.columns(3)
    counts[0].metric("Created", view.created)
    counts[1].metric("Updated", view.updated)
    counts[2].metric("Unchanged", view.unchanged)
    for number, highlight in enumerate(view.highlights, 1):
        st.subheader(f"Claim change {number}")
        left, right = st.columns(2)
        left.markdown(f"**Before**\n\n{sanitize_generated_markdown(highlight['before'])}")
        right.markdown(f"**After**\n\n{sanitize_generated_markdown(highlight['after'])}")
        st.caption(f"Evidence: {highlight['citation']}")

st.header("4. Trust and reuse")
quality = state["quality"]
trust = st.columns(4)
trust[0].metric("Health", f"{quality['healthScore']}/100")
trust[1].metric("Citation coverage", f"{quality['citationCoverage']}%")
trust[2].metric("Broken links", quality["brokenLinks"])
trust[3].metric("Orphans", quality["orphanedPages"])
st.write(
    f"Broken citations: {quality['brokenCitations']} · stale pages: {quality['stalePages']} · "
    f"errors: {quality['errors']} · warnings: {quality['warnings']}"
)
st.success("Saved synthesis is a wiki page, so it becomes retrieval context for future updates.")

st.divider()
st.header("Explore further")
questions = [
    "How do the companies differ in their exposure to AI datacenter growth?",
    "Which supply-chain and geopolitical risks appear across multiple companies?",
    "What changed in NVIDIA’s outlook or risk profile after the quarterly filing?",
]
selected = st.selectbox("Tested question", questions)
freeform = st.text_input("Optional free-form question")
live_enabled = bool(os.getenv("OPENAI_API_KEY"))
if st.button("Ask", disabled=not live_enabled):
    answer = (
        httpx.post(
            f"{BASE_URL}/v1/query",
            json={"question": freeform or selected, "save": False},
            timeout=65,
        )
        .raise_for_status()
        .json()
    )
    st.caption("AI-generated answer")
    st.markdown(sanitize_generated_markdown(answer["answer"]), unsafe_allow_html=False)
if not live_enabled:
    st.caption(
        "Live Q&A is disabled because OPENAI_API_KEY is absent; "
        "the guided replay remains available."
    )
