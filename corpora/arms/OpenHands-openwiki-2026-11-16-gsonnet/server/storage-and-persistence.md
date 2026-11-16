---
type: architecture
title: Storage and Persistence
description: The FileStore abstraction and its local, in-memory, S3, Google Cloud and web-hook-wrapped backends; the on-disk layout of conversations (events, agent state, stats, metadata); and the settings, secrets and conversation-metadata stores built on top.
tags: [storage, file-store, persistence, settings, secrets, conversations, s3]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-3627b67e8337b522b301f047
    resource: repo://openhands/storage/__init__.py
  - id: openwiki-source-48f0c5d87fbf4640f4f3e86a
    resource: repo://openhands/storage/batched_web_hook.py
  - id: openwiki-source-2c04600c29d2c5701b2c02fd
    resource: repo://openhands/storage/conversation/conversation_validator.py
  - id: openwiki-source-1aabfc60e3a12549b20907d4
    resource: repo://openhands/storage/conversation/file_conversation_store.py
  - id: openwiki-source-241c21e0c5ea5c84fc74d1be
    resource: repo://openhands/storage/data_models/conversation_metadata.py
  - id: openwiki-source-6edab453316a5e90be94659a
    resource: repo://openhands/storage/files.py
  - id: openwiki-source-c7fbc0bab8bf4b6a1164a01c
    resource: repo://openhands/storage/locations.py
  - id: openwiki-source-d5332d718f6cd21e525b683b
    resource: repo://openhands/storage/secrets/file_secrets_store.py
  - id: openwiki-source-7208fb274b31c2db7c97c202
    resource: repo://openhands/storage/settings/file_settings_store.py
  - id: openwiki-source-cef6554139d90549968a35e2
    resource: repo://openhands/storage/web_hook.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Storage and Persistence

OpenHands persists everything through one tiny interface, `FileStore` (`openhands/storage/files.py`): `write(path, contents)`, `read(path) -> str`, `list(path)`, `delete(path)`. Higher-level stores (events, state, settings, secrets, conversation metadata) are just JSON/pickle files written through it. Because there is no database in the OSS edition, swapping the backend swaps all persistence; the enterprise edition replaces the higher-level stores with SQL-backed ones while still using file stores for events ([Enterprise](../enterprise/enterprise-saas.md)).

## Backends and selection (`storage/__init__.py::get_file_store`)

`config.file_store` ([Configuration](../configuration/configuration.md)) picks the backend; `config.file_store_path` is its root/bucket:

| Value | Class | Notes |
|---|---|---|
| `local` (default; path `~/.openhands`) | `LocalFileStore` | Expands `~`, creates the root, strips a leading `/` from paths, creates parent dirs on write; `list` appends `/` to directories; `delete` removes files or whole directories and only logs on errors. |
| `s3` | `S3FileStore` | Bucket from the path or `AWS_S3_BUCKET`; `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_S3_ENDPOINT` (for S3-compatible services) and `AWS_S3_SECURE`. |
| `google_cloud` | `GoogleCloudFileStore` | Bucket from the path or `GOOGLE_CLOUD_BUCKET_NAME`; credentials from `GOOGLE_APPLICATION_CREDENTIALS`, otherwise anonymous. |
| anything else (e.g. `memory`) | `InMemoryFileStore` | Dict-backed; used for tests and ephemeral runs. Note that **any unrecognized value silently selects the in-memory store**. |

If `file_store_web_hook_url` is set the chosen store is wrapped:

- `WebHookFileStore` writes through, then asynchronously (thread executor) POSTs file contents to `<base_url><path>` (or sends a delete) with up to 3 attempts one second apart.
- `BatchedWebHookFileStore` (`file_store_web_hook_batch=true`) accumulates updates and sends them together when either a timeout (counted from the last insert) or a size limit is hit, with an explicit `flush()`.
- Headers default to `X-Session-API-Key` from `SESSION_API_KEY` when none are configured. This is how a nested runtime server replicates its events and state to an outer server in SaaS ([Server](server-and-sessions.md)).

## Conversation layout (`storage/locations.py`)

Paths are relative to the store root; with a `user_id` they live under `users/<user_id>/conversations/<sid>/`, otherwise under `sessions/<sid>/`:

| File | Content | Written by |
|---|---|---|
| `events/<id>.json` | One serialized event per file | `EventStream.add_event` ([Event stream](../architecture/event-stream.md)) |
| `event_cache/<start>-<end>.json` | 25-event pages for faster reads | `EventStream` |
| `agent_state.pkl` | Base64-encoded pickle of the controller `State` | `State.save_to_session` ([AgentController](../architecture/agent-controller.md)) |
| `conversation_stats.pkl` | Per-service LLM metrics (cost, tokens, latency) | `ConversationStats` ([LLM layer](../llm/llm-layer.md)) |
| `metadata.json` | `ConversationMetadata` | `ConversationStore` |
| `exp_config.json` | Experiment variant config | experiment manager / `exp-config` route |
| `init.json`, `llm_registry.json` | Path helpers exist in `locations.py`, but nothing in the OSS code base writes them | — (reserved/legacy) |
| `TASKS.md` | Plan-mode task list | runtime `TaskTrackingAction` handling |

Global files: `settings.json`, `secrets.json` (local stores), and the JWT secret generated by `get_or_create_jwt_secret` (a random `uuid4().hex` stored on first use, which also seeds session ids).

### State save/restore semantics

- `State` is saved on **every agent state change** and on controller/headless shutdown, so crashes lose at most the in-flight step. `conversation_stats` is excluded from the pickle because it persists itself. Because it is a pickle, state files are only safe to load from trusted storage.
- On session start, `AgentSession._maybe_restore_state` tries `State.restore_from_session`; if it fails while events exist (latest event id > 0) it logs a warning and continues with a fresh state, rebuilding history from the event files. The event log is therefore the real source of truth and `agent_state.pkl` an optimization/continuity aid.
- Restored states start in `LOADING` with `resume_state` set when the saved state was resumable.

## Settings, secrets and conversation stores

All three are abstract classes with a `get_instance(config, user_id)` factory, selected by dotted path in `ServerConfig` and instantiated with `get_impl` ([Server](server-and-sessions.md)):

- **`SettingsStore` / `FileSettingsStore`**: loads/saves a `Settings` model (`settings.json`). `Settings` (`storage/data_models/settings.py`) holds the persisted user preferences: language, agent, max iterations, security analyzer, confirmation mode, LLM model/key/base URL, search API key, sandbox images, condenser flags, MCP config, git user name/email, budget, etc. Storing uses `model_dump_json(context={'expose_secrets': True})` because the API key must be persisted; normal API serialization masks secrets.
- **`SecretsStore` / `FileSecretsStore`**: loads/saves `UserSecrets` (`secrets.json`): provider tokens and custom secrets; on load, provider entries without a token are dropped ([Security](../security/security-and-confirmation.md)).
- **`ConversationStore` / `FileConversationStore`**: `ConversationMetadata` records — `conversation_id`, repository/branch/git provider, title, `trigger` (`gui`, `resolver`, `suggested_task`, `openhands_api`, `slack`, `jira`, `linear`, ...), `pr_number`s, `created_at`/`last_updated_at`, model, accumulated cost and token counts. `search` pages through metadata directories using opaque page ids derived from offsets; `get_metadata` rejects files missing `created_at`; `delete_metadata` removes the whole conversation directory. `validate_metadata` and `ConversationValidator` (used on Socket.IO connect) check that the user may access a conversation; the default validator loads the conversation's metadata and, if none exists yet, creates a record with the default title, so a first-time connection to a new conversation id succeeds.

`ConversationInitData` (a `Settings` subclass in `server/session/`) carries a conversation's effective settings plus git tokens, secrets, selected repository/branch and instructions into `AgentSession` ([Server](server-and-sessions.md)).

## Operational notes

- Local deployments keep everything under `~/.openhands` (mounted at `/.openhands` in the app container — [Build and containers](../operations/build-and-containers.md)); deleting a conversation removes its directory.
- Multi-server deployments must use a shared backend (S3/GCS or a shared volume) plus Redis for Socket.IO rooms.
- File stores are synchronous; async callers wrap calls with `call_sync_from_async`.

Related: [Event stream](../architecture/event-stream.md), [AgentController](../architecture/agent-controller.md), [Server and sessions](server-and-sessions.md).
