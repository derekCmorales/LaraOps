def test_queues_endpoint(client):
    response = client.post(
        "/api/v1/modules/queues/solve",
        json={"model": "M/M/1", "lambda": 10, "mu": 15},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["module"] == "queues"
    assert abs(body["solution"]["metrics"]["L"] - 2.0) < 1e-6


def test_inventory_endpoint(client):
    response = client.post(
        "/api/v1/modules/inventory/solve",
        json={"D": 1000, "S": 10, "H": 0.5},
    )
    assert response.status_code == 200
    assert response.json()["module"] == "inventory"


def test_forecasting_endpoint(client):
    response = client.post(
        "/api/v1/modules/forecasting/solve",
        json={"series": [1, 2, 3, 4, 5], "methods": ["naive"]},
    )
    assert response.status_code == 200
    assert response.json()["module"] == "forecasting"


def test_decision_endpoint(client):
    response = client.post(
        "/api/v1/modules/decision_analysis/solve",
        json={
            "alternatives": ["A", "B"],
            "states": ["s1", "s2"],
            "payoff": [[1, 2], [3, 0]],
            "probabilities": [0.5, 0.5],
        },
    )
    assert response.status_code == 200
    assert response.json()["module"] == "decision_analysis"


def test_game_endpoint(client):
    response = client.post(
        "/api/v1/modules/game_theory/solve",
        json={
            "row_strategies": ["R1", "R2"],
            "col_strategies": ["C1", "C2"],
            "payoff": [[1, -1], [-1, 1]],
        },
    )
    assert response.status_code == 200
    assert response.json()["module"] == "game_theory"
