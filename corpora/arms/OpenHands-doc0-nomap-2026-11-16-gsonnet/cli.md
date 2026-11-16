---
title: "Command-Line Interface"
---
## Overview

The `openhands` command is a terminal front end to the same components the web server uses. It has two subcommands: `cli` (the default) runs an interactive session in the terminal on the local machine, and `serve` starts the web app in Docker. The terminal session builds its own registry, agent, runtime, controller and memory, subscribes to the event stream, and turns agent state changes into prompts. The shared pieces are described on their own pages; this page covers what the CLI decides differently.

Sources: [openhands/cli/entry.py:11-47](repo://openhands/cli/entry.py#L11-L47), [openhands/cli/main.py:125-183](repo://openhands/cli/main.py#L125-L183)

## Entry and fast paths

`entry.main` first calls `handle_fast_commands`, which answers `--help` and `--version` with a small hand-written parser, because importing the full codebase took about 20 seconds according to the module's docstring. Only then does it import the real parser. If the first argument is not `cli` or `serve`, it inserts `cli`, so plain `openhands` and `openhands -t "task"` both start a terminal session. `serve` goes to `launch_gui_server`, and everything else goes to `run_cli_command`.

Sources: [openhands/cli/entry.py:11-47](repo://openhands/cli/entry.py#L11-L47), [openhands/cli/fast_help.py:1-60](repo://openhands/cli/fast_help.py#L1-L60)

`run_cli_command` creates an event loop, runs `main_with_loop`, reports a `KeyboardInterrupt` as an interrupted session, and on the way out cancels all remaining tasks.

Sources: [openhands/cli/main.py:758-781](repo://openhands/cli/main.py#L758-L781)

## Preparing the configuration

`main_with_loop` prepares the configuration before any session starts, in these steps.

Sources: [openhands/cli/main.py:565-575](repo://openhands/cli/main.py#L565-L575)

1. If `config.toml` is not in the current directory, it falls back to `~/.openhands/config.toml`. Logging defaults to WARNING unless `--log-level` or `LOG_LEVEL` is set.
2. It loads settings from `FileSettingsStore`. If none exist, it runs a first-time setup flow.
3. It applies the settings: the agent, the LLM model and key (only if neither `-l` nor `config.toml` provided them, which gives `-l` the highest and `settings.json` the lowest precedence), the confirmation mode, the search key and the condenser (an LLM summarising condenser when `enable_default_condenser` is on, otherwise a no-op).
4. Unless `--override-cli-mode` is set, it forces CLI defaults: `runtime = 'cli'`, `workspace_base` is the current directory, confirmation mode on, the `llm` security analyzer, and `cli_mode = True` on the agent config. It then calls `finalize_config` again so that Jupyter and browsing are disabled for the CLI runtime.
5. It offers to install shell aliases if they are missing and the terminal is interactive, and asks the user to confirm that the working folder is trusted.
6. A task from `-f` is wrapped in a prompt telling the agent to read the file and ask what to do with it; a task from `-t` or stdin is used as is.

Sources: [openhands/cli/main.py:565-593](repo://openhands/cli/main.py#L565-L593), [openhands/cli/main.py:594-662](repo://openhands/cli/main.py#L594-L662), [openhands/cli/main.py:663-683](repo://openhands/cli/main.py#L663-L683), [openhands/cli/main.py:685-731](repo://openhands/cli/main.py#L685-L731)

Because `runtime = 'cli'`, commands run directly in the user's workspace with no sandbox; see [[Runtime Implementations and Sandbox Image]]. The `llm` analyzer and `cli_mode` make the controller mark every confirmable action as awaiting confirmation, and the CLI decides from the action's risk; see [[Security Analyzers and Confirmation Mode]]. See [[Configuration System]] for the layers.

Sources: [openhands/cli/main.py:671-683](repo://openhands/cli/main.py#L671-L683), [openhands/controller/agent_controller.py:935-949](repo://openhands/controller/agent_controller.py#L935-L949)

## Running a session

`run_session` builds the same objects as the headless runner. It creates the registry and stats, the agent and the runtime (`headless_mode=True`, so no VS Code), subscribes the runtime's shell stream to the terminal, creates the controller, and subscribes its own callback under `EventStreamSubscriber.MAIN`. It then connects the runtime, clones the repository if one is selected, creates `Memory` with the current directory as working directory, and adds MCP tools while collecting any errors for the `/mcp` command. A session id is `--conversation` if given, otherwise generated from `--name`.

Sources: [openhands/cli/main.py:125-183](repo://openhands/cli/main.py#L125-L183), [openhands/cli/main.py:312-353](repo://openhands/cli/main.py#L312-L353)

If a saved state exists for the session id, the session resumes it: a state that ended in an authentication error prints a message about the API key, a state that ended in another error starts with a note telling the agent not to resume its task, and a clean state shows "Loading previous conversation". Otherwise, if there is a task it is added as the first user `MessageAction`, and if not the user is prompted for one. `run_agent_until_done` then waits until the state is `STOPPED` or `ERROR`, because the CLI keeps running after `FINISHED` to accept a new task. `cleanup_session` saves the state and closes the controller and runtime.

Sources: [openhands/cli/main.py:391-443](repo://openhands/cli/main.py#L391-L443), [openhands/cli/main.py:91-123](repo://openhands/cli/main.py#L91-L123), [openhands/core/loop.py:11-45](repo://openhands/core/loop.py#L11-L45)

## State-driven prompts

The event callback `on_event_async` renders every event and updates usage metrics, then acts on `AgentStateChangedObservation`.

Sources: [openhands/cli/main.py:214-228](repo://openhands/cli/main.py#L214-L228)

| Agent state | What the CLI does |
| --- | --- |
| `AWAITING_USER_INPUT`, `FINISHED` | Reloads microagents if `/init` created one, then prompts for the next message or command |
| `AWAITING_USER_CONFIRMATION` | Confirms automatically in "always" mode, or for non-high risk in "auto high-risk" mode, otherwise asks the user |
| `PAUSED` | Prompts for input |
| `RUNNING` | Shows the running message and starts a key listener that pauses the agent |
| anything but `RUNNING` or `PAUSED` | Stops the pause listener |

Sources: [openhands/cli/main.py:214-310](repo://openhands/cli/main.py#L214-L310)

The confirmation prompt shows the action's risk. A "yes" sends `ChangeAgentStateAction(USER_CONFIRMED)`; "no" sends `USER_REJECTED` and tells the user to say what to do instead. The choices "always" and "auto high-risk" set a flag so later confirmations in the session are automatic.

Sources: [openhands/cli/main.py:245-299](repo://openhands/cli/main.py#L245-L299)

## Slash commands

Input is passed to `handle_commands`. A line starting with one of the commands below is handled locally, and any other text is sent to the agent as a user `MessageAction`.

Sources: [openhands/cli/commands.py:122-173](repo://openhands/cli/commands.py#L122-L173)

| Command | Effect |
| --- | --- |
| `/exit` | After confirmation, sends `STOPPED` and prints usage |
| `/help` | Lists the commands |
| `/init` | For the local and CLI runtimes only: asks the agent to explore the repository and write `.openhands/microagents/repo.md`, then reloads microagents |
| `/status` | Shows session id and usage metrics |
| `/new` | After confirming that history will be lost, ends the session and starts a new one |
| `/settings` | Shows settings and lets the user change the LLM (basic or advanced) and the search API |
| `/resume` | Only when paused: sends the message `continue`, a workaround noted in the code for a resume problem |
| `/mcp` | Lists, adds and removes MCP servers and shows MCP errors |

Sources: [openhands/cli/commands.py:122-173](repo://openhands/cli/commands.py#L122-L173), [openhands/cli/commands.py:176-250](repo://openhands/cli/commands.py#L176-L250), [openhands/cli/commands.py:250-325](repo://openhands/cli/commands.py#L250-L325), [openhands/cli/commands.py:431-460](repo://openhands/cli/commands.py#L431-L460)

The `/mcp` command writes new servers to the config file. See [[MCP Integration]] for what happens to them. See [[Microagents and Knowledge Recall]] for `/init`.

Sources: [openhands/cli/commands.py:507-612](repo://openhands/cli/commands.py#L507-L612)

## Serving the web app

`launch_gui_server` checks that Docker is installed and running, pulls the runtime and app images for the installed version, and runs the app container with the Docker socket and `~/.openhands` mounted, port 3000 published and `SANDBOX_RUNTIME_CONTAINER_IMAGE` set. `--mount-cwd` adds `SANDBOX_VOLUMES=<cwd>:/workspace:rw` and the user id, and `--gpu` turns on GPU access. See [[Web Server and Socket.IO Protocol]].

Sources: [openhands/cli/gui_launcher.py:28-60](repo://openhands/cli/gui_launcher.py#L28-L60), [openhands/cli/gui_launcher.py:95-205](repo://openhands/cli/gui_launcher.py#L95-L205)
