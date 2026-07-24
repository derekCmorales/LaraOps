from app.schemas.common import SolveStatus
from app.schemas.result import (
    GraphXY,
    ModuleResult,
    NamedTable,
    SolutionBlock,
)


def test_module_result_eoq_roundtrip():
    payload = {
        "module": "eoq",
        "status": "ok",
        "solution": {
            "variables": {"Q": 200.0},
            "objective_value": None,
            "objective_sense": None,
            "metrics": {
                "Q_star": 200.0,
                "orders_per_year": 5.0,
                "time_between_orders_years": 0.2,
                "TC": 100.0,
                "TC_ordering": 50.0,
                "TC_holding": 50.0,
            },
        },
        "iterations": None,
        "sensitivity": None,
        "graph": {
            "type": "xy",
            "series": [
                {"name": "TC", "x": [40.0, 200.0], "y": [130.0, 100.0]},
                {"name": "ordering", "x": [40.0, 200.0], "y": [250.0, 50.0]},
                {"name": "holding", "x": [40.0, 200.0], "y": [10.0, 50.0]},
            ],
            "x_label": "Q",
            "y_label": "Cost",
        },
        "tables": [
            {
                "name": "summary",
                "columns": ["metric", "value"],
                "rows": [["Q_star", 200.0], ["TC", 100.0]],
            }
        ],
        "warnings": [],
    }

    result = ModuleResult.model_validate(payload)
    assert result.module == "eoq"
    assert result.status == SolveStatus.ok
    assert result.iterations is None
    assert result.sensitivity is None
    assert isinstance(result.graph, GraphXY)
    assert result.graph.type == "xy"
    assert {s["name"] for s in result.graph.series} == {"TC", "ordering", "holding"}
    assert result.solution.variables["Q"] == 200.0
    assert result.solution.metrics["TC"] == 100.0
    assert result.tables is not None
    assert result.tables[0].name == "summary"

    dumped = result.model_dump(mode="json")
    again = ModuleResult.model_validate(dumped)
    assert again == result


def test_module_result_required_fields_present():
    result = ModuleResult(
        module="eoq",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"Q": 1.0}, metrics={"Q_star": 1.0}),
    )
    data = result.model_dump()
    for key in (
        "module",
        "status",
        "solution",
        "iterations",
        "sensitivity",
        "graph",
        "tables",
        "warnings",
    ):
        assert key in data
    assert data["iterations"] is None
    assert data["sensitivity"] is None
