from pathlib import Path


def test_process_scripts_own_all_four_demo_ports_and_viewer_pids() -> None:
    start = Path("scripts/start.ps1").read_text(encoding="utf-8")
    stop = Path("scripts/stop.ps1").read_text(encoding="utf-8")
    for port in ("4310", "4320", "4321", "8501"):
        assert port in start
    assert "viewer.pid" in start
    assert "viewer.pid" in stop
    assert "staging-viewer.pid" in start
    assert "staging-viewer.pid" in stop
    assert 'Start-Process "http://127.0.0.1:8501"' in start
    assert 'Start-Process "http://127.0.0.1:4320"' not in start
