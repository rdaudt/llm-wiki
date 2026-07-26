from pathlib import Path


def test_process_scripts_own_all_four_demo_ports_and_viewer_pids() -> None:
    start = Path("scripts/start.ps1").read_text(encoding="utf-8")
    stop = Path("scripts/stop.ps1").read_text(encoding="utf-8")
    viewer = Path("scripts/viewer.ps1").read_text(encoding="utf-8")
    for port in ("4310", "4320", "4321", "8501"):
        assert port in start
    assert "viewer.pid" in viewer
    assert "staging-viewer.pid" in viewer
    assert '"viewer.ps1") -Action Start -Target Published' in start
    assert '"viewer.ps1") -Action Start -Target Staging' in start
    assert '"viewer.ps1") -Action Stop -Target Published' in stop
    assert '"viewer.ps1") -Action Stop -Target Staging' in stop
    assert "Invoke-WebRequest" in viewer
    assert "Get-NetTCPConnection" in viewer
    assert 'Start-Process "http://127.0.0.1:8501"' in start
    assert 'Start-Process "http://127.0.0.1:4320"' not in start


def test_verification_uses_the_pinned_virtual_environment() -> None:
    verify = Path("scripts/verify-demo.ps1").read_text(encoding="utf-8")
    assert '.venv\\Scripts\\python.exe' in verify
