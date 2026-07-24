from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def assert_allclose(
    actual: float | dict[str, float] | list[float],
    expected: float | dict[str, float] | list[float],
    *,
    atol: float = 1e-6,
) -> None:
    """Numeric helper used across module fixtures."""
    if isinstance(actual, dict) and isinstance(expected, dict):
        assert set(actual) == set(expected)
        for key in expected:
            np.testing.assert_allclose(actual[key], expected[key], atol=atol)
        return
    if isinstance(actual, (list, tuple)) and isinstance(expected, (list, tuple)):
        np.testing.assert_allclose(np.asarray(actual, dtype=float), np.asarray(expected, dtype=float), atol=atol)
        return
    np.testing.assert_allclose(float(actual), float(expected), atol=atol)  # type: ignore[arg-type]


@pytest.fixture
def atol() -> float:
    return 1e-6
