---
type: component
title: CLI and Headless Entry Points
description: The `openhands` command (cli and serve subcommands), its fast-help path, how the interactive terminal session assembles runtime/agent/memory/controller, CLI-specific defaults (cli runtime, confirmation mode, LLM analyzer), slash commands, and the lower-level headless run_controller entry point.
tags: [cli, tui, headless, entrypoint, serve, run_controller]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-3f73c64de691a0172828acb1
    resource: repo://openhands/cli/commands.py
  - id: openwiki-source-ab3c6807c36a554faa63f162
    resource: repo://openhands/cli/entry.py
  - id: openwiki-source-78c96a6d72c6545a74218066
    resource: repo://openhands/cli/fast_help.py
  - id: openwiki-source-33bda7da9a7aaa1b62b92f7d
    resource: repo://openhands/cli/gui_launcher.py
  - id: openwiki-source-2560404802cbc340c233d2ec
    resource: repo://openhands/cli/main.py
  - id: openwiki-source-c24e3823e9e99279e9a9f374
    resource: repo://openhands/core/loop.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# CLI and Headless Entry Points

There are three ways to run an agent without the web UI. They share the same building blocks in `openhands/core/setup.py` (`create_agent`, `create_runtime`, `create_memory`, `create_controller`) described in the [Overview](../architecture/overview.md).

| Entry | Code | Use |
|---|---|---|
| `openhands` / `openhands cli` | `openhands/cli/` | Interactive terminal agent (prompt_toolkit TUI). |
| `openhands serve` | `cli/gui_launcher.py` | Launch the web GUI in Docker. |
| `run_controller` | `core/main.py` | Programmatic/headless run used by evaluation and the [resolver](../workflows/issue-resolver.md). |

The console script is `openhands = "openhands.cli.entry:main"` in `pyproject.toml`.

## `entry.py` and the fast path

`entry.main()` first calls `handle_fast_commands()` from `cli/fast_help.py`. That module builds a **lightweight argparse parser** (no heavy imports) just for `--help`/`--version`, because importing the full code base made `openhands --help` take ~20 seconds (GitHub issue #10698, cited in the module docstring). If the fast path handled the request the process exits. Otherwise the real parser (`get_cli_parser` from `core/config/`) is imported lazily. If the first argument is not `cli` or `serve`, `cli` is injected, so `openhands` alone equals `openhands cli`. `serve` calls `launch_gui_server`; `cli` calls `run_cli_command`. All other imports are deferred until needed, which keeps startup fast.

## `openhands serve`

`launch_gui_server(mount_cwd, gpu)` checks Docker requirements, ensures a config dir, pulls the runtime image `docker.all-hands.dev/all-hands-ai/runtime:<version>-nikolaik`, then runs `docker run -it --rm --pull=always` of the app image `docker.all-hands.dev/all-hands-ai/openhands:<version>` with:

- `/var/run/docker.sock` mounted (the app container starts sandbox containers as siblings),
- the config dir mounted at `/.openhands`,
- `SANDBOX_RUNTIME_CONTAINER_IMAGE` pointing at the pulled runtime image,
- port `3000:3000`, `--add-host host.docker.internal:host-gateway`, container name `openhands-app`,
- optionally `--gpus all` + `SANDBOX_ENABLE_GPU=true`, and with `--mount-cwd` `SANDBOX_VOLUMES=<cwd>:/workspace:rw` plus `SANDBOX_USER_ID`.

## The interactive CLI session (`cli/main.py`)

`run_cli_command` creates an asyncio loop and runs `main_with_loop`, which:

1. Applies log level (default WARNING) and falls back to `~/.openhands/config.toml` when `config.toml` is absent in the cwd; builds config with `setup_config_from_args` (see [Configuration](../configuration/configuration.md)).
2. Tries a one-time VS Code extension install (`vscode_extension.py`: GitHub release, bundled vsix, or marketplace).
3. Loads settings from `~/.openhands/settings.json` through `FileSettingsStore`; if none exist, runs the **setup flow** (`cli/settings.py`, provider/model/API key prompts). Precedence for the LLM config: `-l` CLI argument > `config.toml` > `settings.json`. The settings' `enable_default_condenser` chooses an `LLMSummarizingCondenserConfig` vs a `NoOpCondenserConfig` for the agent.
4. Unless `--override-cli-mode` is set, **applies CLI defaults**: `runtime = 'cli'`, `workspace_base = cwd`, `security.confirmation_mode = True`, `security.security_analyzer = 'llm'`, `agent_config.cli_mode = True`, then re-runs `finalize_config` (so the Jupyter plugin is disabled for the CLI runtime).
5. Offers shell alias setup (only on a TTY and if not declined), asks the user to accept a folder-trust agreement (`check_folder_security_agreement`), and reads the task from `--file` (wrapped in a "read this file first" prompt), CLI args or stdin.
6. Calls `get_runtime_cls(config.runtime).setup(config)`, runs `run_session` (looping while the user requests `/new`), and tears the runtime down.

`run_session` builds registry/agent/runtime with `headless_mode=True`, subscribes an async handler under `EventStreamSubscriber.MAIN`, connects the runtime, initializes the repo, creates memory and the controller, and renders events (`tui.py`). The handler implements the UX around [AgentState](../architecture/agent-controller.md):

- `AWAITING_USER_INPUT`/`FINISHED` → prompt for the next task (reloading workspace microagents after `/init` created `repo.md`).
- `AWAITING_USER_CONFIRMATION` → ask yes/no/always/auto-high-risk. `always` confirms everything; `auto_highrisk` auto-confirms anything not `ActionSecurityRisk.HIGH`. Confirmation is communicated by publishing `ChangeAgentStateAction(USER_CONFIRMED|USER_REJECTED)`. Because the controller treats CLI mode specially (it always sets awaiting-confirmation and lets the CLI decide), the policy lives here. See [Security](../security/security-and-confirmation.md).
- `PAUSED`/`RUNNING` → a pause-key listener sends a pause request while the agent runs.

### Slash commands

`cli/commands.py::handle_commands` interprets `/exit`, `/help`, `/init` (create repo microagent instructions), `/status` (usage metrics), `/new`, `/settings`, `/resume`, `/mcp` (add/list/remove SSE, stdio and streamable-HTTP MCP servers in the config file, see [MCP](../integrations/mcp.md)); anything else is sent as a normal `MessageAction`.

## Headless: `run_controller` and `run_agent_until_done`

`core/main.py::run_controller` is documented in the [Overview](../architecture/overview.md#headless-path-cli-resolver-evaluation). `core/loop.py::run_agent_until_done(controller, runtime, memory, end_states)` installs a shared `status_callback` on runtime, controller and memory (raising if any already had one — they must not be shared with another owner), converts `error` status messages into `last_error` plus `AgentState.ERROR`, and polls once per second until the state is in `end_states`.

`create_runtime` derives the session id with `generate_sid` when none is given, creates the `EventStream` on the configured file store, picks the agent class (`config.default_agent`) to read its `sandbox_plugins`, and instantiates `get_runtime_cls(config.runtime)`; `headless_mode` defaults to true so no VS Code UI opens in evaluations.

Related: [Configuration](../configuration/configuration.md), [Runtime](../runtime/runtime-and-sandbox.md), [Testing and evaluation](../operations/testing-and-evaluation.md).
