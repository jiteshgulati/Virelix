"""Tiny request/response/router layer over ``http.server``."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from http.cookies import SimpleCookie
from typing import Any, Callable
from urllib.parse import parse_qs, unquote

MAX_JSON_BYTES = 256 * 1024


class HttpError(Exception):
    def __init__(self, status: int, code: str, message: str, **extra: Any):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra


def bad_request(message: str, code: str = "invalid_request", **extra) -> HttpError:
    return HttpError(400, code, message, **extra)


@dataclass
class Request:
    method: str
    path: str
    query: dict
    headers: dict            # lower-cased keys
    body: bytes
    client_addr: str
    cookies: dict = field(default_factory=dict)

    @classmethod
    def build(cls, method: str, raw_path: str, headers: dict, body: bytes, client_addr: str) -> "Request":
        path, _, qs = raw_path.partition("?")
        query = {k: v[-1] for k, v in parse_qs(qs, keep_blank_values=True).items()}
        lower = {k.lower(): v for k, v in headers.items()}
        cookies = {}
        if "cookie" in lower:
            jar = SimpleCookie()
            try:
                jar.load(lower["cookie"])
                cookies = {k: m.value for k, m in jar.items()}
            except Exception:
                cookies = {}
        return cls(method.upper(), unquote(path), query, lower, body, client_addr, cookies)

    def json(self) -> dict:
        if not self.body:
            return {}
        if len(self.body) > MAX_JSON_BYTES:
            raise HttpError(413, "payload_too_large", "Request body is too large.")
        ctype = self.headers.get("content-type", "")
        if "application/json" not in ctype:
            raise HttpError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.")
        try:
            data = json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise bad_request("Request body is not valid JSON.")
        if not isinstance(data, dict):
            raise bad_request("Request body must be a JSON object.")
        return data

    def int_query(self, name: str, default: int, lo: int, hi: int) -> int:
        try:
            value = int(self.query.get(name, default))
        except (TypeError, ValueError):
            raise bad_request(f"'{name}' must be a whole number.")
        return max(lo, min(hi, value))


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    content_type: str = "application/json; charset=utf-8"
    headers: dict = field(default_factory=dict)
    cookies: list = field(default_factory=list)   # pre-rendered Set-Cookie values

    def set_cookie(self, name: str, value: str, *, max_age: int | None = None, http_only: bool = True,
                   secure: bool = False, same_site: str = "Strict", path: str = "/") -> None:
        parts = [f"{name}={value}", f"Path={path}", f"SameSite={same_site}"]
        if max_age is not None:
            parts.append(f"Max-Age={max_age}")
        if http_only:
            parts.append("HttpOnly")
        if secure:
            parts.append("Secure")
        self.cookies.append("; ".join(parts))

    def clear_cookie(self, name: str, *, secure: bool = False, http_only: bool = True) -> None:
        self.set_cookie(name, "", max_age=0, secure=secure, http_only=http_only)


def json_response(data: Any, status: int = 200) -> Response:
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    return Response(status=status, body=body, headers={"Cache-Control": "no-store"})


def error_response(err: HttpError) -> Response:
    payload = {"error": {"code": err.code, "message": err.message, **err.extra}}
    resp = json_response(payload, err.status)
    if err.status == 429 and "retry_after" in err.extra:
        resp.headers["Retry-After"] = str(err.extra["retry_after"])
    return resp


@dataclass
class Route:
    method: str
    regex: re.Pattern
    handler: Callable
    auth: str | None          # None (public) | "user" | "admin" | "owner"
    csrf: bool


class Router:
    def __init__(self) -> None:
        self.routes: list[Route] = []

    def add(self, method: str, pattern: str, handler: Callable, *, auth: str | None = "user", csrf: bool | None = None):
        regex = "^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[A-Za-z0-9_.-]+)", pattern) + "$"
        if csrf is None:
            csrf = method not in {"GET", "HEAD"}
        self.routes.append(Route(method, re.compile(regex), handler, auth, csrf))

    def match(self, method: str, path: str):
        allowed = False
        for route in self.routes:
            m = route.regex.match(path)
            if not m:
                continue
            if route.method == method:
                return route, m.groupdict()
            allowed = True
        if allowed:
            raise HttpError(405, "method_not_allowed", "Method not allowed for this endpoint.")
        raise HttpError(404, "not_found", "No such API endpoint.")
