---
title: "Storage"
---
## Overview

Everything OpenHands persists goes through one small abstraction, the `FileStore`: a key-value store of text blobs addressed by slash-separated paths, with `write`, `read`, `list` and `delete`. Events, agent state, conversation metadata, LLM statistics, user settings and secrets are all files in it. Because no component touches the disk directly, the same code stores data under `~/.openhands` on a laptop and in an S3 or Google Cloud bucket in a hosted deployment.

Sources: [openhands/storage/files.py:1-19](repo://openhands/storage/files.py#L1-L19), [openhands/storage/README.md:1-15](repo://openhands/storage/README.md#L1-L15)

On top of the file store sit three typed stores used by the server, for conversation metadata, settings and secrets. Each is an abstract class with a file-based default that a deployment can replace through `ServerConfig` (see [[Server Application and REST API]]).

Sources: [openhands/server/config/server_config.py:16-24](repo://openhands/server/config/server_config.py#L16-L24)

## File stores

### Choosing a backend

`get_file_store` builds the backend named by `file_store` in the config and its location from `file_store_path`:

Sources: [openhands/storage/__init__.py:14-20](repo://openhands/storage/__init__.py#L14-L20)

| `file_store` | Class | `file_store_path` means |
| --- | --- | --- |
| `local` (default) | `LocalFileStore` | root directory, `~` expanded (default `~/.openhands`); required |
| `s3` | `S3FileStore` | bucket name, else `AWS_S3_BUCKET` |
| `google_cloud` | `GoogleCloudFileStore` | bucket name, else `GOOGLE_CLOUD_BUCKET_NAME` |
| anything else | `InMemoryFileStore` | unused; data is lost when the process exits |

Sources: [openhands/storage/__init__.py:14-31](repo://openhands/storage/__init__.py#L14-L31), [openhands/core/config/openhands_config.py:72-73](repo://openhands/core/config/openhands_config.py#L72-L73)

`LocalFileStore` joins paths onto its root and creates directories as needed. `S3FileStore` uses boto3 with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, an optional `AWS_S3_ENDPOINT` for S3-compatible services and `AWS_S3_SECURE`; deleting a path removes every object under it as a prefix. `GoogleCloudFileStore` uses the default Google credentials, or `GOOGLE_APPLICATION_CREDENTIALS`.

Sources: [openhands/storage/local.py:8-53](repo://openhands/storage/local.py#L8-L53), [openhands/storage/s3.py:22-40](repo://openhands/storage/s3.py#L22-L40), [openhands/storage/s3.py:116-135](repo://openhands/storage/s3.py#L116-L135), [openhands/storage/google_cloud.py:12-30](repo://openhands/storage/google_cloud.py#L12-L30), [openhands/storage/README.md:17-50](repo://openhands/storage/README.md#L17-L50)

### Web hook wrappers

When `file_store_web_hook_url` is set, the chosen store is wrapped so that every change is also announced over HTTP, for example to mirror a nested server's files to its parent. Headers come from `file_store_web_hook_headers`, defaulting to the `X-Session-API-Key` when `SESSION_API_KEY` is set.

Sources: [openhands/storage/__init__.py:32-57](repo://openhands/storage/__init__.py#L32-L57)

`WebHookFileStore` performs the write or delete on the underlying store, then sends `POST <url><path>` with the contents or `DELETE <url><path>` on a background executor, retried three times a second apart. `BatchedWebHookFileStore` (with `file_store_web_hook_batch`) collects changes per path and sends them as one JSON list of `{method, path, content}` items, base64-encoding binary content, when five seconds pass or the batch reaches 1 MB.

Sources: [openhands/storage/web_hook.py:9-118](repo://openhands/storage/web_hook.py#L9-L118), [openhands/storage/batched_web_hook.py:12-80](repo://openhands/storage/batched_web_hook.py#L12-L80), [openhands/storage/batched_web_hook.py:219-260](repo://openhands/storage/batched_web_hook.py#L219-L260)

## Layout

All conversation data lives under one directory per conversation: `sessions/<id>/` in single-user mode, or `users/<user_id>/conversations/<id>/` when a user id is known.

Sources: [openhands/storage/locations.py:1-8](repo://openhands/storage/locations.py#L1-L8)

| Path inside the conversation directory | Contents | Written by |
| --- | --- | --- |
| `events/<n>.json` | one event | [[Event Stream]] |
| `event_cache/<start>-<end>.json` | pages of 25 events | [[Event Stream]] |
| `metadata.json` | `ConversationMetadata` | conversation store |
| `agent_state.pkl` | pickled `State` | [[Agent Controller]] |
| `conversation_stats.pkl` | per-LLM metrics | [[LLM Registry and Routing]] |
| `init.json`, `llm_registry.json`, `exp_config.json` | initialisation and experiment data | server |
| `TASKS.md` | the agent's task list | runtime |

Sources: [openhands/storage/locations.py:11-42](repo://openhands/storage/locations.py#L11-L42), [openhands/events/event_store.py:155-159](repo://openhands/events/event_store.py#L155-L159), [openhands/runtime/base.py:900-905](repo://openhands/runtime/base.py#L900-L905)

User-level files sit at the root of the store: `settings.json` and `secrets.json` for the file-based settings and secrets stores. With the local backend all of this is under `~/.openhands`, which is why the Docker instructions mount that folder.

Sources: [openhands/storage/settings/file_settings_store.py:14-17](repo://openhands/storage/settings/file_settings_store.py#L14-L17), [openhands/storage/secrets/file_secrets_store.py:14-17](repo://openhands/storage/secrets/file_secrets_store.py#L14-L17), [README.md:84-92](repo://README.md#L84-L92)

## Conversation metadata

### ConversationMetadata

Each conversation has a `ConversationMetadata` record: id, user, selected repository, branch and git provider, title, creation and last-update times, what triggered it (GUI, resolver, suggested task, API key, Slack, Jira, Linear, microagent management), PR numbers it opened, the LLM model, and accumulated cost and token counts. A separate `ConversationStatus` (`STARTING`, `RUNNING`, `STOPPED`, `ARCHIVED`, `ERROR`) describes the agent loop as reported by the conversation manager.

Sources: [openhands/storage/data_models/conversation_metadata.py:8-37](repo://openhands/storage/data_models/conversation_metadata.py#L8-L37), [openhands/storage/data_models/conversation_status.py:13-23](repo://openhands/storage/data_models/conversation_status.py#L13-L23)

### ConversationStore

`ConversationStore` defines `save_metadata`, `get_metadata`, `delete_metadata`, `exists`, `search(page_id, limit)` and the `get_instance(config, user_id)` factory, plus `validate_metadata`, which checks that a conversation belongs to a user, and `get_all_metadata`, which loads several in parallel.

Sources: [openhands/storage/conversation/conversation_store.py:18-71](repo://openhands/storage/conversation/conversation_store.py#L18-L71)

`FileConversationStore` keeps the metadata as `sessions/<id>/metadata.json`. A file without `created_at` is treated as missing, and an obsolete `github_user_id` field is dropped. `search` lists the conversation directories, loads each (skipping unreadable ones), sorts newest first by creation time and returns one page with an opaque `next_page_id`. Deleting metadata deletes the whole conversation directory.

Sources: [openhands/storage/conversation/file_conversation_store.py:28-122](repo://openhands/storage/conversation/file_conversation_store.py#L28-L122)

The conversation validator used by the Socket.IO connect handler also works on this store. The default `ConversationValidator` performs no access check: it creates metadata for an unknown conversation id and returns the stored user id. A deployment replaces it through `OPENHANDS_CONVERSATION_VALIDATOR_CLS`.

Sources: [openhands/storage/conversation/conversation_validator.py:1-81](repo://openhands/storage/conversation/conversation_validator.py#L1-L81)

## Settings and secrets stores

`SettingsStore` and `SecretsStore` each define `load`, `store` and `get_instance`. The file implementations read and write one JSON file, serialising with `expose_secrets` so API keys and tokens are written in clear text to the store; the file secrets store also drops provider entries without a token when loading. What the models contain and how the routes use them is on [[Settings, Secrets and User Auth]].

Sources: [openhands/storage/settings/settings_store.py:9-36](repo://openhands/storage/settings/settings_store.py#L9-L36), [openhands/storage/settings/file_settings_store.py:14-43](repo://openhands/storage/settings/file_settings_store.py#L14-L43), [openhands/storage/secrets/secrets_store.py:9-36](repo://openhands/storage/secrets/secrets_store.py#L9-L36), [openhands/storage/secrets/file_secrets_store.py:14-49](repo://openhands/storage/secrets/file_secrets_store.py#L14-L49)
