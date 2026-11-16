---
title: "Action Execution Server"
---
## Overview

The action execution server is the half of the runtime that lives inside the sandbox. It is a FastAPI application, `openhands/runtime/action_execution_server.py`, started in the container, pod or local process with a port and a list of plugins. It owns the agent's shell session, the Jupyter kernel, the file editor and the browser, and it executes each action it receives over HTTP and returns the observation as JSON.

Sources: [openhands/runtime/action_execution_server.py:166-224](repo://openhands/runtime/action_execution_server.py#L166-L224), [openhands/runtime/action_execution_server.py:653-677](repo://openhands/runtime/action_execution_server.py#L653-L677)

The client side, which serializes actions and posts them here, is on [[Runtime Architecture]]. How the shell behind `run` works is on [[Shell Sessions]].

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:315-340](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L315-L340)

## Startup

### Command line

```bash
python -m openhands.runtime.action_execution_server 8000 \
  --working-dir /workspace --plugins agent_skills jupyter \
  --username openhands --user-id 1000
```

Sources: [openhands/runtime/action_execution_server.py:653-677](repo://openhands/runtime/action_execution_server.py#L653-L677)

The arguments are the port, `--working-dir`, `--plugins` (names looked up in `ALL_PLUGINS`; an unknown name is an error), `--username` and `--user-id` for the account commands run as, `--enable-browser`/`--no-enable-browser`, and `--browsergym-eval-env` for browser benchmarks. Before the API starts, a file viewer server is started on the first free port above the API port.

Sources: [openhands/runtime/action_execution_server.py:655-692](repo://openhands/runtime/action_execution_server.py#L655-L692)

### Initialising the executor

The FastAPI lifespan creates an `ActionExecutor` and awaits its `ainit`:

Sources: [openhands/runtime/action_execution_server.py:697-710](repo://openhands/runtime/action_execution_server.py#L697-L710)

1. The constructor creates the working directory and the user account, with passwordless sudo, through `init_user_and_working_directory`; it adjusts the user id if one already exists with another id.
2. It creates the `OHEditor` file editor rooted at the working directory, and starts the optional memory monitor (`RUNTIME_MEMORY_MONITOR`). `RUNTIME_MAX_MEMORY_GB` sets a memory limit for the shell.
3. `ainit` creates the bash session first, then starts the browser in the background so it does not delay startup.
4. It initialises all plugins in parallel with a timeout of `INIT_PLUGIN_TIMEOUT` (default 120 seconds). The Jupyter kernel is moved to the shell's working directory, and when both `agent_skills` and `jupyter` are present, the agent-skills helpers are imported into the kernel.
5. It runs the startup shell commands: an alias that disables git's pager and, for a non-root user, a `cd` back into the working directory.

Sources: [openhands/runtime/action_execution_server.py:171-224](repo://openhands/runtime/action_execution_server.py#L171-L224), [openhands/runtime/action_execution_server.py:291-377](repo://openhands/runtime/action_execution_server.py#L291-L377), [openhands/runtime/utils/runtime_init.py:8-40](repo://openhands/runtime/utils/runtime_init.py#L8-L40)

On Linux and macOS the lifespan then creates an `MCPProxyManager`, protected by the session API key, and mounts it on the app, so stdio MCP servers can run inside the sandbox (see [[MCP Integration]]). On Windows MCP is skipped. On shutdown the executor closes the shell, the browser and the memory monitor.

Sources: [openhands/runtime/action_execution_server.py:697-757](repo://openhands/runtime/action_execution_server.py#L697-L757), [openhands/runtime/action_execution_server.py:645-651](repo://openhands/runtime/action_execution_server.py#L645-L651)

## Authentication

When the `SESSION_API_KEY` environment variable is set, an HTTP middleware requires every request except `/alive` and `/server_info` to carry it in the `X-Session-API-Key` header, and answers 403 otherwise. Without the variable, all requests are accepted. The runtime backends pass the conversation's session key when they start the server.

Sources: [openhands/runtime/action_execution_server.py:88-97](repo://openhands/runtime/action_execution_server.py#L88-L97), [openhands/runtime/action_execution_server.py:787-797](repo://openhands/runtime/action_execution_server.py#L787-L797)

## Executing an action

### The endpoint

`POST /execute_action` takes `{"action": <event dict>}`, rebuilds the action with `event_from_dict`, rejects anything that is not an action with 400, records the time for idle tracking, runs it, and returns `event_to_dict(observation)`. Any exception becomes a 500 response whose detail is the traceback.

Sources: [openhands/runtime/action_execution_server.py:814-831](repo://openhands/runtime/action_execution_server.py#L814-L831)

`ActionExecutor.run_action` holds an asyncio lock and calls the method named by the action type, so the sandbox executes one action at a time even if several requests arrive.

Sources: [openhands/runtime/action_execution_server.py:379-383](repo://openhands/runtime/action_execution_server.py#L379-L383)

### Action handlers

| Method | What it does |
| --- | --- |
| `run` | runs the command in the persistent shell; `is_static` commands run in a fresh session in `cwd` |
| `run_ipython` | runs the cell through the Jupyter plugin, first moving the kernel to the shell's current directory; appends the working directory and interpreter path lines |
| `read` | refuses binary files; `view` through the ACI editor, or reads the line range; images, PDFs and videos are returned as base64 data URLs |
| `write` | writes or splices lines into the file, creating directories, then restores the original permissions and owner (or sets `664` and the sandbox user for new files) |
| `edit` | runs the ACI editor command and returns a `FileEditObservation` with a diff |
| `browse`, `browse_interactive` | waits for the browser, then executes the BrowserGym action |

Sources: [openhands/runtime/action_execution_server.py:385-440](repo://openhands/runtime/action_execution_server.py#L385-L440), [openhands/runtime/action_execution_server.py:442-509](repo://openhands/runtime/action_execution_server.py#L442-L509), [openhands/runtime/action_execution_server.py:511-598](repo://openhands/runtime/action_execution_server.py#L511-L598)

File paths in `read` and `write` are resolved against the shell's current directory, so a relative path means the same thing to the agent's commands and its file operations. Errors such as a missing file, a directory, or undecodable text come back as `ErrorObservation`s the agent can act on.

Sources: [openhands/runtime/action_execution_server.py:436-509](repo://openhands/runtime/action_execution_server.py#L436-L509)

### The file editor

`_execute_file_editor` calls the `OHEditor` from `openhands-aci` with the command (`view`, `create`, `str_replace`, `insert`, `undo_edit`) and its arguments, converting a string `insert_line` to an integer. Editor errors and unexpected arguments are returned as text starting `ERROR:` instead of raising, along with the old and new file contents used for the diff.

Sources: [openhands/runtime/action_execution_server.py:100-163](repo://openhands/runtime/action_execution_server.py#L100-L163), [openhands/runtime/action_execution_server.py:565-589](repo://openhands/runtime/action_execution_server.py#L565-L589)

### Browser downloads

If an interactive browser action fails and a new file has appeared in `/workspace/.downloads`, the action is treated as a download: the file is copied to `/workspace/file_<n><ext>`, with the extension guessed from its content, and a `FileDownloadObservation` tells the agent where it is. [[Browser Environment]] covers the browser itself.

Sources: [openhands/runtime/action_execution_server.py:599-643](repo://openhands/runtime/action_execution_server.py#L599-L643)

## Other endpoints

### Endpoint list

| Endpoint | Purpose |
| --- | --- |
| `GET /alive` | `{"status": "ok"}` once initialised, otherwise `not initialized`; used by backends to wait for startup |
| `GET /server_info` | uptime, idle time since the last action, and CPU, memory and disk statistics |
| `POST /upload_file` | saves an uploaded file to an absolute destination; zip files (required for recursive uploads) are extracted |
| `GET /download_files?path=` | zips a directory and streams it, deleting the temporary zip afterwards |
| `POST /list_files` | lists a directory (default the working directory), directories first with a trailing `/`, each group sorted case-insensitively; missing paths give `[]` |
| `GET /vscode/connection_token` | the VS Code server's token, or `null` without the plugin |
| `POST /update_mcp_server` | replaces the stdio MCP servers behind the proxy and remounts it |

Sources: [openhands/runtime/action_execution_server.py:799-812](repo://openhands/runtime/action_execution_server.py#L799-L812), [openhands/runtime/action_execution_server.py:833-940](repo://openhands/runtime/action_execution_server.py#L833-L940), [openhands/runtime/action_execution_server.py:942-993](repo://openhands/runtime/action_execution_server.py#L942-L993), [openhands/runtime/action_execution_server.py:995-1074](repo://openhands/runtime/action_execution_server.py#L995-L1074)

Idle time from `/server_info` lets a backend such as the remote runtime decide when a sandbox has been unused long enough to pause.

Sources: [openhands/runtime/utils/system_stats.py:22-27](repo://openhands/runtime/utils/system_stats.py#L22-L27)

### Error responses

Unhandled exceptions return 500 with a generic message, HTTP exceptions keep their status and detail, and request validation errors return 422 with the validation errors.

Sources: [openhands/runtime/action_execution_server.py:761-785](repo://openhands/runtime/action_execution_server.py#L761-L785)

## The file viewer server

The file viewer is a second, unauthenticated FastAPI app bound to `127.0.0.1` only. `GET /view?path=` checks that the request comes from localhost and that the path is an absolute path to an existing file, then returns an HTML page that embeds a viewer for it. It runs in its own thread next to the action server.

Sources: [openhands/runtime/file_viewer_server.py:1-112](repo://openhands/runtime/file_viewer_server.py#L1-L112), [openhands/runtime/utils/file_viewer.py:8-8](repo://openhands/runtime/utils/file_viewer.py#L8-L8)
