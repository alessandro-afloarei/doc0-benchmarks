---
type: interface
title: Command-Line Interface
description: The openhands console entrypoint and its cli/serve subcommands, how the interactive terminal UI assembles a conversation, its default CLI runtime and confirmation behavior, slash commands, settings persistence in ~/.openhands, the Docker-based GUI launcher, and the headless openhands.core.main entrypoint.
tags: [cli, tui, prompt-toolkit, headless, settings, gui-launcher]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-3f73c64de691a0172828acb1
    resource: repo://openhands/cli/commands.py
  - id: openwiki-source-ab3c6807c36a554faa63f162
    resource: repo://openhands/cli/entry.py
  - id: openwiki-source-33bda7da9a7aaa1b62b92f7d
    resource: repo://openhands/cli/gui_launcher.py
  - id: openwiki-source-2560404802cbc340c233d2ec
    resource: repo://openhands/cli/main.py
  - id: openwiki-source-543eb685c906717f0f595ca3
    resource: repo://openhands/cli/tui.py
  - id: openwiki-source-d3f14b919d4ae24afe8df275
    resource: repo://openhands/core/main.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Command-Line Interface

OpenHands has two terminal entrypoints:

- **`openhands`**, the console script declared in `pyproject.toml` as `openhands.cli.entry:main`. It runs an interactive terminal UI (TUI) or launches the web GUI in Docker.
- **`python -m openhands.core.main`**, a non-interactive runner for a single task. Evaluations and the resolver use the same code path ([Architecture Overview](../architecture/overview.md#assembly-headless-path)).

## `openhands` entrypoint

`openhands/cli/entry.py:main()`:

1. Handles `--help`/`-h` and `--version` through a fast path (`fast_help.py`) that skips the heavy imports, so help output appears quickly.
2. If the first argument isn't `cli` or `serve`, inserts `cli`. Running plain `openhands` therefore starts the TUI.
3. `serve` calls `gui_launcher.launch_gui_server(mount_cwd, gpu)`. This checks Docker, pulls the versioned `docker.all-hands.dev/all-hands-ai/runtime:<version>-nikolaik` image, and `docker run`s the matching `openhands:<version>` app image. It sets `SANDBOX_RUNTIME_CONTAINER_IMAGE`, mounts the Docker socket and `~/.openhands` (as `/.openhands`). `--mount-cwd` mounts the current directory with `SANDBOX_VOLUMES=<cwd>:/workspace:rw`, and `--gpu` adds `--gpus all`.
4. `cli` calls `openhands/cli/main.py:run_cli_command(args)`.

Arguments come from `get_cli_parser()` in `openhands/core/config/arg_utils.py`: the common flags (`--config-file`, `-t/--task`, `-f/--file`, `-n/--name`, `-l/--llm-config`, `--agent-config`, `--log-level`), plus `--conversation <id>` to continue a conversation and `--override-cli-mode`.

## Configuration in CLI mode

`main_with_loop()` resolves configuration like this:

1. Uses `./config.toml` if it exists, otherwise `~/.openhands/config.toml`. Then calls `setup_config_from_args(args)` ([Configuration System](../configuration/config-system.md#load-order-and-precedence)).
2. Tries a one-time install of the VS Code extension (`vscode_extension.py`).
3. Loads `~/.openhands/settings.json` through `FileSettingsStore`. **If there are no settings, it runs the interactive setup flow** to choose an LLM provider, model, and API key. Settings fill in the LLM model, key, and base URL only when neither `-l` nor `config.toml` set them. Settings also control confirmation mode, the search API key, and the condenser: an LLM summarizing condenser when `enable_default_condenser` is on, otherwise `noop`.
4. **CLI defaults**, unless `--override-cli-mode` is given:
   - `runtime = 'cli'`, which runs commands directly on the host ([Runtime Implementations](../runtime/runtime-implementations.md));
   - `workspace_base = cwd`;
   - confirmation mode on, with the `llm` security analyzer;
   - `agent_config.cli_mode = True`.

   `finalize_config` then runs again, so Jupyter and browsing are disabled for the CLI runtime.
5. Offers to add shell aliases (`shell_config.py`) on interactive terminals, unless the user declined before.
6. **Folder trust check** (`check_folder_security_agreement`): if the workspace isn't listed in the trusted directories, from `~/.openhands/config.toml` or `sandbox.trusted_dirs`, the user must confirm. A confirmed directory is saved as trusted.
7. Reads the initial task from `-t`, from `-f` (wrapped in a prompt telling the agent to read the file and then ask what to do), or from stdin.
8. Calls `Runtime.setup(config)` for the runtime class, then `run_session`. `/new` or a restart loops back to `run_session`.

## A CLI session

`run_session()` builds the same components as the headless path: `create_registry_and_conversation_stats`, `create_agent`, `create_runtime(headless_mode=True)`, and `create_controller` (which restores state when `--conversation` names an existing session). It also streams shell output into the TUI (`runtime.subscribe_to_shell_stream`), subscribes a `MAIN` event callback, connects the runtime, optionally clones `--selected-repo`, creates `Memory`, and registers MCP tools while collecting MCP errors for `/mcp`.

The event callback renders every event (`tui.display_event`), updates usage metrics, and drives the interaction loop:

- **`AWAITING_USER_INPUT` / `FINISHED`**: prompts for the next message. If `/init` just created `repo.md`, it reloads repository microagents first.
- **`AWAITING_USER_CONFIRMATION`**: shows the pending action's security risk and asks yes, no, always, or "auto high-risk". *Always* confirms every later action automatically. *Auto high-risk* confirms everything automatically except `HIGH` risk actions. *No* sends `USER_REJECTED` and asks the user what to do instead. See [Security Analyzers](../security/security-analyzers.md).
- **`RUNNING`**: shows "Agent running… (Press Ctrl-P to pause)" and starts a key listener. Pausing moves the agent to `PAUSED`, which prompts for input again.

The TUI is built with `prompt_toolkit` (`tui.py`, `pt_style.py`), with optional multiline input (finish with Ctrl-D) and a vi-mode setting.

### Slash commands

Defined in `tui.COMMANDS` and handled in `commands.py:handle_commands`:

| Command | Effect |
| --- | --- |
| `/exit` | End the session (asks for confirmation) |
| `/help` | List commands |
| `/init` | Create `.openhands/microagents/repo.md` by asking the agent to explore the repo ([Microagents](../concepts/microagents.md)) |
| `/status` | Conversation id and usage metrics (cost, tokens) |
| `/new` | Start a new conversation |
| `/settings` | View or change LLM settings (basic or advanced), the search API key, and so on. Changes go to `settings.json`. |
| `/resume` | Send `continue` to a paused agent |
| `/mcp` | List, add (SSE, SHTTP, stdio), or remove MCP servers in `./config.toml` (or `~/.openhands/config.toml` if there is none), and show MCP errors. Changes require a restart. |

## Headless: `openhands.core.main`

`python -m openhands.core.main -t "task" [-c AgentCls] [-i max_iter] [-b max_budget] [-l llm_group] [--selected-repo owner/repo] [-n name] [--no-auto-continue]`:

- Loads config the standard way (`setup_config_from_args`), reads the task (`-t`, `-f`, or stdin), and calls `run_controller`.
- Unless `--no-auto-continue` is given, `auto_continue_response` replies "continue … never ask for human response" every time the agent waits for input. `/exit` replies end the run.
- `replay_trajectory_path` replays a saved trajectory and rejects an explicit task. `save_trajectory_path` writes the trajectory JSON at the end.

## Tests

`tests/unit/cli/` covers commands, settings and setup flows, config management, pause/resume, the TUI, vi mode, alias setup, workspace trust, MCP in the CLI runtime, and the VS Code extension installer.

## Related pages

- [Configuration System](../configuration/config-system.md)
- [Runtime Implementations](../runtime/runtime-implementations.md): the CLI runtime
- [System Architecture Overview](../architecture/overview.md)
- [MCP Integration](../integrations/mcp.md)
