---
title: "CLI and Headless Runs"
---
## Overview

OpenHands has two terminal execution paths. The packaged `openhands` entry point launches an interactive session by default, while `python -m openhands.core.main` runs a task through the headless controller wrapper. Both assemble agents, runtimes and event subscriptions, but their input policies and terminal-state choices differ. [[Quickstart]] covers installing the development environment; [[Agent Control Loop]] covers the shared execution machinery.

Sources: [openhands/cli/entry.py:12-45](repo://openhands/cli/entry.py#L12-L45), [openhands/cli/main.py:125-179](repo://openhands/cli/main.py#L125-L179), [openhands/cli/main.py:432-443](repo://openhands/cli/main.py#L432-L443), [openhands/core/main.py:193-216](repo://openhands/core/main.py#L193-L216), [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320)

## Choose an entry point

The entry point handles help and version through a fast path before importing the main implementation. It inserts `cli` when no recognized subcommand is present. Explicit `serve` dispatches to the GUI launcher, forwarding the current-directory mount and GPU flags. Explicit `cli` dispatches to `run_cli_command`, which creates and owns an asyncio event loop.

Sources: [openhands/cli/entry.py:12-45](repo://openhands/cli/entry.py#L12-L45), [openhands/cli/main.py:758-778](repo://openhands/cli/main.py#L758-L778)

With a prepared Python environment and configured model, these commands illustrate the interactive and scripted paths. The headless iteration limit is a controller limit, not a shell-command count; a task can contain several action types and model decisions.

Sources: [openhands/core/config/arg_utils.py:23-29](repo://openhands/core/config/arg_utils.py#L23-L29), [openhands/core/config/arg_utils.py:110-123](repo://openhands/core/config/arg_utils.py#L110-L123), [openhands/core/setup.py:230-241](repo://openhands/core/setup.py#L230-L241)

```bash
poetry run openhands cli -t "Explain this repository's main entry points"
poetry run python -m openhands.core.main -t "Explain this repository's main entry points" -i 20
```

Sources: [openhands/cli/entry.py:36-45](repo://openhands/cli/entry.py#L36-L45), [openhands/core/config/arg_utils.py:23-29](repo://openhands/core/config/arg_utils.py#L23-L29), [openhands/core/config/arg_utils.py:117-123](repo://openhands/core/config/arg_utils.py#L117-L123), [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320)

## Interactive configuration and input

Interactive startup falls back to `~/.openhands/config.toml` if the requested configuration file does not exist. It loads configuration, then saved settings, entering a setup flow when no settings exist. Saved LLM settings are applied only when no named LLM configuration was selected and the current model or API key is missing. [[Configuration]] describes the underlying application configuration loader.

Sources: [openhands/cli/main.py:578-637](repo://openhands/cli/main.py#L578-L637)

Unless CLI defaults are explicitly overridden, startup selects the `cli` runtime, uses the current directory when workspace base is empty, enables confirmation with the LLM security analyzer, and marks the agent as being in CLI mode. It then finalizes configuration again. Startup also checks the workspace agreement before opening a session. These choices affect where actions execute and when the terminal asks for confirmation.

Sources: [openhands/cli/main.py:663-683](repo://openhands/cli/main.py#L663-L683), [openhands/cli/main.py:704-712](repo://openhands/cli/main.py#L704-L712)

Task input normally comes from a file, the task argument, or noninteractive standard input, in that priority order. The interactive CLI treats `-f` specially: it wraps the file contents in a request to read and understand the file, then ask what the user wants done. Headless execution uses the shared reader directly, so a task file supplies the actual task text there.

Sources: [openhands/io/io.py:20-37](repo://openhands/io/io.py#L20-L37), [openhands/cli/main.py:714-731](repo://openhands/cli/main.py#L714-L731), [openhands/core/main.py:286-305](repo://openhands/core/main.py#L286-L305)

## Run an interactive session

A session chooses a supplied conversation ID or generates an ID from configuration and an optional session name. It constructs the LLM registry, agent, runtime and controller, and subscribes shell streaming output to the terminal UI. Controller construction attempts to restore a saved state before creating the new controller. Session-name-derived IDs incorporate the JWT secret, so the visible name alone is not the complete persistence key.

Sources: [openhands/cli/main.py:140-179](repo://openhands/cli/main.py#L140-L179), [openhands/core/setup.py:210-243](repo://openhands/core/setup.py#L210-L243), [openhands/core/setup.py:246-268](repo://openhands/core/setup.py#L246-L268)

After subscribing to events, the CLI connects the runtime, prepares any selected repository, creates memory and loads MCP tools. The event handler displays events and updates usage metrics. On `AWAITING_USER_INPUT` or `FINISHED`, it prompts for another task unless pause handling is already active. A completed task therefore leaves the interactive session available for additional work.

Sources: [openhands/cli/main.py:214-243](repo://openhands/cli/main.py#L214-L243), [openhands/cli/main.py:309-353](repo://openhands/cli/main.py#L309-L353)

| Terminal input | Dispatch |
| --- | --- |
| `/help` or `/status` | Display command help or usage and session information |
| `/new` | Request another session after the current session exits |
| `/settings` or `/mcp` | Open the corresponding configuration handler |
| `/resume` | Delegate to pause/resume handling |
| `/exit` | Delegate to intentional exit handling |
| Ordinary task text | Append a user `MessageAction` to the event stream |

Sources: [openhands/cli/commands.py:122-173](repo://openhands/cli/commands.py#L122-L173)

When confirmation is requested, the CLI can approve once, approve subsequent requests, or automatically approve actions below high risk. Rejection sends `USER_REJECTED` and prompts for alternative instructions. Pausing and running also manage the terminal pause listener. The interactive wait loop ends only on `STOPPED` or `ERROR`, after which cleanup runs and a requested new session can start.

Sources: [openhands/cli/main.py:245-307](repo://openhands/cli/main.py#L245-L307), [openhands/cli/main.py:432-443](repo://openhands/cli/main.py#L432-L443), [openhands/cli/main.py:736-755](repo://openhands/cli/main.py#L736-L755)

## Embed the headless runner

`run_controller` accepts configuration and an initial action, with optional session ID, existing runtime, memory and user-response callback. If no runtime is supplied, it creates and connects one and initializes the selected repository. A supplied runtime bypasses that creation block; callers preparing benchmark environments must provide an already usable runtime. Missing memory is constructed separately before tools and the controller are initialized.

Sources: [openhands/core/main.py:51-61](repo://openhands/core/main.py#L51-L61), [openhands/core/main.py:97-167](repo://openhands/core/main.py#L97-L167), [openhands/core/loop.py:11-20](repo://openhands/core/loop.py#L11-L20)

When the agent requests input, `exit_on_message` sends `/exit`; otherwise a supplied callback generates a reply, or the runner reads standard input. The module entry point supplies its auto-continue callback by default. `--no-auto-continue` disables that callback and restores input reading, so it can cause a supposedly unattended invocation to wait for a response.

Sources: [openhands/core/main.py:193-205](repo://openhands/core/main.py#L193-L205), [openhands/core/main.py:247-260](repo://openhands/core/main.py#L247-L260), [openhands/core/main.py:311-320](repo://openhands/core/main.py#L311-L320), [openhands/core/config/arg_utils.py:130-136](repo://openhands/core/config/arg_utils.py#L130-L136)

Headless execution stops on finished, rejected, error, paused or stopped states. The shared waiting helper installs status callbacks on the runtime, controller and memory, and converts reported errors into controller error state. It rejects preexisting runtime or controller status callbacks instead of silently replacing them. These callback constraints matter when embedding the runner inside another orchestration layer.

Sources: [openhands/core/main.py:207-218](repo://openhands/core/main.py#L207-L218), [openhands/core/loop.py:22-45](repo://openhands/core/loop.py#L22-L45)

## Persistence, replay and cleanup

The headless wrapper saves a controller snapshot for configured non-memory stores and closes the controller without overwriting its terminal state. If `save_trajectory_path` is set, it exports JSON history there; an existing directory receives a session-ID filename. Use a path with a parent directory because export creates the pathname's directory component. [[Events and Persistence]] distinguishes the snapshot from the event history used for trajectory export.

Sources: [openhands/core/main.py:220-244](repo://openhands/core/main.py#L220-L244)

Replay requires a null initial action, loads the recorded first user message as the initial action, and passes the remaining replay events to controller creation. The module rejects a separate task when replay is enabled. Replay loading checks that the path exists and is a file, requires the first reconstructed event to be a message action, and reports invalid JSON as a value error.

Sources: [openhands/core/main.py:157-167](repo://openhands/core/main.py#L157-L167), [openhands/core/main.py:263-305](repo://openhands/core/main.py#L263-L305)

Interactive cleanup saves state, waits briefly for pending tasks, cancels remaining tasks, resets the agent and closes runtime and controller. Its outer command wrapper also cancels event-loop tasks before closing the loop. The headless wrapper's finalization explicitly closes the controller and exports state; an embedding caller should retain ownership of any runtime it supplied and arrange that environment's cleanup.

Sources: [openhands/cli/main.py:91-122](repo://openhands/cli/main.py#L91-L122), [openhands/cli/main.py:758-780](repo://openhands/cli/main.py#L758-L780), [openhands/core/main.py:220-244](repo://openhands/core/main.py#L220-L244)

