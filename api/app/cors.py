from __future__ import annotations

import os

DEFAULT_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)
DEFAULT_ORIGIN_REGEX = r"https://.*\.onrender\.com"


def allow_origins(environ: dict[str, str] | None = None) -> list[str]:
    source = os.environ if environ is None else environ
    extra = [part.strip() for part in source.get("CORS_ORIGINS", "").split(",") if part.strip()]
    return [*DEFAULT_ORIGINS, *extra]


def allow_origin_regex(environ: dict[str, str] | None = None) -> str | None:
    source = os.environ if environ is None else environ
    if "CORS_ORIGIN_REGEX" in source:
        value = source["CORS_ORIGIN_REGEX"].strip()
        return value or None
    return DEFAULT_ORIGIN_REGEX
