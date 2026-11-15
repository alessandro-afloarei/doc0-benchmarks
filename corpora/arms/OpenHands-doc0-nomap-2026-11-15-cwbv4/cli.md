---
title: "CLI"
---
## Overview

The `openhands` command is an interactive terminal client. Run in a project folder, it starts an agent that works directly on that folder, shows each command, edit and message as it happens, asks before running anything risky, and accepts slash commands for settings, MCP servers and session control. The same command with `serve` starts the full web application in Docker instead.

Sources: [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48), [openhands/cli/tui.py:79-88](repo://openhands/cli/tui.py#L79-L88)

Underneath, the CLI uses the same setup functions as [[Headless Mode]], with the `cli` runtime from [[Runtime Implementations]] and a prompt-toolkit interface on top.

Sources: [openhands/cli/main.py:125-170](repo://openhands/cli/main.py#L125-L170)

## Entry point

### Fast paths

`openhands.cli.entry:main` first handles `--help`/`-h` and `--version`/`-v` with a lightweight parser, printing the top-level and `cli` help without importing the agent stack, so these return immediately. Otherwise it builds the full parser, inserts `cli` when the first argument is not a known command, and dispatches: `serve` to `launch_gui_server`, `cli` to `run_cli_command`.

Sources: [openhands/cli/fast_help.py:143-172](repo://openhands/cli/fast_help.py#L143-L172), [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48)

### serve

`launch_gui_server` checks that Docker is available, pulls the runtime image for the installed version, and runs the `docker.all-hands.dev/all-hands-ai/openhands:<version>` app image with the Docker socket and `~/.openhands` mounted, port 3000 published, and the runtime image passed as `SANDBOX_RUNTIME_CONTAINER_IMAGE`. `--gpu` adds `--gpus all`; `--mount-cwd` mounts the current folder as the workspace.

Sources: [openhands/cli/gui_launcher.py:76-170](repo://openhands/cli/gui_launcher.py#L76-L170)

## Starting a session

### Configuration for the CLI

`main_with_loop` falls back to `~/.openhands/config.toml` when the given config file does not exist and loads the config with `setup_config_from_args`. It then tries to install the bundled VS Code extension (see [[VS Code Integration]]) and loads the settings file; with no settings it runs the setup flow, which asks for provider, model and API key and optionally a search API key.

Sources: [openhands/cli/main.py:565-612](repo://openhands/cli/main.py#L565-L612), [openhands/cli/main.py:446-474](repo://openhands/cli/main.py#L446-L474), [openhands/cli/settings.py:233-250](repo://openhands/cli/settings.py#L233-L250)

Stored settings provide the agent class, the LLM model, key and base URL when the config does not set them, the search key, and the condenser: an LLM summarizing condenser when the default condenser is enabled, none otherwise.

Sources: [openhands/cli/main.py:612-662](repo://openhands/cli/main.py#L612-L662)

Unless `--override-cli-mode` is given, the CLI then forces its own defaults: `runtime = "cli"`, the workspace is the current directory, confirmation mode on with the `llm` security analyzer, and `cli_mode` on the agent config, which changes the system prompt and makes the controller hold every risky-type action for the CLI to decide (see [[Security Analyzers and Confirmation Mode]]).

Sources: [openhands/cli/main.py:665-685](repo://openhands/cli/main.py#L665-L685), [openhands/controller/agent_controller.py:938-947](repo://openhands/controller/agent_controller.py#L938-L947)

### Trust and aliases

Before working in a folder for the first time, the CLI asks whether the user trusts it and remembers trusted folders in `~/.openhands/config.toml` (falling back to `sandbox.trusted_dirs`). On an interactive terminal it also offers once to add `openhands` and `oh` aliases to the shell profile.

Sources: [openhands/cli/commands.py:384-429](repo://openhands/cli/commands.py#L384-L429), [openhands/cli/main.py:690-712](repo://openhands/cli/main.py#L690-L712), [openhands/cli/shell_config.py:264-297](repo://openhands/cli/shell_config.py#L264-L297)

### The first task

The task comes from `-t`, piped standard input, or `-f`: a file given with `-f` becomes a message asking the agent to read the file and then ask what to do with it. `--conversation` resumes an earlier conversation by id. Sessions repeat while the user asks for `/new`.

Sources: [openhands/cli/main.py:715-755](repo://openhands/cli/main.py#L715-L755)

## run_session

### Building the conversation

`run_session` shows an initialisation animation while it creates the LLM registry, the agent, the runtime and the controller, subscribes the shell output stream to the console so long commands print live, connects the runtime, clones a selected repository if any, creates memory with the current directory as working directory, and attaches MCP tools while collecting connection errors for `/mcp`.

Sources: [openhands/cli/main.py:125-170](repo://openhands/cli/main.py#L125-L170), [openhands/cli/main.py:312-360](repo://openhands/cli/main.py#L312-L360)

When a saved state exists for the session, the welcome message says the conversation is being loaded; if the last run ended with an error, the agent is asked to get back on track without resuming blindly, and an LLM authentication error shows a hint about the API key instead. The session then runs `run_agent_until_done` until the agent is `STOPPED` or in `ERROR`.

Sources: [openhands/cli/main.py:362-445](repo://openhands/cli/main.py#L362-L445)

### Reacting to agent states

The CLI subscribes to the event stream as `main`. Every event is rendered and counted into usage metrics; agent state changes drive the interaction:

Sources: [openhands/cli/main.py:214-222](repo://openhands/cli/main.py#L214-L222)

| State | CLI behaviour |
| --- | --- |
| `RUNNING` | shows that the agent is working and listens for Ctrl-P, Ctrl-C or Ctrl-D to pause it |
| `AWAITING_USER_INPUT`, `FINISHED` | reloads microagents if `/init` created some, then prompts for the next message |
| `AWAITING_USER_CONFIRMATION` | asks to confirm the pending action, unless an auto-confirm mode applies |
| `PAUSED` | prompts for the next message or `/resume` |

Sources: [openhands/cli/main.py:214-310](repo://openhands/cli/main.py#L214-L310), [openhands/cli/tui.py:872-918](repo://openhands/cli/tui.py#L872-L918)

### Confirmation

The confirmation prompt is styled by the pending action's `security_risk`; a `HIGH` risk action is shown in red with a warning. The answers are yes, no, "auto-confirm LOW/MEDIUM, ask for HIGH", and "always", and the last two switch the session into a mode that confirms automatically from then on. Rejecting sends `USER_REJECTED` and asks the user what to do instead.

Sources: [openhands/cli/main.py:250-305](repo://openhands/cli/main.py#L250-L305), [openhands/cli/tui.py:839-870](repo://openhands/cli/tui.py#L839-L870)

## Rendering

`display_event` prints each event type in its own style: agent messages and thoughts as basic Markdown, commands and their output in frames, file edits as diffs, file reads, MCP calls and results, task lists, and errors. While a command runs, its output streams into a live area. `/status` and the shutdown message show the session id, duration, and accumulated cost and token usage.

Sources: [openhands/cli/tui.py:242-310](repo://openhands/cli/tui.py#L242-L310), [openhands/cli/tui.py:384-460](repo://openhands/cli/tui.py#L384-L460), [openhands/cli/tui.py:589-618](repo://openhands/cli/tui.py#L589-L618), [openhands/cli/tui.py:664-746](repo://openhands/cli/tui.py#L664-L746), [openhands/cli/utils.py:51-78](repo://openhands/cli/utils.py#L51-L78)

## Slash commands

`handle_commands` treats any input that is not a known command as a message to the agent.

Sources: [openhands/cli/commands.py:122-174](repo://openhands/cli/commands.py#L122-L174)

| Command | Effect |
| --- | --- |
| `/exit` | after confirmation, stops the agent and shows usage |
| `/help` | lists the commands |
| `/init` | (CLI and local runtimes) asks the agent to explore the repository and write `.openhands/microagents/repo.md`, then reloads microagents |
| `/status` | shows conversation id and usage metrics |
| `/new` | after confirmation, stops this session and starts a new one |
| `/settings` | shows settings and edits LLM (basic or advanced) or search API settings |
| `/resume` | when paused, sends `continue` to the agent |
| `/mcp` | lists, adds (SSE, stdio or SHTTP) or removes MCP servers in `~/.openhands/config.toml`, or shows connection errors |

Sources: [openhands/cli/commands.py:176-266](repo://openhands/cli/commands.py#L176-L266), [openhands/cli/commands.py:269-323](repo://openhands/cli/commands.py#L269-L323), [openhands/cli/commands.py:431-505](repo://openhands/cli/commands.py#L431-L505), [openhands/cli/commands.py:586-620](repo://openhands/cli/commands.py#L586-L620)

Changes to MCP servers are written to the config file and take effect after a restart, which the CLI offers to perform.

Sources: [openhands/cli/commands.py:76-120](repo://openhands/cli/commands.py#L76-L120), [openhands/cli/commands.py:507-584](repo://openhands/cli/commands.py#L507-L584)

## Shutting down

`run_cli_command` runs everything on a fresh event loop, reports a keyboard interrupt as an interrupted session, and on exit cancels and awaits all pending tasks before closing the loop.

Sources: [openhands/cli/main.py:758-781](repo://openhands/cli/main.py#L758-L781)
