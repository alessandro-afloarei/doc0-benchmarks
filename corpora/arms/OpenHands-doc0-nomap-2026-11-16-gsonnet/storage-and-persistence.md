---
title: "Storage and Persistence"
---
## Overview

OpenHands persists everything through one small interface, `FileStore`, a key-value store of paths to strings. Events, the pickled agent state, conversation statistics, metadata, user settings and secrets are all files in a file store, and `get_file_store` picks the backend from configuration. On top of that, three abstract store classes (`ConversationStore`, `SettingsStore`, `SecretsStore`) are loaded by name so a hosted deployment can replace them.

Sources: [openhands/storage/files.py:1-19](repo://openhands/storage/files.py#L1-L19), [openhands/storage/__init__.py:12-57](repo://openhands/storage/__init__.py#L12-L57), [openhands/server/shared.py:70-77](repo://openhands/server/shared.py#L70-L77)

## File store backends

`FileStore` has four methods: `write(path, contents)`, `read(path)`, `list(path)` and `delete(path)`. `get_file_store(file_store_type, file_store_path, ...)` chooses the implementation, and the web hook options wrap whichever it picked.

Sources: [openhands/storage/files.py:1-19](repo://openhands/storage/files.py#L1-L19), [openhands/storage/__init__.py:12-57](repo://openhands/storage/__init__.py#L12-L57)

| `file_store` | Class | Behaviour |
| --- | --- | --- |
| `local` | `LocalFileStore` | Files under a root directory (`~/.openhands` by default); `file_store_path` is required |
| `s3` | `S3FileStore` | A bucket named by `file_store_path` or `AWS_S3_BUCKET`, with credentials and endpoint from `AWS_*` variables |
| `google_cloud` | `GoogleCloudFileStore` | A bucket named by `file_store_path` or `GOOGLE_CLOUD_BUCKET_NAME` |
| any other value, such as `memory` | `InMemoryFileStore` | A dictionary; nothing survives the process |

Sources: [openhands/storage/__init__.py:12-35](repo://openhands/storage/__init__.py#L12-L35), [openhands/storage/local.py:8-53](repo://openhands/storage/local.py#L8-L53), [openhands/storage/s3.py:22-38](repo://openhands/storage/s3.py#L22-L38), [openhands/storage/google_cloud.py:12-22](repo://openhands/storage/google_cloud.py#L12-L22), [openhands/storage/memory.py:7-51](repo://openhands/storage/memory.py#L7-L51)

`LocalFileStore` expands a leading `~`, creates the root directory, creates parent directories on every write, and makes `list` return directory entries with a trailing slash. Deleting a missing path is a no-op.

Sources: [openhands/storage/local.py:11-53](repo://openhands/storage/local.py#L11-L53)

When `file_store_web_hook_url` is set, the chosen store is wrapped in `WebHookFileStore`, or `BatchedWebHookFileStore` when `file_store_web_hook_batch` is true. Both perform the real write and delete first and then notify the URL from a worker thread. The batched variant gathers updates and sends them after 5 seconds without a new write, or when the batch passes 1 MB. Default headers carry `X-Session-API-Key` when `SESSION_API_KEY` is set. See [[Configuration System]].

Sources: [openhands/storage/__init__.py:36-57](repo://openhands/storage/__init__.py#L36-L57), [openhands/storage/web_hook.py:8-79](repo://openhands/storage/web_hook.py#L8-L79), [openhands/storage/batched_web_hook.py:10-40](repo://openhands/storage/batched_web_hook.py#L10-L40)

## Layout of a conversation

`locations.py` defines every path. A conversation directory is `sessions/<sid>/`, or `users/<user_id>/conversations/<sid>/` when there is a user id.

Sources: [openhands/storage/locations.py:1-14](repo://openhands/storage/locations.py#L1-L14)

| Path inside the directory | Content |
| --- | --- |
| `events/<id>.json` | One serialised event per file |
| `event_cache/<start>-<end>.json` | A page of 25 events, written once the page is full |
| `agent_state.pkl` | The pickled, base64-encoded `State` |
| `conversation_stats.pkl` | The pickled per-service `Metrics` |
| `metadata.json` | The `ConversationMetadata` record |
| `init.json`, `llm_registry.json`, `exp_config.json` | Initialisation data, registry data and experiment configuration |
| `TASKS.md` | The agent's task list, written by the task tracker |

Sources: [openhands/storage/locations.py:1-42](repo://openhands/storage/locations.py#L1-L42), [openhands/events/event_store.py:155-159](repo://openhands/events/event_store.py#L155-L159), [openhands/runtime/base.py:899-904](repo://openhands/runtime/base.py#L899-L904)

The events themselves, their numbering and the page cache are written by `EventStream`; see [[Events and the Event Stream]]. A conversation exists when its directory exists, which `session_exists` checks by listing it.

Sources: [openhands/events/stream.py:33-40](repo://openhands/events/stream.py#L33-L40), [openhands/events/stream.py:163-213](repo://openhands/events/stream.py#L163-L213)

## Saving and restoring agent state

`State.save_to_session` pickles the state with the `conversation_stats` reference detached, base64-encodes it and writes it to `agent_state.pkl`. With a user id it also tries to delete a copy in the old, user-less location. `restore_from_session` reads the file, falling back to the old location when a user id is given, and raises `FileNotFoundError` if neither exists. The controller saves on every agent state change, and `AgentSession.close` saves once more; `create_controller` and `AgentSession._maybe_restore_state` restore it when a conversation resumes. See [[Agent Controller and Agent States]].

Sources: [openhands/controller/state/state.py:122-175](repo://openhands/controller/state/state.py#L122-L175), [openhands/controller/agent_controller.py:676-683](repo://openhands/controller/agent_controller.py#L676-L683), [openhands/server/session/agent_session.py:239-243](repo://openhands/server/session/agent_session.py#L239-L243), [openhands/server/session/agent_session.py:492-510](repo://openhands/server/session/agent_session.py#L492-L510), [openhands/core/setup.py:219-228](repo://openhands/core/setup.py#L219-L228)

> [!WARNING]
> Both `agent_state.pkl` and `conversation_stats.pkl` are Python pickles. Loading a file from a file store you do not control runs arbitrary code, so protect the store like code.

Sources: [openhands/controller/state/state.py:128-130](repo://openhands/controller/state/state.py#L128-L130), [openhands/controller/state/state.py:159-160](repo://openhands/controller/state/state.py#L159-L160), [openhands/server/services/conversation_stats.py:62-77](repo://openhands/server/services/conversation_stats.py#L62-L77)

`ConversationStats` keeps one `Metrics` per LLM service id. It subscribes to the LLM registry, so each newly created LLM gets the restored metrics of the same service id, which makes the cost of a resumed conversation continue from where it stopped. `save_metrics` merges restored and live entries and writes them. The budget limit reads its combined value. See [[LLM Layer]].

Sources: [openhands/server/services/conversation_stats.py:14-103](repo://openhands/server/services/conversation_stats.py#L14-L103), [openhands/utils/utils.py:41-43](repo://openhands/utils/utils.py#L41-L43)

## Pluggable stores

Three abstract classes define what the server needs, and each documents that its implementation is chosen by a `server_config` class name and created with `get_instance(config, user_id)`.

Sources: [openhands/storage/conversation/conversation_store.py:14-27](repo://openhands/storage/conversation/conversation_store.py#L14-L27), [openhands/storage/settings/settings_store.py:9-22](repo://openhands/storage/settings/settings_store.py#L9-L22)

| Abstract class | Methods | Open-source implementation |
| --- | --- | --- |
| `ConversationStore` | `save_metadata`, `get_metadata`, `delete_metadata`, `exists`, `search`, `get_all_metadata` | `FileConversationStore` |
| `SettingsStore` | `load`, `store` | `FileSettingsStore`, which keeps `settings.json` |
| `SecretsStore` | `load`, `store` | `FileSecretsStore` |

Sources: [openhands/storage/conversation/conversation_store.py:14-70](repo://openhands/storage/conversation/conversation_store.py#L14-L70), [openhands/storage/settings/settings_store.py:9-36](repo://openhands/storage/settings/settings_store.py#L9-L36), [openhands/storage/secrets/secrets_store.py:9-35](repo://openhands/storage/secrets/secrets_store.py#L9-L35), [openhands/server/config/server_config.py:16-24](repo://openhands/server/config/server_config.py#L16-L24)

`FileConversationStore` writes each conversation's `metadata.json`, treats a file without `created_at` as missing, and `search` lists the `sessions/` directory, loads every record, sorts by creation time newest first, and pages with an offset encoded as a page id. `FileSettingsStore.store` writes `Settings` with secrets exposed, because the store itself is the place the API key must be recoverable from.

Sources: [openhands/storage/conversation/file_conversation_store.py:28-102](repo://openhands/storage/conversation/file_conversation_store.py#L28-L102), [openhands/storage/settings/file_settings_store.py:14-43](repo://openhands/storage/settings/file_settings_store.py#L14-L43)

The `ConversationStore` is also where the manager reads a user's running conversations from when it enforces the concurrent limit. See [[Conversation Lifecycle]]. The [[Enterprise Edition]] replaces these classes with database-backed versions.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:306-319](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L306-L319), [openhands/server/shared.py:70-77](repo://openhands/server/shared.py#L70-L77)

## Secrets

`UserSecrets` holds two read-only mappings: `provider_tokens` (git tokens by provider) and `custom_secrets`. Its serialiser skips empty tokens and masks values unless the serialisation context sets `expose_secrets`. When a session starts, `AgentSession` registers the provider tokens and custom secrets with the event stream, and `EventStream._replace_secrets` replaces any occurrence of those values in event text with `<secret_hidden>` before the event is stored or delivered. See [[Events and the Event Stream]].

Sources: [openhands/storage/data_models/user_secrets.py:26-60](repo://openhands/storage/data_models/user_secrets.py#L26-L60), [openhands/server/session/agent_session.py:149-155](repo://openhands/server/session/agent_session.py#L149-L155), [openhands/events/stream.py:215-244](repo://openhands/events/stream.py#L215-L244)
