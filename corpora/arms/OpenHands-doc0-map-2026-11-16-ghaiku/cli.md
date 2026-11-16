---
title: "Command-Line Interface"
---
## Overview

The `openhands` command has two subcommands: `serve` starts the web server, and `cli` runs an agent in the terminal. Without a subcommand, the entry point inserts `cli`. The CLI builds the same agent, runtime and controller as the server, but drives them from a read-eval loop in the terminal and runs its runtime in headless mode.

Sources: [openhands/cli/entry.py:12-27](repo://openhands/cli/entry.py#L12-L27) [openhands/cli/entry.py:36-46](repo://openhands/cli/entry.py#L36-L46)

## Entry point

`main` answers the help and version flags first, through a fast path that exits before the full parser is built. It then parses the arguments. `serve` launches the GUI server, and `cli` or no subcommand calls `run_cli_command`. Any other subcommand prints the help and exits with status 1.

Sources: [openhands/cli/entry.py:12-18](repo://openhands/cli/entry.py#L12-L18) [openhands/cli/entry.py:19-34](repo://openhands/cli/entry.py#L19-L34) [openhands/cli/entry.py:36-50](repo://openhands/cli/entry.py#L36-L50)

`run_cli_command` creates a new event loop, runs `main_with_loop` on it, and handles a keyboard interrupt by printing a message. A connection refusal exits with status 1. In its `finally` block it cancels the remaining tasks, waits for them, and closes the loop.

Sources: [openhands/cli/main.py:758-781](repo://openhands/cli/main.py#L758-L781)

`main_with_loop` sets the log level and falls back to the home-directory config file when the requested config file does not exist, with a message that says so.

Sources: [openhands/cli/main.py:565-590](repo://openhands/cli/main.py#L565-L590)

## Starting a session

`run_session` generates a session id, or reuses the conversation id it is given. It creates the registry and conversation stats, the agent, and the runtime, and the runtime is created with `headless_mode=True`. If a task was given on the command line, it becomes the first user message.

Sources: [openhands/cli/main.py:125-140](repo://openhands/cli/main.py#L125-L140) [openhands/cli/main.py:160-170](repo://openhands/cli/main.py#L160-L170) [openhands/cli/main.py:386-390](repo://openhands/cli/main.py#L386-L390)

## Slash commands

Each line the user types is checked against the slash commands in `handle_commands`. `/exit`, `/help`, `/init`, `/status`, `/new`, `/settings`, `/resume` and `/mcp` each have a branch. `/init` calls `handle_init_command` with the event stream and the current folder, `/status` calls `handle_status_command` with the usage metrics, and `/new` calls `handle_new_command`. Any other input is added to the event stream as a user `MessageAction`.

Sources: [openhands/cli/commands.py:122-136](repo://openhands/cli/commands.py#L122-L136) [openhands/cli/commands.py:137-175](repo://openhands/cli/commands.py#L137-L175) [openhands/cli/commands.py:235-238](repo://openhands/cli/commands.py#L235-L238)

`handle_exit_command` takes the config, the event stream, the usage metrics and the session id, and returns whether the REPL should close. `check_folder_security_agreement` takes the config and the current folder and returns a bool.

Sources: [openhands/cli/commands.py:176-199](repo://openhands/cli/commands.py#L176-L199) [openhands/cli/commands.py:384-390](repo://openhands/cli/commands.py#L384-L390)

## Reading input

`read_input` reads one line, or a multi-line block that ends with `/exit` when multi-line input is enabled. `read_task` takes the task from a file named on the command line, or asks for it, and `read_task_from_file` reads the file.

Sources: [openhands/io/io.py:5-19](repo://openhands/io/io.py#L5-L19) [openhands/io/io.py:20-25](repo://openhands/io/io.py#L20-L25) [openhands/io/io.py:26-35](repo://openhands/io/io.py#L26-L35)

The TUI helpers print the runtime start-up message, the banner and the welcome text.

Sources: [openhands/cli/tui.py:124-132](repo://openhands/cli/tui.py#L124-L132) [openhands/cli/tui.py:150-169](repo://openhands/cli/tui.py#L150-L169)
