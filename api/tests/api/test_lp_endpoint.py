from __future__ import annotations

from tests.conftest import assert_allclose

LP_ATOL = 1e-4


def test_lp_solve_endpoint(client):
    payload = {
        "sense": "max",
        "objective": {"x1": 3, "x2": 2},
        "constraints": [
            {"id": "c1", "coeffs": {"x1": 2, "x2": 1}, "sense": "<=", "rhs": 100},
            {"id": "c2", "coeffs": {"x1": 1, "x2": 1}, "sense": "<=", "rhs": 80},
            {"id": "c3", "coeffs": {"x1": 1, "x2": 0}, "sense": "<=", "rhs": 40},
        ],
    }
    response = client.post("/api/v1/modules/lp/solve", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "optimal"
    assert_allclose(body["solution"]["objective_value"], 180.0, atol=LP_ATOL)
    assert_allclose(body["solution"]["variables"]["x1"], 20.0, atol=LP_ATOL)
    assert_allclose(body["solution"]["variables"]["x2"], 60.0, atol=LP_ATOL)
    assert body["iterations"]
    assert len(body["sensitivity"]["shadow_prices"]) == 3
    assert len(body["sensitivity"]["constraint_analysis"]) == 3
    ca = body["sensitivity"]["constraint_analysis"]
    assert "lhs" in ca[0] and "slack_or_surplus" in ca[0]
    assert "allowable_min_rhs" in ca[0] and "allowable_max_rhs" in ca[0]


def test_lp_export_pdf_contains_sensitivity_table(client):
    payload = {
        "sense": "max",
        "objective": {"x1": 3, "x2": 2},
        "constraints": [
            {"id": "c1", "coeffs": {"x1": 2, "x2": 1}, "sense": "<=", "rhs": 100},
            {"id": "c2", "coeffs": {"x1": 1, "x2": 1}, "sense": "<=", "rhs": 80},
            {"id": "c3", "coeffs": {"x1": 1, "x2": 0}, "sense": "<=", "rhs": 40},
        ],
    }
    response = client.post("/api/v1/modules/lp/export.pdf", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert len(response.content) > 500


def test_lp_export_xlsx_contains_sensitivity_sheet(client):
    payload = {
        "sense": "max",
        "objective": {"x1": 3, "x2": 2},
        "constraints": [
            {"id": "c1", "coeffs": {"x1": 2, "x2": 1}, "sense": "<=", "rhs": 100},
            {"id": "c2", "coeffs": {"x1": 1, "x2": 1}, "sense": "<=", "rhs": 80},
            {"id": "c3", "coeffs": {"x1": 1, "x2": 0}, "sense": "<=", "rhs": 40},
        ],
    }
    response = client.post("/api/v1/modules/lp/export.xlsx", json=payload)
    assert response.status_code == 200
    assert "spreadsheet" in response.headers["content-type"]
    assert len(response.content) > 500
