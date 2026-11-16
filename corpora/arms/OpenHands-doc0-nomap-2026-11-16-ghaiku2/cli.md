---
title: "Command-Line Interface"
---
## Overview

The `openhands` command runs the agent in a terminal instead of the browser. It is the same controller, memory and runtime that the server uses, wired to a prompt loop and a console renderer. The runtime is the one named in the configuration, which is Docker by default, so the terminal path is isolated like the server path unless the configuration selects the `cli` runtime described on [[Runtime Implementations]]. This page follows the entry point, the argument parser, the session loop and its event handling.

Sources: [openhands/cli/entry.py:12-45](repo://openhands/cli/entry.py#L12-L45), [openhands/cli/main.py:125-175](repo://openhands/cli/main.py#L125-L175)

## Entry point

`openhands.cli.entry:main` answers `--help` and `--version` before importing anything heavy. Otherwise it inserts the `cli` subcommand when none is given, parses the arguments, and runs `serve` through the GUI launcher or `cli` through `run_cli_command`. Any other subcommand prints help and exits with status 1.

Sources: [openhands/cli/entry.py:12-50](repo://openhands/cli/entry.py#L12-L50), [openhands/cli/fast_help.py:143-160](repo://openhands/cli/fast_help.py#L143-L160)

The CLI parser is a small set of arguments on top of the common ones: the config file, a task given with `--task` or read from a file with `--file`, a session name, the log level, and overrides for the LLM and agent configs by name. The evaluation options are also defined there.

Sources: [openhands/core/config/arg_utils.py:145-175](repo://openhands/core/config/arg_utils.py#L145-L175), [openhands/core/config/arg_utils.py:18-60](repo://openhands/core/config/arg_utils.py#L18-L60)

`run_cli_command` creates a new event loop, runs `main_with_loop`, and on exit cancels the tasks that are still pending before closing the loop. A `KeyboardInterrupt` is reported as an interrupted session, and a refused connection exits with status 1.

Sources: [openhands/cli/main.py:758-781](repo://openhands/cli/main.py#L758-L781)

## Startup

`main_with_loop` sets the log level, uses the home-directory config when the given config file is missing, and builds the config with `setup_config_from_args`, so command-line overrides win over the file. It loads the settings from the file settings store, and runs the setup flow if none exist. Then it starts the session loop.

Sources: [openhands/cli/main.py:565-612](repo://openhands/cli/main.py#L565-L612), [openhands/core/config/utils.py:839-870](repo://openhands/core/config/utils.py#L839-L870)

## The session

`run_session` builds the same objects as the server does, in the same order: the LLM registry and statistics, the agent, the runtime, and the controller. The runtime is created with headless mode on and its shell output is streamed to the console. The session subscribes to the event stream under the main subscriber ID, so every event reaches the console renderer.

Sources: [openhands/cli/main.py:125-180](repo://openhands/cli/main.py#L125-L180), [openhands/cli/main.py:305-313](repo://openhands/cli/main.py#L305-L313)

The event handler does three things for each event. It renders the event, it updates the usage metrics, and it stops the pause listener when the agent leaves the running or paused states. When the agent reports `AWAITING_USER_INPUT` or `FINISHED`, the handler reloads the workspace microagents if the repository setup has just run, and then prompts for the next task.

Sources: [openhands/cli/main.py:214-244](repo://openhands/cli/main.py#L214-L244)

The prompt itself is read by `read_prompt_input`, which takes the state the agent is in and the multiline setting. The `/`-prefixed commands such as help, status, new, resume, settings, MCP and init are handled before a message is sent to the agent.

Sources: [openhands/cli/tui.py:803-830](repo://openhands/cli/tui.py#L803-L830), [openhands/cli/commands.py:122-175](repo://openhands/cli/commands.py#L122-L175)

## Confirmation

The CLI controls risk confirmation itself. The controller marks every risky action as awaiting confirmation in CLI mode, and the CLI decides what to do with it. The session keeps two flags that the user can set: one that confirms every action, and one that asks only for high-risk actions. The rule is described on [[Security Analyzers]].

Sources: [openhands/controller/agent_controller.py:936-952](repo://openhands/controller/agent_controller.py#L936-L952), [openhands/cli/main.py:150-152](repo://openhands/cli/main.py#L150-L152)

## Repository and folder checks

Before a session starts, the CLI can check the working folder. `check_folder_security_agreement` checks the folder against the user's agreement, and `init_repository` initialises a git repository for a folder that needs one. The settings command shows and changes the saved settings.

Sources: [openhands/cli/commands.py:325-430](repo://openhands/cli/commands.py#L325-L430), [openhands/cli/settings.py:41-60](repo://openhands/cli/settings.py#L41-L60)

## MCP servers

The MCP commands list, add and remove servers in the user's config file. The file is read and written as TOML, and new servers are added under the same sections that [[MCP Tools]] describes. Stdio servers added here run on the user's machine, as the CLI runtime's MCP path expects.

Sources: [openhands/cli/commands.py:431-520](repo://openhands/cli/commands.py#L431-L520), [openhands/cli/commands.py:565-600](repo://openhands/cli/commands.py#L565-L600)

## GUI mode

`openhands serve` does not run the agent itself. `launch_gui_server` starts the web GUI in a Docker container, optionally mounting the current directory and enabling GPUs. The browser interface is then the one described on [[Web Frontend]].

Sources: [openhands/cli/gui_launcher.py:76-100](repo://openhands/cli/gui_launcher.py#L76-L100), [openhands/cli/entry.py:37-42](repo://openhands/cli/entry.py#L37-L42)
