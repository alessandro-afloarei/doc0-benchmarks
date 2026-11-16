---
title: "Command-Line Interface"
---
## Overview

The `openhands` command is OpenHands' terminal app. `openhands` (or `openhands cli`) starts an interactive conversation in the current directory, working directly on your files; `openhands serve` starts the web GUI in Docker instead. The terminal app runs the same agent loop as the headless runner in [[Quickstart]], with a prompt-toolkit interface around it for typing tasks, confirming actions, pausing the agent and changing settings.

Sources: [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48), [openhands/core/config/arg_utils.py:145-208](repo://openhands/core/config/arg_utils.py#L145-L208)

The code lives in `openhands/cli`: `entry.py` dispatches subcommands, `main.py` sets up and runs sessions, `tui.py` draws output and reads input, `commands.py` handles slash commands, `settings.py` holds the settings dialogs, and `gui_launcher.py` and `vscode_extension.py` cover `serve` and the editor extension.

Sources: [openhands/cli/main.py:125-170](repo://openhands/cli/main.py#L125-L170), [openhands/cli/tui.py:79-88](repo://openhands/cli/tui.py#L79-L88)

## Entry point and fast help

`entry.main` answers `--help` and `--version` before importing the rest of OpenHands. `fast_help.py` builds a lightweight copy of the parser for this; its docstring says `openhands --help` used to take about 20 seconds because it loaded the whole codebase. Otherwise the full parser is loaded, a missing subcommand is treated as `cli`, and `serve` or `cli` is dispatched.

Sources: [openhands/cli/fast_help.py:1-30](repo://openhands/cli/fast_help.py#L1-L30), [openhands/cli/fast_help.py:143-172](repo://openhands/cli/fast_help.py#L143-L172), [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48)

`cli` accepts the common flags (`-t`, `-f`, `-n`, `--config-file`, `-l`, `--agent-config`), plus `--conversation <id>` to continue an earlier conversation and `--override-cli-mode` to keep the configured runtime instead of the CLI defaults below.

Sources: [openhands/core/config/arg_utils.py:15-64](repo://openhands/core/config/arg_utils.py#L15-L64), [openhands/core/config/arg_utils.py:189-208](repo://openhands/core/config/arg_utils.py#L189-L208)

## Starting a CLI session

`main_with_loop` prepares the session before the agent starts:

Sources: [openhands/cli/main.py:565-600](repo://openhands/cli/main.py#L565-L600)

1. Offers to install the VS Code (or Windsurf) companion extension when run inside one of those editors.
2. Loads `~/.openhands/settings.json`; with no settings it runs the setup flow, which asks for the LLM provider, model and key and optionally a search API key.
3. Applies the saved agent, LLM, confirmation mode and search key, with `config.toml` and command-line flags taking precedence.
4. Unless `--override-cli-mode` is set, switches to CLI defaults: the `cli` runtime, the current directory as workspace, confirmation mode on with the `llm` analyzer, and `cli_mode` on the agent.
5. Offers once to add `openhands` and `oh` shell aliases.
6. Asks you to trust the directory unless it is already in your trusted directories.
7. Reads the initial task from `-t`, `-f` or input, then runs sessions until you exit.

Sources: [openhands/cli/main.py:592-660](repo://openhands/cli/main.py#L592-L660), [openhands/cli/main.py:661-757](repo://openhands/cli/main.py#L661-L757), [openhands/cli/main.py:446-475](repo://openhands/cli/main.py#L446-L475)

The CLI defaults mean the agent works on your real files through the [[Runtime Implementations]] `CLIRuntime`, without a sandbox, which is why confirmation is on by default and the directory has to be trusted first. `check_folder_security_agreement` reads trusted directories from the local CLI config, falling back to `sandbox.trusted_dirs`, and, if you agree, adds the directory to the local config's trusted list.

Sources: [openhands/cli/main.py:663-712](repo://openhands/cli/main.py#L663-L712), [openhands/cli/commands.py:384-430](repo://openhands/cli/commands.py#L384-L430)

## The session loop

`run_session` builds the same parts as `run_controller`: an LLM registry, an agent, a runtime (connected while an animation runs), a controller restored from the session if `--conversation` was given, and a memory with the repository's microagents. It adds MCP tools, streams the CLI runtime's shell output straight to the console, prints a banner and welcome message, and runs `run_agent_until_done`.

Sources: [openhands/cli/main.py:125-183](repo://openhands/cli/main.py#L125-L183), [openhands/cli/main.py:312-360](repo://openhands/cli/main.py#L312-L360), [openhands/cli/main.py:360-443](repo://openhands/cli/main.py#L360-L443)

The session's `on_event` callback, subscribed as the `main` subscriber, drives the conversation. Every event is printed with `display_event`. When the agent finishes or waits for input, the prompt comes back and whatever you type goes to the slash-command handler or becomes the next message. While the agent runs, a key listener watches for Ctrl-P (or Ctrl-C and Ctrl-D) and pauses the agent with `ChangeAgentStateAction(PAUSED)`.

Sources: [openhands/cli/main.py:185-243](repo://openhands/cli/main.py#L185-L243), [openhands/cli/main.py:300-310](repo://openhands/cli/main.py#L300-L310), [openhands/cli/tui.py:745-760](repo://openhands/cli/tui.py#L745-L760), [openhands/cli/tui.py:872-912](repo://openhands/cli/tui.py#L872-L912)

## Confirming actions

Because the CLI sets `cli_mode`, the controller holds every command, code, edit, read and browse action for confirmation, and the terminal decides what to ask, as [[Security Analyzers and Confirmation Mode]] explains. When the agent enters `AWAITING_USER_CONFIRMATION`, the CLI shows the pending action's risk and asks:

Sources: [openhands/cli/main.py:244-276](repo://openhands/cli/main.py#L244-L276)

| Answer | Effect |
| --- | --- |
| yes | Confirm this action |
| no, or other instructions | Reject it; the agent waits for what to do instead |
| always | Confirm this and every later action in the session |
| auto high-risk | From now on confirm `LOW` and `MEDIUM` actions automatically and only ask about `HIGH` ones |

Sources: [openhands/cli/main.py:244-300](repo://openhands/cli/main.py#L244-L300), [openhands/controller/agent_controller.py:940-950](repo://openhands/controller/agent_controller.py#L940-L950)

The answer is sent as `ChangeAgentStateAction(USER_CONFIRMED)` or `USER_REJECTED`. A confirmation request that arrives while the agent is paused is skipped and asked again after resuming.

Sources: [openhands/cli/main.py:244-300](repo://openhands/cli/main.py#L244-L300)

## Slash commands

| Command | What it does |
| --- | --- |
| `/exit` | Exit, after confirming |
| `/help` | List commands |
| `/init` | Ask the agent to explore the repository and write `.openhands/microagents/repo.md`, then reload microagents |
| `/status` | Show conversation id and usage metrics: cost and tokens |
| `/new` | Start a new conversation |
| `/settings` | Show and change settings |
| `/resume` | Resume a paused agent |
| `/mcp` | List MCP servers, add or remove them in `config.toml`, view connection errors |

Sources: [openhands/cli/tui.py:79-88](repo://openhands/cli/tui.py#L79-L88), [openhands/cli/commands.py:122-175](repo://openhands/cli/commands.py#L122-L175), [openhands/cli/commands.py:204-234](repo://openhands/cli/commands.py#L204-L234), [openhands/cli/commands.py:431-505](repo://openhands/cli/commands.py#L431-L505)

`/mcp` edits the MCP section of the config file with prompts for SSE, stdio and streamable HTTP servers, and since configuration is loaded at start, offers to restart the CLI afterwards. The server types are described in [[MCP Integration]].

Sources: [openhands/cli/commands.py:507-620](repo://openhands/cli/commands.py#L507-L620), [openhands/cli/commands.py:76-120](repo://openhands/cli/commands.py#L76-L120)

## Settings

`/settings` shows the current settings and offers basic and advanced LLM dialogs and search API settings. The basic dialog picks a provider and model from lists with validation; the advanced one takes a custom model, base URL, API key, agent, confirmation mode and condenser. Saved settings go to the same `FileSettingsStore` the web server uses, described in [[Storage]], so the CLI and GUI share them.

Sources: [openhands/cli/settings.py:41-122](repo://openhands/cli/settings.py#L41-L122), [openhands/cli/settings.py:233-300](repo://openhands/cli/settings.py#L233-L300), [openhands/cli/settings.py:489-610](repo://openhands/cli/settings.py#L489-L610), [openhands/cli/commands.py:269-295](repo://openhands/cli/commands.py#L269-L295)

## Launching the GUI

`openhands serve` checks that Docker is installed and running, pulls the runtime image for the installed version, and runs the `openhands` app image as the `openhands-app` container on port 3000 with the Docker socket and `~/.openhands` mounted, as [[Quickstart]] shows for the manual Docker command. `--mount-cwd` mounts the current directory as `/workspace` through `SANDBOX_VOLUMES`, and `--gpu` adds `--gpus all`.

Sources: [openhands/cli/gui_launcher.py:28-130](repo://openhands/cli/gui_launcher.py#L28-L130), [openhands/cli/gui_launcher.py:131-219](repo://openhands/cli/gui_launcher.py#L131-L219)

## Editor extension

`attempt_vscode_extension_install` runs when the terminal is inside VS Code (`TERM_PROGRAM=vscode`) or Windsurf. It skips if a flag file in `~/.openhands` says it already succeeded or if the extension is already installed, and otherwise installs the bundled `.vsix` with the editor's command-line tool, falling back to downloading the latest `.vsix` from GitHub releases.

Sources: [openhands/cli/vscode_extension.py:13-120](repo://openhands/cli/vscode_extension.py#L13-L120)
