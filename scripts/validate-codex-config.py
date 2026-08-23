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
ATTRIBUTES_PATH = ROOT / ".gitattributes"

EXPECTED_MARKER = "aromatika-codex-root-v1\n"
REQUIRED_LF_ATTRIBUTES = {
    "/.codex/aromatika-project-root text eol=lf",
    "/.codex/config.toml text eol=lf",
}
GIT_WORKTREE_ROOT_BOOTSTRAP = (
    "import{execFile}from'node:child_process';"
    "import{readFile,realpath,stat}from'node:fs/promises';"
    "import{dirname,isAbsolute,join,relative,sep}from'node:path';"
    "import{promisify}from'node:util';"
    "import{pathToFileURL}from'node:url';"
    "const gitEnv={},allowed=['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC',"
    "'TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA'];"
    "for(const name of allowed)"
    "if(typeof process.env[name]==='string')gitEnv[name]=process.env[name];"
    "const session=process.cwd(),gitCwd=dirname(process.execPath);"
    "async function gitRoot(directory){try{"
    "const{stdout}=await promisify(execFile)('git',"
    "['-C',directory,'rev-parse','--show-toplevel'],"
    "{cwd:gitCwd,env:gitEnv,windowsHide:true});"
    "return await realpath(stdout.trim())}catch{return undefined}}"
    "async function isAromatika(candidate){try{"
    "const[marker,manifest]=await Promise.all(["
    "readFile(join(candidate,'.codex','aromatika-project-root'),'utf8'),"
    "readFile(join(candidate,'package.json'),'utf8')"
    "]);const packageJson=JSON.parse(manifest);"
    "return marker==='aromatika-codex-root-v1\\n'&&"
    "packageJson.name==='perfume-marketplace-bg'&&packageJson.private===true"
    "}catch{return false}}"
    "let search=session,root;"
    "for(;;){const candidate=await gitRoot(search);if(!candidate)break;"
    "if(await isAromatika(candidate))root=candidate;"
    "const parent=dirname(candidate);if(parent===candidate)break;search=parent}"
    "if(!root)throw new Error('Aromatika Git worktree root not found');"
)
SVELTE_MCP_BOOTSTRAP = GIT_WORKTREE_ROOT_BOOTSTRAP + (
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
CODEGRAPH_MCP_BOOTSTRAP = GIT_WORKTREE_ROOT_BOOTSTRAP + (
    "const wrapper=await realpath(join(root,'scripts','run-codegraph-mcp.mjs'));"
    "const wrapperRelative=relative(root,wrapper);"
    "if(wrapperRelative===''||wrapperRelative==='..'||"
    "wrapperRelative.startsWith(`..${sep}`)||isAbsolute(wrapperRelative)||"
    "!(await stat(wrapper)).isFile())"
    "throw new Error('Aromatika CodeGraph MCP wrapper is outside the project root');"
    "if(process.argv.includes('--aromatika-resolve-only'))"
    "process.stdout.write(wrapper);"
    "else{"
    "const{launchCodegraphMcp}=await import(pathToFileURL(wrapper).href);"
    "launchCodegraphMcp({repositoryRoot:root})"
    "}"
)
CODEGRAPH_MCP_ARGS = ["--input-type=module", "--eval", CODEGRAPH_MCP_BOOTSTRAP]
DISABLED_21ST_BEARER_PLACEHOLDER = "AROMATIKA_DISABLED_21ST_MCP_NO_TOKEN"
DISABLED_21ST_BEARER_LINE = (
    f'bearer_token_env_var = "{DISABLED_21ST_BEARER_PLACEHOLDER}"'
)

EXPECTED_RAW = (
    'model_reasoning_effort = "high"\n'
    "\n"
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
    'enabled = false\n'
    "\n"
    "[mcp_servers.21st]\n"
    'url = "https://21st.dev/api/mcp"\n'
    'enabled = false\n'
    f'{DISABLED_21ST_BEARER_LINE}\n'
    "\n"
    "[mcp_servers.codegraph]\n"
    'command = "node"\n'
    f"args = {json.dumps(CODEGRAPH_MCP_ARGS)}\n"
    'enabled = true\n'
    "\n"
    "[mcp_servers.MCP_DOCKER]\n"
    'command = "docker.exe"\n'
    'args = ["mcp", "gateway", "run", "--profile", "profile"]\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.cloudflare]\n"
    'url = "https://mcp.cloudflare.com/mcp"\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.cloudflare-bindings]\n"
    'url = "https://bindings.mcp.cloudflare.com/mcp"\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.cloudflare-builds]\n"
    'url = "https://builds.mcp.cloudflare.com/mcp"\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.cloudflare-docs]\n"
    'url = "https://docs.mcp.cloudflare.com/mcp"\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.cloudflare-observability]\n"
    'url = "https://observability.mcp.cloudflare.com/mcp"\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.context7]\n"
    'url = "https://mcp.context7.com/mcp"\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.github]\n"
    'command = "npx"\n'
    'args = ["-y", "@modelcontextprotocol/server-github"]\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.playwright]\n"
    'command = "npx"\n'
    'args = ["@playwright/mcp@latest"]\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.sequential-thinking]\n"
    'command = "npx"\n'
    'args = ["-y", "@modelcontextprotocol/server-sequential-thinking"]\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.supabase]\n"
    'url = "https://mcp.supabase.com/mcp"\n'
    'enabled = false\n'
    "\n"
    "[mcp_servers.svelte]\n"
    'command = "npx"\n'
    'args = ["-y", "@sveltejs/mcp"]\n'
    'enabled = false\n'
)

EXPECTED = {
    "model_reasoning_effort": "high",
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
            "enabled": False,
        },
        "21st": {
            "url": "https://21st.dev/api/mcp",
            "enabled": False,
            "bearer_token_env_var": DISABLED_21ST_BEARER_PLACEHOLDER,
        },
        "codegraph": {
            "command": "node",
            "args": CODEGRAPH_MCP_ARGS,
            "enabled": True,
        },
        "MCP_DOCKER": {
            "command": "docker.exe",
            "args": ["mcp", "gateway", "run", "--profile", "profile"],
            "enabled": False,
        },
        "cloudflare": {
            "url": "https://mcp.cloudflare.com/mcp",
            "enabled": False,
        },
        "cloudflare-bindings": {
            "url": "https://bindings.mcp.cloudflare.com/mcp",
            "enabled": False,
        },
        "cloudflare-builds": {
            "url": "https://builds.mcp.cloudflare.com/mcp",
            "enabled": False,
        },
        "cloudflare-docs": {
            "url": "https://docs.mcp.cloudflare.com/mcp",
            "enabled": False,
        },
        "cloudflare-observability": {
            "url": "https://observability.mcp.cloudflare.com/mcp",
            "enabled": False,
        },
        "context7": {
            "url": "https://mcp.context7.com/mcp",
            "enabled": False,
        },
        "github": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "enabled": False,
        },
        "playwright": {
            "command": "npx",
            "args": ["@playwright/mcp@latest"],
            "enabled": False,
        },
        "sequential-thinking": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
            "enabled": False,
        },
        "supabase": {
            "url": "https://mcp.supabase.com/mcp",
            "enabled": False,
        },
        "svelte": {
            "command": "npx",
            "args": ["-y", "@sveltejs/mcp"],
            "enabled": False,
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
    raw = CONFIG_PATH.read_bytes().decode("utf-8")
    marker = MARKER_PATH.read_bytes().decode("utf-8")
    if not ATTRIBUTES_PATH.exists():
        fail(".gitattributes must pin security-critical Codex files to LF")
    attributes = set(ATTRIBUTES_PATH.read_text(encoding="utf-8").splitlines())

    if raw != EXPECTED_RAW:
        fail("config.toml must match the canonical no-comment form")
    if marker != EXPECTED_MARKER:
        fail("the repository-root marker must match the canonical value")
    if not REQUIRED_LF_ATTRIBUTES <= attributes:
        fail("security-critical Codex files must be checked out with LF bytes")
    raw_without_approved_placeholder = raw.replace(
        f"{DISABLED_21ST_BEARER_LINE}\n", ""
    )
    if FORBIDDEN_FIELD.search(raw_without_approved_placeholder):
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
    if (
        package.get("devDependencies", {}).get("@colbymchenry/codegraph")
        != "1.5.0"
    ):
        fail("@colbymchenry/codegraph must be an exact locked development dependency")

    print("Codex config contract passed")


if __name__ == "__main__":
    main()
