import subprocess
import time
import urllib.request
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest


@pytest.fixture(scope="module")
def adapter() -> None:
    process = subprocess.Popen(  # noqa: S603
        ["node", "--import", "tsx", "src/server.ts"],  # noqa: S607
        cwd=Path(__file__).parents[1],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
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


def test_guided_page_renders_four_sections(adapter: None) -> None:
    app = AppTest.from_file("app/streamlit_app.py", default_timeout=10).run()
    assert not app.exception
    headings = [heading.value for heading in app.header]
    assert headings[:4] == [
        "1. From documents to durable knowledge",
        "2. What the wiki already understands",
        "3. New evidence changes understanding",
        "4. Trust and reuse",
    ]
    assert app.button[0].label == "Add NVIDIA quarterly evidence"
    app.button[0].click().run()
    assert any("Replay of verified run" in warning.value for warning in app.warning)
    assert any(subheader.value == "Claim change 1" for subheader in app.subheader)
