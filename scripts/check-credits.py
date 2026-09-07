#!/usr/bin/env python3
"""Check remaining credits/balance on paid services, using API keys already
sitting in this repo's .env files (backend/.env, interview-engine/.env).

Only hits services with a genuine, documented balance/usage API reachable
with just the key already in the .env file — no invented endpoints. Services
without such an API (most LLM/voice providers only expose usage via their web
dashboard) are still listed, marked accordingly, so the table stays a
complete inventory of every key found rather than a silent partial one.

Usage: python3 scripts/check-credits.py
No third-party packages required (stdlib only).
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILES = [REPO_ROOT / "backend" / ".env", REPO_ROOT / "interview-engine" / ".env"]
TIMEOUT_SECONDS = 10


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value:
            values[key] = value
    return values


def load_env() -> dict[str, tuple[str, str]]:
    """Returns {VAR_NAME: (value, source_file_label)} — first file found wins
    per variable, matching normal dotenv precedence (backend/.env first)."""
    merged: dict[str, tuple[str, str]] = {}
    for path in ENV_FILES:
        label = path.relative_to(REPO_ROOT).as_posix()
        for key, value in parse_env_file(path).items():
            merged.setdefault(key, (value, label))
    return merged


def truncate(text: str, limit: int = 160) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def mask(value: str) -> str:
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}…{value[-4:]}"


def http_json(url: str, headers: dict[str, str]) -> tuple[int, dict | list | None, str]:
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(body), ""
            except json.JSONDecodeError:
                return resp.status, None, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, None, body
    except Exception as e:  # noqa: BLE001 - report any network/DNS/timeout error uniformly
        return 0, None, str(e)


Row = tuple[str, str, str, str]  # service, key(masked), status, detail


def check_deepseek(env: dict[str, tuple[str, str]]) -> Row | None:
    if "DEEPSEEK_API_KEY" not in env:
        return None
    key, _ = env["DEEPSEEK_API_KEY"]
    status, data, raw = http_json(
        "https://api.deepseek.com/user/balance",
        {"Authorization": f"Bearer {key}"},
    )
    if status == 200 and isinstance(data, dict):
        infos = data.get("balance_infos") or []
        if infos:
            parts = [f"{i.get('total_balance')} {i.get('currency')}" for i in infos]
            return ("DeepSeek", mask(key), "OK", ", ".join(parts))
        return ("DeepSeek", mask(key), "OK", "no balance_infos returned")
    return ("DeepSeek", mask(key), f"ERROR {status}", truncate(raw) if raw else "request failed")


def check_deepgram(env: dict[str, tuple[str, str]]) -> Row | None:
    if "DEEPGRAM_API_KEY" not in env:
        return None
    key, _ = env["DEEPGRAM_API_KEY"]
    headers = {"Authorization": f"Token {key}"}
    status, data, raw = http_json("https://api.deepgram.com/v1/projects", headers)
    if status != 200 or not isinstance(data, dict):
        return ("Deepgram", mask(key), f"ERROR {status}", raw or "could not list projects")
    projects = data.get("projects") or []
    if not projects:
        return ("Deepgram", mask(key), "OK", "no projects on this key")
    parts = []
    for p in projects:
        pid = p.get("project_id")
        bstatus, bdata, braw = http_json(f"https://api.deepgram.com/v1/projects/{pid}/balances", headers)
        if bstatus == 200 and isinstance(bdata, dict):
            balances = bdata.get("balances") or []
            for b in balances:
                parts.append(f"{b.get('amount')} {b.get('units', '')}".strip())
        else:
            try:
                msg = json.loads(braw).get("message", braw) if braw else f"HTTP {bstatus}"
            except (json.JSONDecodeError, AttributeError):
                msg = braw or f"HTTP {bstatus}"
            parts.append(f"{p.get('name', pid)}: {truncate(str(msg), 100)}")
    return ("Deepgram", mask(key), "OK", ", ".join(parts) if parts else "no balance entries")


def check_twilio(env: dict[str, tuple[str, str]]) -> Row | None:
    if "TWILIO_ACCOUNT_SID" not in env or "TWILIO_AUTH_TOKEN" not in env:
        return None
    sid, _ = env["TWILIO_ACCOUNT_SID"]
    token, _ = env["TWILIO_AUTH_TOKEN"]
    creds = base64.b64encode(f"{sid}:{token}".encode()).decode()
    status, data, raw = http_json(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Balance.json",
        {"Authorization": f"Basic {creds}"},
    )
    if status == 200 and isinstance(data, dict):
        return ("Twilio", mask(sid), "OK", f"{data.get('balance')} {data.get('currency')}")
    return ("Twilio", mask(sid), f"ERROR {status}", truncate(raw) if raw else "request failed")


def check_openai(env: dict[str, tuple[str, str]]) -> Row | None:
    if "OPENAI_API_KEY" not in env:
        return None
    key, _ = env["OPENAI_API_KEY"]
    # OpenAI retired the per-key credit-grants endpoint; a project API key
    # can't read billing balance any more, only the org's Admin API can (a
    # different, separately-issued key). This just confirms the key is live.
    status, _data, raw = http_json("https://api.openai.com/v1/models", {"Authorization": f"Bearer {key}"})
    if status == 200:
        return ("OpenAI", mask(key), "KEY VALID", "no public balance API for project keys — check platform.openai.com/usage")
    return ("OpenAI", mask(key), f"ERROR {status}", truncate(raw) if raw else "request failed")


# Services with a key in this repo but no documented balance/usage API
# reachable with just that key (billing lives behind their web dashboard
# only). Listed so the table is a complete inventory, not a silent subset.
NO_BALANCE_API = {
    "GEMINI_API_KEY": "Gemini (Google AI Studio)",
    "GROQ_API_KEY": "Groq",
    "GROK_API_KEY": "Grok (xAI)",
    "XAI_API_KEY": "xAI",
    "CARTESIA_API_KEY": "Cartesia",
    "LIVEKIT_API_KEY": "LiveKit Cloud",
    "RESEND_API_KEY": "Resend",
    "B2_KEY_ID": "Backblaze B2",
    "GOOGLE_CLIENT_SECRET": "Google Drive (OAuth quota, not credits)",
}


def main() -> int:
    env = load_env()
    rows: list[Row] = []

    for checker in (check_deepseek, check_deepgram, check_twilio, check_openai):
        row = checker(env)
        if row:
            rows.append(row)

    for var, label in NO_BALANCE_API.items():
        if var in env:
            key, _ = env[var]
            rows.append((label, mask(key), "N/A", "no public balance API — check provider dashboard"))

    if not rows:
        print("No recognized API keys found in backend/.env or interview-engine/.env.")
        return 1

    headers = ("SERVICE", "KEY", "STATUS", "DETAIL")
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    line = "  ".join(h.ljust(w) for h, w in zip(headers, widths))
    print(line)
    print("  ".join("-" * w for w in widths))
    for r in rows:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)))

    return 0


if __name__ == "__main__":
    sys.exit(main())
