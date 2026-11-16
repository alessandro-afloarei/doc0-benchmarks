---
type: subsystem
title: Runtime Architecture
description: How OpenHands executes agent actions — the Runtime base class as an event-stream subscriber, the ActionExecutionClient HTTP protocol, the in-sandbox action_execution_server with its tmux-backed bash session, Jupyter/agent-skills/VS Code plugins, file editor and browser, plus workspace setup (clone, setup.sh, git hooks), git change tracking, and error handling.
tags: [runtime, sandbox, action-execution-server, bash, plugins, git]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-fd6d296a69771bcf356e0886
    resource: repo://openhands/runtime/action_execution_server.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-3b9ac0f0231c225f39b5320d
    resource: repo://openhands/runtime/utils/bash.py
  - id: openwiki-source-98fca356fb036b0f63c503dc
    resource: repo://openhands/runtime/utils/git_handler.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Runtime Architecture

The **runtime** turns runnable [actions](../architecture/event-stream.md#the-event-model) into observations by executing them in a sandbox. Most implementations follow a client/server split:

```
backend process                                         sandbox (container / pod / host)
┌───────────────────────────────┐   HTTP + X-Session-API-Key   ┌───────────────────────────────┐
│ Runtime (base.py)             │ ───── POST /execute_action ─▶│ action_execution_server.py    │
│  └ ActionExecutionClient      │ ◀──── observation JSON ───── │  └ ActionExecutor             │
│     └ Docker/Remote/K8s/Local │   /upload_file /list_files … │     ├ BashSession (tmux)      │
└───────────────────────────────┘                              │     ├ Jupyter + agent_skills  │
                                                               │     ├ OHEditor (file edits)   │
                                                               │     ├ BrowserEnv (browsergym) │
                                                               │     └ MCP proxy, VS Code      │
                                                               └───────────────────────────────┘
```

Concrete runtimes, image building, and selection are covered in [Runtime Implementations](runtime-implementations.md).

## Runtime base class (`openhands/runtime/base.py`)

`Runtime` is constructed with the config, the conversation's `EventStream`, `sid`, the agent's `sandbox_plugins`, environment variables, provider tokens, and the `LLMRegistry`:

- **Subscribes** to the event stream as `RUNTIME` (unless created without one).
- Builds the initial environment from `_default_env_vars` plus `sandbox.runtime_startup_env_vars`, plus **git provider token env vars** computed through its own `ProviderHandler` ([Git Providers](../integrations/git-providers.md)). `add_env_vars` upper-cases keys and exports them into both IPython (`os.environ[...]`) and bash (`export ...`, or `$env:` on Windows).
- Mixes in `FileEditRuntimeMixin` for the deprecated LLM-based editor.
- Provides workspace helpers: `clone_or_init_repo`, `maybe_run_setup_script`, `maybe_setup_git_hooks`, microagent loading ([Microagents](../concepts/microagents.md)), git changes/diff, and VS Code/web host URLs.

### Action handling

`on_event(Action)` → `_handle_action`:

1. Assigns a default timeout (`sandbox.timeout`, non-blocking) when the action has none.
2. Refreshes provider tokens if a `CmdRunAction` references `$GITHUB_TOKEN`-style variables.
3. `MCPAction` → `call_tool_mcp` ([MCP](../integrations/mcp.md)); everything else → `run_action` in a worker thread.
4. Converts `PermissionError` into an `ErrorObservation` (agent sees it and continues). Network errors or `AgentRuntimeDisconnectedError` set runtime status `ERROR_RUNTIME_DISCONNECTED`; other exceptions set `ERROR`. In both of those cases no observation is published — the status callback surfaces the failure (and the controller moves to `ERROR`).
5. Sets `observation._cause = action.id`, copies `tool_call_metadata`, and publishes it (except `NullObservation`).

`run_action` handles **non-runnable** actions locally — `AgentThinkAction` → "Your thought has been logged", `TaskTrackingAction` writes/reads `TASKS.md` in the conversation directory of the file store — returns `NullObservation` for other non-runnables, an `ErrorObservation` if the runtime lacks a method for the action type, and `UserRejectObservation` for rejected confirmations. Otherwise it dispatches to the method named by `action.action` (`run`, `run_ipython`, `read`, `write`, `edit`, `browse`, `browse_interactive`).

### Workspace setup

Called by `AgentSession._create_runtime` and `core/setup.py:initialize_repository_for_runtime`:

- `clone_or_init_repo(tokens, repo, branch)` — with no repo, optionally `git init` (`init_git_in_empty_workspace`); otherwise clones via an authenticated URL into `workspace_root/<repo-name>` and checks out the selected branch or a fresh `openhands-workspace-<random>` branch.
- `maybe_run_setup_script()` — runs `.openhands/setup.sh` if present (status `SETTING_UP_WORKSPACE`).
- `maybe_setup_git_hooks()` — installs `.openhands/pre-commit.sh` as `.git/hooks/pre-commit`, preserving a pre-existing non-OpenHands hook as `pre-commit.local`.
- `_setup_git_config()` applies `git_user_name`/`git_user_email` from config.

`GitHandler` (`runtime/utils/git_handler.py`) powers the UI's "changes" view: `get_git_changes` and `get_git_diff` run hidden, static shell commands (separate bash sessions so they don't disturb the agent's shell) via `_execute_shell_fn_git_handler`.

## ActionExecutionClient

`openhands/runtime/impl/action_execution/action_execution_client.py` is the abstract HTTP client used by the Docker, Remote, Kubernetes, and Local runtimes; subclasses supply `action_execution_server_url` and lifecycle (`connect`, container/pod management).

`send_action_for_execution(action)`:

- LLM-based `FileEditAction`s are handled client-side (`llm_based_edit`).
- A blocking `CmdRunAction` without a timeout is rejected; others get the default timeout.
- Holds `action_semaphore` (one action at a time per runtime), short-circuits non-runnable, awaiting-confirmation (→ `NullObservation`), unsupported, and rejected actions.
- `POST /execute_action` with `{"action": event_to_dict(action)}` and an HTTP timeout of `action.timeout + 5s`; converts the JSON response with `observation_from_dict`. An HTTP timeout raises `AgentRuntimeTimeoutError`.
- `_send_action_server_request` retries retryable errors up to 5 times with exponential backoff (4–15s) and stops on shutdown.

Other endpoints: `/alive` (health), `/list_files`, `/upload_file` (`copy_to`, zipped directories), `/download_files` (`copy_from`), `/vscode/connection_token`, `/update_mcp_server`, `/server_info`.

## The action execution server (inside the sandbox)

`openhands/runtime/action_execution_server.py` is a FastAPI app started inside the sandbox as `python -m openhands.runtime.action_execution_server <port> --working-dir … --plugins … --username … --user-id …`. It also starts a file-viewer server on a nearby port.

- **Auth:** an HTTP middleware requires `X-Session-API-Key` (checked against `SESSION_API_KEY`) on every path except `/alive` and `/server_info`.
- **`ActionExecutor`** sets up the user and working directory, then `ainit()`:
  1. creates the **bash session** first;
  2. starts **browser** initialization in the background (`BrowserEnv`, a browsergym environment in a separate process connected by a pipe; disabled via `enable_browser`);
  3. initializes requested **plugins** concurrently (`INIT_PLUGIN_TIMEOUT`, default 120s), then imports agent-skills functions into Jupyter;
  4. runs init commands (`alias git="git --no-pager"`, `cd` into the working dir for non-root users).
- `run_action` serializes execution with an asyncio lock.
- Optional memory monitoring (`RUNTIME_MEMORY_MONITOR`, `RUNTIME_MAX_MEMORY_GB`).

### Bash: `BashSession` (`runtime/utils/bash.py`)

A persistent **tmux** session (via `libtmux`) per sandbox; Windows uses a PowerShell session instead.

- A custom `PS1` embeds JSON metadata (exit code, cwd, etc.) so output and `CmdOutputMetadata` can be parsed reliably between prompts.
- One command at a time: chained commands that `split_bash_commands` detects as multiple top-level commands are rejected with an error asking the agent to run them separately.
- **Soft timeout:** if output doesn't change for `NO_CHANGE_TIMEOUT_SECONDS` (default 30), the call returns partial output with a hint; the process keeps running and the agent can send `is_input=true` input (including keys like `C-c`), an empty command to fetch more output, or wait.
- **Hard timeout:** `action.timeout`, after which output so far is returned.
- `is_static` actions (used by `GitHandler`) run in a fresh, throwaway session with an optional `cwd`.

### Files and editing

- `read`/`write` resolve paths against the bash session's cwd, support `view_range`, return images as base64 data, and report permission errors.
- `edit` (ACI) uses `openhands-aci`'s `OHEditor` (`view`, `create`, `str_replace`, `insert`, `undo_edit`) and returns a `FileEditObservation` with a unified diff.

### Plugins

`PluginRequirement` objects declared on the agent class (`Agent.sandbox_plugins`) tell the runtime which plugins to start (`ALL_PLUGINS` in `runtime/plugins/__init__.py`):

| Plugin | Purpose |
| --- | --- |
| `agent_skills` | Python helper library (`file_ops`, `file_reader`, `file_editor`, `repo_ops`) importable in Jupyter |
| `jupyter` | Kernel gateway; `IPythonRunCellAction` runs here, with cwd kept in sync with bash |
| `vscode` | OpenVSCode server for the UI's editor tab (appended by `Runtime.__init__` when not headless) |

## Status reporting and failure modes

`Runtime.set_runtime_status` / `status_callback` report `RuntimeStatus` values (`STARTING_RUNTIME`, `SETTING_UP_WORKSPACE`, `SETTING_UP_GIT_HOOKS`, `READY`, `ERROR_RUNTIME_DISCONNECTED`, LLM errors, memory errors, …) to the session, which forwards them to the UI. Per-action failures that the agent can fix (bad paths, permission errors, unsupported actions, rejected actions) come back as observations; infrastructure failures go through the status channel.

## Tests

`tests/runtime/` runs against real sandboxes (`TEST_RUNTIME=docker|local|remote|…`): bash semantics (`test_bash.py`), IPython, ACI and LLM edits, browsing, env vars, MCP actions, microagent loading, setup scripts and hooks, replay, resource limits, and Docker images. `tests/unit/runtime/` covers client logic, bash parsing, git handler, and utilities without containers.

## Related pages

- [Runtime Implementations and Image Building](runtime-implementations.md)
- [Events and the Event Stream](../architecture/event-stream.md)
- [MCP Integration](../integrations/mcp.md)
- [Security Analyzers and Confirmation Mode](../security/security-analyzers.md)
