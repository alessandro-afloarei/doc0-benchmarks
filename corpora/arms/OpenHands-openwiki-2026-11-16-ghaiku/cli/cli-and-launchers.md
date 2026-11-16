---
type: architecture
title: CLI and Local Launchers
description: The openhands command-line application, including subcommand dispatch, the fast help and version path, the interactive terminal session and its slash commands, headless task runs, the Docker-based serve command that starts the web GUI, MCP server management from the CLI, and the VS Code extension install and packaging hooks.
tags: [cli, terminal, launcher, docker, serve, slash-commands, mcp, vscode-extension]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-9f1ffbc02a4f9ef74f2d8ea3
    resource: repo://build_vscode.py
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
  - id: openwiki-source-bdc0fb5ebfef4ceedf1c2998
    resource: repo://openhands/cli/vscode_extension.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# CLI and Local Launchers

The `openhands` command is the entry point most people use to run the agent on their own machine.
It has three personalities: an interactive terminal session (the default), a `serve` command that
starts the web GUI in Docker, and fast paths for `--help` and `--version`. All three are in
`openhands/cli/`. The CLI reuses the agent core and runtime described in
[Agent Controller and Step Loop](../architecture/agent-controller.md) and
[Runtime Abstraction and Execution Backends](../architecture/runtime.md); it does not have its own
agent loop.

## Entry point and dispatch

The console script `openhands` is bound to `openhands.cli.entry:main`
(`pyproject.toml:170-171`). `main` (`openhands/cli/entry.py:12`) builds the argument parser and
applies one rule: if the first argument is not `cli` or `serve`, the parser inserts `cli`, so
`openhands` alone, or `openhands --task ...`, runs the terminal session (`entry.py:20-30`). Then:

- `serve` calls `launch_gui_server(mount_cwd=..., gpu=...)` (`entry.py:36-40`);
- `cli` or no command calls `run_cli_command(args)` (`openhands/cli/main.py:758`).

Before any of that, `handle_fast_commands` (`openhands/cli/fast_help.py:143`) answers `--help`,
`-h`, and `--version` from a lightweight parser. The fast path exists so help and version output do
not wait for the agent stack to import. The most recent commit in this repository,
`30604c4`, improved exactly this path.

## Interactive session

`run_cli_command` (`main.py:758`) creates an asyncio loop and runs `main_with_loop`
(`main.py:565`), which:

1. sets the log level (WARNING by default, or from `--log-level` or `LOG_LEVEL`);
2. falls back to `~/.openhands/config.toml` when `config.toml` is not in the working directory
   (`main.py:578-590`) and loads configuration with `setup_config_from_args`
   (see [Configuration System](../architecture/configuration.md));
3. runs the setup flow on first use (`run_setup_flow`, `main.py:446`) or the alias setup flow
   (`run_alias_setup_flow`, `main.py:476`) when no LLM is configured;
4. applies the saved CLI settings, including confirmation mode, which the CLI stores in
   `settings.json` under the file store path (`main.py:638`, `openhands/cli/settings.py:88`);
5. calls `run_session` (`main.py:125`) to start a conversation.

`run_session` builds the same objects as the server does: a registry and conversation statistics
(`create_registry_and_conversation_stats`), an agent (`create_agent`), a runtime (`create_runtime`),
a controller (`create_controller`), and memory (`create_memory`). It then drives the agent with
`run_agent_until_done` (`main.py:432`) in headless mode for the controller (`main.py:167`). User
input is read by the terminal UI in `tui.py` and `pt_style.py` (prompt_toolkit). Confirmation
prompts for risky actions are shown in the terminal when the controller marks an action as awaiting
confirmation (see [Security Model and Sandboxing](../operations/security.md)).

`cleanup_session` (`main.py:91`) closes the controller, and `run_cli_command` cancels any remaining
tasks before closing the loop (`main.py:758-780`).

### Headless task runs

The `--task` and `--file` options provide the task text without interaction, and `--conversation`
and `--name` resume or name a session. Headless runs use the same controller loop, which ends at a
terminal agent state. Option definitions are in `openhands/core/config/arg_utils.py`, where `get_cli_parser`
(`arg_utils.py:145`) builds the CLI parser and `get_headless_parser` (`arg_utils.py:210`) builds the
headless one.

### Slash commands

Inside the session, input starting with `/` is handled by `handle_commands`
(`openhands/cli/commands.py:122`). The handlers are:

| Command | Handler | Effect |
| --- | --- | --- |
| `/exit` | `handle_exit_command` (`commands.py:176`) | End the session. |
| `/help` | `handle_help_command` (`commands.py:200`) | Print command help. |
| `/init` | `handle_init_command` (`commands.py:204`) | Create repository instructions for the current folder through `init_repository` (`commands.py:325`). |
| `/status` | `handle_status_command` (`commands.py:235`) | Show usage metrics and the session ID. |
| `/new` | `handle_new_command` (`commands.py:239`) | Start a new conversation. |
| `/settings` | `handle_settings_command` (`commands.py:269`) | Change LLM and other settings. |
| `/resume` | `handle_resume_command` (`commands.py:296`) | Resume an earlier conversation. |
| `/mcp` | `handle_mcp_command` (`commands.py:431`) | List, add, or remove MCP servers. |

Before the session starts, `check_folder_security_agreement` (`commands.py:384`, called from
`main.py:710`) asks the user to confirm the working folder, and the CLI exits if the user declines.

### MCP server management

`/mcp` writes to the active configuration file. `get_config_file_path` (`commands.py:507`) uses
`config.toml` in the working directory when present, and `~/.openhands/config.toml` otherwise.
`add_sse_server`, `add_stdio_server`, and `add_shttp_server` (`commands.py:614-748`) prompt for the
server details and call `_add_server_to_config`, and `remove_mcp_server` (`commands.py:800`) removes
one. The MCP configuration model is described in [Model Context Protocol Integration](../integrations/mcp.md).

## The `serve` command: launching the GUI in Docker

`launch_gui_server` (`openhands/cli/gui_launcher.py:76`) starts the web application as containers.
It does the following:

1. checks that Docker is available and running (`check_docker_requirements`, `gui_launcher.py:28`);
2. creates the configuration directory (`ensure_config_dir_exists`, `gui_launcher.py:69`);
3. pulls the runtime image and the application image, both tagged with the installed package version
   (`gui_launcher.py:97-98`);
4. runs the application container with `docker run -it --rm --pull=always`, the Docker socket mounted,
   the configuration directory mounted at `/.openhands`, `SANDBOX_RUNTIME_CONTAINER_IMAGE` set to the
   runtime image, and port `3000:3000` published (`gui_launcher.py:133-200`).

Two options change the container:

- `serve --gpu` adds `--gpus all` and sets `SANDBOX_ENABLE_GPU=true`, so runtime containers can use
  GPUs (`gui_launcher.py:155-161`);
- `serve --mount-cwd` sets `SANDBOX_VOLUMES=<current directory>:/workspace:rw`, so the agent works on the
  directory where the command was run (`gui_launcher.py:169-172`).

Because the application container talks to the Docker daemon through the mounted socket, it starts
runtime containers as siblings on the host. This is why the runtime and application images must
match the installed version.

## VS Code extension

`openhands/cli/vscode_extension.py` tries to install the OpenHands companion extension when the CLI
starts inside a VS Code-like or Windsurf editor (`attempt_vscode_extension_install`,
`vscode_extension.py:58`, called from `main.py:592`). It first installs a `.vsix` bundled in the
package (`_attempt_bundled_install`, line 225), then falls back to the latest GitHub release
(`_attempt_github_install`, line 173). The marketplace path (`_attempt_marketplace_install`, line 275)
exists but its call is commented out. A flag file records a successful installation so the install
is not repeated (`_mark_installation_successful`, `vscode_extension.py:133`).

The extension source is in `openhands/integrations/vscode/`. At package build time
`build_vscode.py` (`build_vscode_extension`, line 32; `build`, line 95) compiles the extension into a
`.vsix` file and includes it in the wheel. `build.sh` runs `poetry build -v` to produce the package.

## Operational consequences

- `serve` needs a working Docker daemon and access to the Docker socket. The application container
  effectively has control of the host's Docker, so only run it on machines where that is acceptable.
- Running `openhands` without `--mount-cwd` in `serve` mode does not give the agent access to the
  current folder.
- The interactive session and `serve` share one configuration source, but `serve` passes its
  settings through environment variables in the container, which take precedence over `config.toml`.

## Extension seams

- New slash command: add a branch in `handle_commands` and a handler in `commands.py`. Add it to
  `handle_help_command` so `/help` lists it.
- New subcommand: add a parser in `get_cli_parser` and a branch in `entry.main`. If it must be fast,
  add it to `fast_help.py` as well.
- New launch target: add a function beside `launch_gui_server` and a subcommand that calls it.

## Tests

Tests for the CLI are under `tests/unit/cli/` and cover command parsing, the setup flow, and the
slash command handlers.

## Related pages

- [System Architecture Overview](../architecture/overview.md)
- [Web Frontend and Shared UI](../frontend/web-app.md)
- [Configuration System](../architecture/configuration.md)
