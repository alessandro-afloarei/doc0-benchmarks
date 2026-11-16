---
type: workflow
title: CLI and Headless Execution
description: How the openhands command-line tool starts (fast help path, subcommand parser, cli and serve subcommands), how the interactive cli session loads settings, builds the agent, runtime, memory, and controller, and handles slash commands; how the serve subcommand launches the GUI container; and how the headless python entry point in openhands/core/main.py runs one task to completion from a command line.
tags: [cli, headless, terminal, tui, slash-commands, serve, gui-launcher, run-controller, argparse, task-execution]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-3f73c64de691a0172828acb1
    resource: repo://openhands/cli/commands.py
  - id: openwiki-source-ab3c6807c36a554faa63f162
    resource: repo://openhands/cli/entry.py
  - id: openwiki-source-33bda7da9a7aaa1b62b92f7d
    resource: repo://openhands/cli/gui_launcher.py
  - id: openwiki-source-2560404802cbc340c233d2ec
    resource: repo://openhands/cli/main.py
  - id: openwiki-source-d3f14b919d4ae24afe8df275
    resource: repo://openhands/core/main.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# CLI and Headless Execution

<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
OpenHands has two command-line ways to run an agent without the web application. The interactive **`openhands` CLI** (`openhands/cli/`) gives a terminal session with slash commands and streamed output. The **headless runner** in `openhands/core/main.py` runs one task to completion from a shell and exits. Both build the same backend components described in [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md), but they assemble them differently, and the difference matters when a change touches one path.

## Entry point and fast path

The console script `openhands` is declared in `pyproject.toml` as `openhands.cli.entry:main`. `openhands/cli/entry.py` is written to start quickly:

1. `handle_fast_commands()` runs before anything heavy is imported. It answers help and version requests (`openhands/cli/fast_help.py`) and exits.
2. The configuration parser is imported only after that, by `get_cli_parser()` from `openhands/core/config/arg_utils.py`.
3. If no subcommand is given, or the first argument is not `cli` or `serve`, the entry point inserts `cli` as the subcommand, so `openhands` alone means `openhands cli`.
4. The `--version` flag prints the package version and exits.
5. The subcommand selects the path: `serve` calls `launch_gui_server`, and `cli` (or no subcommand) calls `run_cli_command` in `openhands/cli/main.py`.

The parser's options include the task and its source (`-t`/`--task`, `-f`/`--file`), the LLM choice (`-l`/`--llm-config`), the agent (`--agent-cls`), iteration and budget limits (`--max-iterations`, `--max-budget-per-task`), the config file (`-c`/`--config-file`), the working directory (`-d`/`--directory`), a session name (`-n`/`--name`), `--no-auto-continue`, `--mount-cwd`, and `--gpu`.

## The interactive `cli` path

`run_cli_command` (`openhands/cli/main.py` ~L758) creates an asyncio event loop and runs `main_with_loop` (~L565). On exit it cancels pending tasks and closes the loop. A `KeyboardInterrupt` is reported as an interrupted session, and a `ConnectionRefusedError` exits with status 1.

`main_with_loop` does the following:

<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
1. Calls `setup_config_from_args(args)` (`openhands/core/config/utils.py`, see [Configuration Model](/openwiki/architecture/configuration.md)) to build the `OpenHandsConfig`. Command-line overrides take precedence over `config.toml`, and the environment overrides `config.toml`.
2. Reads the user's CLI settings from `~/.openhands/settings.json` and `~/.openhands/config.toml`. The CLI applies these as the lowest-precedence LLM choice. When no settings exist, `run_setup_flow` (~L446) or `run_alias_setup_flow` (~L476) prompts the user for them.
3. Runs the folder security check (`check_folder_security_agreement` in `commands.py`, called from ~L710), which asks the user to agree before the current folder is used.
4. Creates the components through the same factories the server uses: `create_agent` (with the LLM registry), `create_runtime` with `headless_mode=True`, `create_memory`, and `create_controller` (~L162-L177). The CLI therefore runs a real runtime (Docker or local, per configuration) rather than a stub.
5. Runs `run_session` (~L125), which streams events to the terminal through the TUI helpers and waits for user input.

The CLI does not call `run_controller`. It owns its own event loop and display, so changes to `run_controller` do not automatically change the CLI.

### Slash commands

`handle_commands` (`openhands/cli/commands.py` ~L122-L175) dispatches the input lines that start with `/`:

- `/exit` ends the session (`handle_exit_command`).
- `/help` prints the command list (`handle_help_command`).
- `/init` initializes a repository in the current folder for the agent (`handle_init_command`, which calls `init_repository`).
- `/status` shows usage metrics for the session (`handle_status_command`).
- `/new` starts a new conversation (`handle_new_command`).
- `/settings` shows or edits settings (`handle_settings_command`).
- `/resume` resumes an earlier conversation (`handle_resume_command`).
- `/mcp` lists configured MCP servers and their errors (`handle_mcp_command`, `display_mcp_servers`).

<!-- openwiki: broken internal link [/openwiki/architecture/security-analysis.md] link "/openwiki/architecture/security-analysis.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Other input goes to the agent as a user message. When the agent asks for confirmation for a high-risk action, the CLI answers with a `ChangeAgentStateAction` carrying `USER_CONFIRMED` or `USER_REJECTED` (`openhands/cli/main.py` ~L250-L280), as described in [Security Analysis and Action Gating](/openwiki/architecture/security-analysis.md).

### Display

`openhands/cli/tui.py` renders events for the terminal. `display_event` (~L260) chooses a renderer by event type, and separate helpers print thoughts (`display_thought_if_new`), messages (`display_message`, which renders basic markdown), command runs and their output (`display_command`, `display_command_output`), file edits (`display_file_edit`), and errors (`display_error`). `UsageMetrics` (~L95) holds the counters that `/status` shows. Prompt-toolkit styling is in `openhands/cli/pt_style.py`.

## The `serve` path (GUI container)

`openhands serve` calls `launch_gui_server` in `openhands/cli/gui_launcher.py` (~L76). The launcher:

1. Checks that Docker is available and usable (`check_docker_requirements`, ~L28).
2. Makes sure the configuration directory exists (`ensure_config_dir_exists`, ~L69).
3. Pulls the matching application and runtime images for the installed version, from `docker.all-hands.dev/all-hands-ai/openhands:<version>` and `.../runtime:<version>-nikolaik`.
4. Runs the application container with `docker run --pull=always` and tells the user the server is available at `http://localhost:3000`. The `mount_cwd` option mounts the current directory, and `gpu` passes GPUs through.

This is the path a user takes to run the web interface locally without the source tree.

## The headless runner

The headless runner is the `__main__` block of `openhands/core/main.py`. It is how a single task runs from a script or a shell without any terminal UI:

1. `parse_arguments()` reads the same options as the CLI parser. `setup_config_from_args` builds the configuration.
2. `read_task` takes the task from `-f` (a file), `-t` (a string), or standard input. Without a task and without trajectory replay, it raises `No task provided`.
3. The task becomes a `MessageAction` in the user's name. If `replay_trajectory_path` is set, the run replays a saved trajectory and takes no new task.
4. `generate_sid` creates a session ID, optionally from `--name`.
5. `run_controller` runs the task (~L312). `--no-auto-continue` disables the automatic continuation that `auto_continue_response` provides when the agent asks for input.

<!-- openwiki: broken internal link [/openwiki/workflows/issue-resolver.md] link "/openwiki/workflows/issue-resolver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/evaluation/benchmarks.md] link "/openwiki/evaluation/benchmarks.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`run_controller` itself (~L51) is the reusable function. It creates the agent, runtime, memory, and controller, connects the runtime (and clones the selected repository through `initialize_repository_for_runtime`), adds the initial action, and runs until a terminal agent state (finished, rejected, error, paused, or stopped). The issue resolver ([Issue Resolver Workflow](/openwiki/workflows/issue-resolver.md)) and the evaluation harness ([Evaluation Harness and Benchmarks](/openwiki/evaluation/benchmarks.md)) call it.

## Invariants and failure behavior

- The fast path never imports the agent, so `openhands --help` and `openhands --version` stay quick and do not need an LLM configured.
- The interactive CLI creates its runtime with `headless_mode=True`, and the runtime base class installs the VS Code plugin only when not in headless mode.
- `run_controller` ends the run in a terminal state. Its caller decides what to do with the outcome, for example printing a patch or recording metrics.
- A missing task in headless mode fails before any runtime starts.

## Extension seams

- A new CLI slash command is a branch in `handle_commands` plus a handler in `commands.py`.
- A new display for an event type is a branch in `tui.display_event`.
- A new headless option is added to the parser in `arg_utils.py`, and read in `setup_config_from_args` or the headless block of `core/main.py`.

## Representative tests

- `tests/unit/cli/` (17 test files) covers the parser, commands, the TUI helpers, and the entry point.
- `tests/unit/core/` covers configuration parsing and `run_controller` helpers.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [System Architecture Overview](/openwiki/architecture/overview.md)
<!-- openwiki: broken internal link [/openwiki/workflows/conversation-lifecycle.md] link "/openwiki/workflows/conversation-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Conversation Lifecycle, End to End](/openwiki/workflows/conversation-lifecycle.md)
<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Configuration Model](/openwiki/architecture/configuration.md)
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)
