import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SECRET = "sk-test-SECRET-0123456789"
PARTICIPANTS = ["Priya Nair", "Marcus Lee", "Elena Rossi", "Sam Okafor", "Jordan Blake"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for var in ("AI_PROVIDER", "AI_MODEL", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY",
                "OPENAI_BASE_URL", "FORCE_DEMO_MODE", "MAX_TRANSCRIPT_CHARS"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("AI_RETRY_BACKOFF", "0")


@pytest.fixture
def transcript():
    return (ROOT / "tests" / "fixtures" / "sample_transcript.txt").read_text(encoding="utf-8")


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from backend.main import app
    return TestClient(app)
