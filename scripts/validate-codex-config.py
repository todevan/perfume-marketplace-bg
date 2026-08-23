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
MARKER_PATH = ROOT / ".codex" / "aromatika-project-root"
PACKAGE_PATH = ROOT / "package.json"

EXPECTED_MARKER = "aromatika-codex-root-v1\n"
SVELTE_MCP_BOOTSTRAP = (
    "import{readFile,realpath,stat}from'node:fs/promises';"
    "import{dirname,isAbsolute,join,relative,sep}from'node:path';"
    "import{pathToFileURL}from'node:url';"
    "let candidate=process.cwd(),root;"
    "for(;;){"
    "try{"
    "const[marker,manifest]=await Promise.all(["
    "readFile(join(candidate,'.codex','aromatika-project-root'),'utf8'),"
    "readFile(join(candidate,'package.json'),'utf8')"
    "]);"
    "const packageJson=JSON.parse(manifest);"
    "if(marker==='aromatika-codex-root-v1\\n'&&"
    "packageJson.name==='perfume-marketplace-bg'&&packageJson.private===true){"
    "root=await realpath(candidate);break"
    "}"
    "}catch{}"
    "const parent=dirname(candidate);"
    "if(parent===candidate)throw new Error('Aromatika project root not found');"
    "candidate=parent"
    "}"
    "const wrapper=await realpath(join(root,'scripts','run-svelte-mcp.mjs'));"
    "const wrapperRelative=relative(root,wrapper);"
    "if(wrapperRelative===''||wrapperRelative==='..'||"
    "wrapperRelative.startsWith(`..${sep}`)||isAbsolute(wrapperRelative)||"
    "!(await stat(wrapper)).isFile())"
    "throw new Error('Aromatika Svelte MCP wrapper is outside the project root');"
    "if(process.argv.includes('--aromatika-resolve-only'))"
    "process.stdout.write(wrapper);"
    "else{"
    "const{launchSvelteMcp}=await import(pathToFileURL(wrapper).href);"
    "launchSvelteMcp()"
    "}"
)
SVELTE_MCP_ARGS = ["--input-type=module", "--eval", SVELTE_MCP_BOOTSTRAP]

EXPECTED_RAW = (
    "[mcp_servers.aromatika-svelte]\n"
    'command = "node"\n'
    f"args = {json.dumps(SVELTE_MCP_ARGS)}\n"
    'enabled_tools = ["list-sections", "get-documentation", "svelte-autofixer"]\n'
    'default_tools_approval_mode = "auto"\n'
    "\n"
    "[mcp_servers.aromatika-cloudflare-observability]\n"
    'url = "https://observability.mcp.cloudflare.com/mcp"\n'
    'enabled_tools = ["query_worker_observability", "observability_keys", "observability_values"]\n'
    'default_tools_approval_mode = "prompt"\n'
)

EXPECTED = {
    "mcp_servers": {
        "aromatika-svelte": {
            "command": "node",
            "args": SVELTE_MCP_ARGS,
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
    marker = MARKER_PATH.read_text(encoding="utf-8")

    if raw != EXPECTED_RAW:
        fail("config.toml must match the canonical no-comment form")
    if marker != EXPECTED_MARKER:
        fail("the repository-root marker must match the canonical value")
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
