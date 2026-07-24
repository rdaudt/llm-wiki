import os
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest


@pytest.fixture(scope="module")
def adapter() -> None:
    environment = os.environ.copy()
    environment.pop("OPENAI_API_KEY", None)
    process = subprocess.Popen(  # noqa: S603
        ["node", "--import", "tsx", "src/server.ts"],  # noqa: S607
        cwd=Path(__file__).parents[1],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
        env=environment,
    )
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:4310/health", timeout=1):  # noqa: S310
                break
        except OSError:
            time.sleep(0.2)
    else:
        process.terminate()
        pytest.fail("adapter did not become healthy")
    yield
    process.terminate()
    process.wait(timeout=10)


def test_empty_state_offers_staged_controls_and_native_viewer(adapter: None) -> None:
    app = AppTest.from_file("app/streamlit_app.py", default_timeout=10).run()
    assert not app.exception
    assert [button.label for button in app.button[:6]] == [
        "Fetch and normalize filings",
        "Ingest sources",
        "Compile wiki",
        "Run quality checks",
        "Repair citations",
        "Publish baseline wiki",
    ]
    assert app.button[0].disabled
    links = [link.body for link in app.markdown]
    assert any("Open browsable wiki" in body for body in links)
    assert any("OPENAI_API_KEY" in caption.value for caption in app.caption)
