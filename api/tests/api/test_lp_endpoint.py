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
