#!/usr/bin/env python3
"""Validate Aromatika's project-scoped Codex configuration."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / ".codex" / "config.toml"
PACKAGE_PATH = ROOT / "package.json"

EXPECTED_RAW = """[mcp_servers.aromatika-svelte]
command = "node"
args = ["scripts/run-svelte-mcp.mjs"]
enabled_tools = ["list-sections", "get-documentation", "svelte-autofixer"]
default_tools_approval_mode = "auto"

[mcp_servers.aromatika-cloudflare-observability]
url = "https://observability.mcp.cloudflare.com/mcp"
enabled_tools = ["query_worker_observability", "observability_keys", "observability_values"]
default_tools_approval_mode = "prompt"
"""

EXPECTED = {
    "mcp_servers": {
        "aromatika-svelte": {
            "command": "node",
            "args": ["scripts/run-svelte-mcp.mjs"],
            "enabled_tools": [
                "list-sections",
                "get-documentation",
                "svelte-autofixer",
            ],
            "default_tools_approval_mode": "auto",
        },
        "aromatika-cloudflare-observability": {
            "url": "https://observability.mcp.cloudflare.com/mcp",
            "enabled_tools": [
                "query_worker_observability",
                "observability_keys",
                "observability_values",
            ],
            "default_tools_approval_mode": "prompt",
        },
    },
}

FORBIDDEN_FIELD = re.compile(
    r"(?im)^\s*(?:env|env_vars|bearer_token_env_var|http_headers|"
    r"env_http_headers|authorization|api_?key|token|secret|password)\s*="
)
TOKEN_SHAPE = re.compile(
    r"(?i)(?:sk-[a-z0-9_-]{20,}|"
    r"(?:api[_-]?key|token|secret)\s*[:=]\s*[\"']?[a-z0-9._-]{16,})"
)


def fail(message: str) -> None:
    print(f"Codex config contract failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    raw = CONFIG_PATH.read_text(encoding="utf-8")

    if raw != EXPECTED_RAW:
        fail("config.toml must match the canonical no-comment form")
    if FORBIDDEN_FIELD.search(raw):
        fail("credential-bearing fields are not allowed")
    if TOKEN_SHAPE.search(raw):
        fail("token-shaped values are not allowed")

    try:
        parsed = tomllib.loads(raw)
    except tomllib.TOMLDecodeError:
        fail("config.toml is not valid TOML")

    if parsed != EXPECTED:
        fail("the server, tool, or approval policy differs from the approved set")

    package = json.loads(PACKAGE_PATH.read_text(encoding="utf-8"))
    if package.get("devDependencies", {}).get("@sveltejs/mcp") != "0.1.26":
        fail("@sveltejs/mcp must be an exact locked development dependency")

    print("Codex config contract passed")


if __name__ == "__main__":
    main()
