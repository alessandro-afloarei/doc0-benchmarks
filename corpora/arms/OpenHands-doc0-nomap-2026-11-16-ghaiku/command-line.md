---
title: "Command-Line Interface"
---
## Overview

The `openhands` command runs an agent in the terminal. It loads the configuration, asks for a task, starts a session, and then prints the agent's events and asks for the next input. It does not start the HTTP server. By default its runtime is the `cli` runtime, which runs commands as subprocesses on the user's machine. The entry point and the `serve` subcommand are described in [[Quickstart]].

Sources: [openhands/cli/main.py:565-600](repo://openhands/cli/main.py#L565-L600), [openhands/cli/entry.py:24-45](repo://openhands/cli/entry.py#L24-L45)

## Startup

`main_with_loop` sets the log level, loads the configuration from the given file or the home-directory file, and applies the command-line arguments. The workspace is the configured workspace base. In CLI mode that base defaults to the current directory when none is set.

Sources: [openhands/cli/main.py:565-592](repo://openhands/cli/main.py#L565-L592), [openhands/cli/main.py:672-675](repo://openhands/cli/main.py#L672-L675), [openhands/cli/main.py:704-708](repo://openhands/cli/main.py#L704-L708)

When no settings file exists, the first run goes through the setup flow. It asks for the LLM model and key, then optionally for the search API settings. The settings are then loaded and override some config values: the default agent, the LLM model and key, and the confirmation mode.

Sources: [openhands/cli/main.py:602-649](repo://openhands/cli/main.py#L602-L649), [openhands/cli/main.py:446-475](repo://openhands/cli/main.py#L446-L475)

The folder must be accepted by the security agreement before anything runs. A task file given with `--file` is wrapped in a prompt that asks the agent to read it first. Otherwise `read_task` in `openhands/io` gets the task from the arguments or from the prompt.

Sources: [openhands/cli/main.py:710-731](repo://openhands/cli/main.py#L710-L731), [openhands/io/io.py:26-30](repo://openhands/io/io.py#L26-L30)

The runtime's `setup` class method runs once, and then `run_session` runs the first session. While a session asks for a new one, the loop calls `run_session` again with no task.

Sources: [openhands/cli/main.py:734-752](repo://openhands/cli/main.py#L734-L752)

## A session

`run_session` picks a session id, builds the LLM registry, the agent and the runtime, and wires the runtime's shell output to the terminal display. It creates the controller on top of the same runtime and then connects the runtime. A repository, if one is selected, is cloned before memory is created with the microagents from that repository.

Sources: [openhands/cli/main.py:125-178](repo://openhands/cli/main.py#L125-L178), [openhands/cli/main.py:314-333](repo://openhands/cli/main.py#L314-L333)

The session subscribes a callback to the event stream under the main subscriber. Each event is printed, counted into usage metrics, and checked for state changes. When the agent waits for input or finishes, the callback prompts for the next task. When the agent waits for confirmation, the callback asks for it.

Sources: [openhands/cli/main.py:309-312](repo://openhands/cli/main.py#L309-L312), [openhands/cli/main.py:214-268](repo://openhands/cli/main.py#L214-L268)

Input typed at the prompt goes to `handle_commands`. Slash commands such as `/help`, `/init`, `/status`, `/new`, `/settings`, `/resume`, `/mcp` and `/exit` are handled there. Any other input is wrapped in a `MessageAction` and added to the event stream as a user message.

Sources: [openhands/cli/main.py:188-212](repo://openhands/cli/main.py#L188-L212), [openhands/cli/commands.py:122-173](repo://openhands/cli/commands.py#L122-L173)

## Confirmation in the terminal

In the terminal, the confirmation mode is on by default, and every checked action is held until the user answers. The answer is one of yes, always, auto-high-risk or no. Yes and the other accepted answers add a `USER_CONFIRMED` state change, and no adds `USER_REJECTED` and a note for the user. The auto-high-risk answer confirms actions whose risk is not `HIGH`, without asking again. The rules that produce this are in [[Security and Confirmation]].

Sources: [openhands/cli/main.py:253-290](repo://openhands/cli/main.py#L253-L290), [openhands/cli/main.py:256-272](repo://openhands/cli/main.py#L256-L272)

## Pausing

When the agent starts running, the terminal starts a listener for a pause key. Pressing it adds a `ChangeAgentStateAction` for `PAUSED` to the event stream, so the pause goes through the same state machine as other state changes. While paused, the terminal does not ask for confirmation, and the confirmation runs again after the agent resumes.

Sources: [openhands/cli/main.py:305-307](repo://openhands/cli/main.py#L305-L307), [openhands/cli/main.py:245-250](repo://openhands/cli/main.py#L245-L250), [openhands/cli/tui.py:894-910](repo://openhands/cli/tui.py#L894-L910)

The events are shown by the functions in `tui.py`: commands, command output, file edits and reads, MCP calls, task tracking and errors each have their own display function.

Sources: [openhands/cli/tui.py:260-306](repo://openhands/cli/tui.py#L260-L306), [openhands/cli/tui.py:384-430](repo://openhands/cli/tui.py#L384-L430)

The runtime the terminal uses is described in [[Runtime Implementations]], and the agent that runs in it is described in [[Agent Controller]].

Sources: [openhands/runtime/impl/cli/cli_runtime.py:90-100](repo://openhands/runtime/impl/cli/cli_runtime.py#L90-L100), [openhands/controller/agent_controller.py:100-115](repo://openhands/controller/agent_controller.py#L100-L115)
