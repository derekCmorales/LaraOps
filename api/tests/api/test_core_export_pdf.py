from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[3]
EXAMPLES = ROOT / "examples"


def _pdf_text(client, path: str, payload: dict) -> str:
    response = client.post(path, json=payload)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/pdf")
    reader = PdfReader(BytesIO(response.content))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def test_lp_export_pdf(client):
    payload = json.loads((EXAMPLES / "lp_01.json").read_text(encoding="utf-8"))
    text = _pdf_text(client, "/api/v1/modules/lp/export.pdf", payload)
    assert "LaraOps" in text
    assert "180" in text


def test_transport_export_pdf(client):
    payload = json.loads((EXAMPLES / "transport_01.json").read_text(encoding="utf-8"))
    text = _pdf_text(client, "/api/v1/modules/transport/export.pdf", payload)
    assert "LaraOps" in text
    assert "transport" in text.lower()


def test_assignment_export_pdf(client):
    payload = json.loads((EXAMPLES / "assignment_01.json").read_text(encoding="utf-8"))
    text = _pdf_text(client, "/api/v1/modules/assignment/export.pdf", payload)
    assert "LaraOps" in text


def test_pert_export_pdf(client):
    payload = json.loads((EXAMPLES / "pert_01.json").read_text(encoding="utf-8"))
    text = _pdf_text(client, "/api/v1/modules/pert_cpm/export.pdf", payload)
    assert "LaraOps" in text
    assert "12" in text
