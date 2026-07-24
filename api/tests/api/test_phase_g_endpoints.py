def test_phase_g_endpoints(client):
    cases = [
        (
            "/api/v1/modules/networks/solve",
            {
                "problem": "shortest_path",
                "nodes": ["A", "B"],
                "edges": [{"source": "A", "target": "B", "weight": 3}],
                "source": "A",
                "sink": "B",
            },
            "networks",
        ),
        (
            "/api/v1/modules/markov/solve",
            {"states": ["A", "B"], "transition": [[0.5, 0.5], [0.5, 0.5]], "steps": 2},
            "markov",
        ),
        (
            "/api/v1/modules/quality_control/solve",
            {"chart": "c", "counts": [1, 2, 3]},
            "quality_control",
        ),
        (
            "/api/v1/modules/goal_programming/solve",
            {
                "goals": [
                    {
                        "id": "g1",
                        "coeffs": {"x": 1},
                        "sense": "=",
                        "target": 5,
                        "weight_pos": 1,
                        "weight_neg": 1,
                    }
                ]
            },
            "goal_programming",
        ),
        (
            "/api/v1/modules/dynamic_programming/solve",
            {
                "problem": "knapsack",
                "capacity": 5,
                "items": [
                    {"id": "a", "weight": 2, "value": 3},
                    {"id": "b", "weight": 3, "value": 4},
                ],
            },
            "dynamic_programming",
        ),
        (
            "/api/v1/modules/mrp/solve",
            {
                "items": ["A"],
                "gross_requirements": {"A": [10, 0]},
                "on_hand": {"A": 0},
                "lead_times": {"A": 0},
            },
            "mrp",
        ),
    ]
    for path, body, module in cases:
        res = client.post(path, json=body)
        assert res.status_code == 200, (module, res.text)
        assert res.json()["module"] == module
