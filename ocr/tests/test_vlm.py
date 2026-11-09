"""The vision OCR engines' requests to LM Studio, without a server."""

from __future__ import annotations

from intake_ocr.engines.vlm import server_headers


def test_no_token_is_sent_when_none_is_set(monkeypatch):
    monkeypatch.delenv("LOCAL_LLM_TOKEN", raising=False)
    assert server_headers() == {"Content-Type": "application/json"}


def test_the_token_is_sent_as_a_bearer_token(monkeypatch):
    monkeypatch.setenv("LOCAL_LLM_TOKEN", " sk-lm-test:secret ")
    assert server_headers()["Authorization"] == "Bearer sk-lm-test:secret"
