import re

from app.cors import allow_origin_regex, allow_origins


def test_default_origins_include_local_vite():
    origins = allow_origins({})
    assert "http://localhost:5173" in origins
    assert "http://127.0.0.1:5173" in origins


def test_cors_origins_appends_custom_domains():
    origins = allow_origins(
        {"CORS_ORIGINS": "https://laraops.example.com, https://www.laraops.example.com"}
    )
    assert "https://laraops.example.com" in origins
    assert "https://www.laraops.example.com" in origins
    assert origins[0] == "http://localhost:5173"


def test_default_regex_allows_onrender_hosts():
    pattern = allow_origin_regex({})
    assert pattern is not None
    compiled = re.compile(pattern)
    assert compiled.fullmatch("https://laraops-web.onrender.com")
    assert compiled.fullmatch("https://laraops-web-pr-3.onrender.com")
    assert not compiled.fullmatch("http://evil.example.com")


def test_empty_regex_disables_onrender_wildcard():
    assert allow_origin_regex({"CORS_ORIGIN_REGEX": ""}) is None


def test_options_from_onrender_is_allowed(client):
    response = client.options(
        "/health",
        headers={
            "Origin": "https://laraops-web.onrender.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == (
        "https://laraops-web.onrender.com"
    )
