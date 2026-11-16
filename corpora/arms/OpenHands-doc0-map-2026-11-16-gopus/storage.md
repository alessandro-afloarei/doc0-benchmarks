---
title: "Storage"
---
## Overview

Everything OpenHands persists goes through one small interface, `FileStore`: `write`, `read`, `list` and `delete` on string paths. Conversation events, agent state, metrics, conversation metadata, user settings and secrets are all files in a file store, so switching from the local disk to S3 or Google Cloud Storage is a configuration change. On top of the file store sit three typed stores the server uses: the conversation store, the settings store and the secrets store.

Sources: [openhands/storage/files.py:4-19](repo://openhands/storage/files.py#L4-L19), [openhands/storage/README.md:1-16](repo://openhands/storage/README.md#L1-L16)

How events are written and paged is covered in [[Events and Event Stream]]; this page covers where they and everything else end up.

Sources: [openhands/events/stream.py:186-213](repo://openhands/events/stream.py#L186-L213)

## File store backends

`get_file_store` builds the store from `file_store`, `file_store_path` and the web hook settings in `[core]` ([[Configuration]]).

Sources: [openhands/storage/__init__.py:14-57](repo://openhands/storage/__init__.py#L14-L57)

| `file_store` | Class | Where files go | Configuration |
| --- | --- | --- | --- |
| `local` (default) | `LocalFileStore` | Under `file_store_path` (default `~/.openhands`, `~` expanded) | `file_store_path` is required |
| `s3` | `S3FileStore` | An S3 or S3-compatible bucket | Bucket from `file_store_path` or `AWS_S3_BUCKET`; `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_ENDPOINT`, `AWS_S3_SECURE` |
| `google_cloud` | `GoogleCloudFileStore` | A Google Cloud Storage bucket | Bucket from `file_store_path` or `GOOGLE_CLOUD_BUCKET_NAME`; credentials from `GOOGLE_APPLICATION_CREDENTIALS` |
| anything else, e.g. `memory` | `InMemoryFileStore` | A dict in the process; lost on exit | none |

Sources: [openhands/storage/__init__.py:21-31](repo://openhands/storage/__init__.py#L21-L31), [openhands/storage/local.py:8-20](repo://openhands/storage/local.py#L8-L20), [openhands/storage/s3.py:22-37](repo://openhands/storage/s3.py#L22-L37), [openhands/storage/google_cloud.py:13-22](repo://openhands/storage/google_cloud.py#L13-L22), [openhands/storage/memory.py:7-13](repo://openhands/storage/memory.py#L7-L13), [openhands/core/config/openhands_config.py:72-73](repo://openhands/core/config/openhands_config.py#L72-L73)

The S3 store reports missing buckets, missing keys and access denials as errors naming the bucket and path, and its `delete` removes everything under a prefix when the path is a folder.

Sources: [openhands/storage/s3.py:39-150](repo://openhands/storage/s3.py#L39-L150)

The headless runner skips saving the final agent state when the store is `memory`, since it would vanish anyway ([[Headless Mode]]).

Sources: [openhands/core/main.py:220-225](repo://openhands/core/main.py#L220-L225)

## Web hook wrappers

Setting `file_store_web_hook_url` wraps the chosen store so another service learns about every change. Reads and lists go to the inner store unchanged. Without explicit `file_store_web_hook_headers`, requests carry `X-Session-API-Key` when `SESSION_API_KEY` is set.

Sources: [openhands/storage/__init__.py:32-57](repo://openhands/storage/__init__.py#L32-L57)

`WebHookFileStore` writes to the inner store, then on a worker thread sends `POST <url><path>` with the contents (or `DELETE` for a delete), retrying up to three times a second apart.

Sources: [openhands/storage/web_hook.py:8-48](repo://openhands/storage/web_hook.py#L8-L48), [openhands/storage/web_hook.py:81-118](repo://openhands/storage/web_hook.py#L81-L118)

With `file_store_web_hook_batch = true`, `BatchedWebHookFileStore` collects updates instead and sends them together five seconds after the last change or once the batch passes 1 MB, encoding non-UTF-8 contents as base64. This cuts the number of requests for a conversation that writes many small event files.

Sources: [openhands/storage/batched_web_hook.py:12-93](repo://openhands/storage/batched_web_hook.py#L12-L93), [openhands/storage/batched_web_hook.py:240-252](repo://openhands/storage/batched_web_hook.py#L240-L252)

## File layout

A single-user install keeps conversations under `sessions/<id>/`; when a user id is known they go under `users/<user_id>/conversations/<id>/`.

Sources: [openhands/storage/locations.py:1-8](repo://openhands/storage/locations.py#L1-L8)

| Path inside the conversation folder | Contents | Written by |
| --- | --- | --- |
| `events/<n>.json` | One event | [[Events and Event Stream]] |
| `event_cache/<start>-<end>.json` | 25 events, for fast reads | [[Events and Event Stream]] |
| `metadata.json` | Conversation metadata | `FileConversationStore` |
| `agent_state.pkl` | Pickled, base64-encoded `State` | [[Agent Controller]] |
| `conversation_stats.pkl` | LLM metrics per service | [[LLM Integration]] |
| `llm_registry.json`, `init.json`, `exp_config.json` | Registry, init data and experiment config | Server |
| `TASKS.md` | The agent's task list | [[Runtime Architecture]] |

Sources: [openhands/storage/locations.py:11-42](repo://openhands/storage/locations.py#L11-L42), [openhands/events/event_store.py:155-159](repo://openhands/events/event_store.py#L155-L159), [openhands/runtime/base.py:900-904](repo://openhands/runtime/base.py#L900-L904)

At the store root, the file stores for settings and secrets write `settings.json` and `secrets.json`, and the config loader keeps the server's JWT secret there.

Sources: [openhands/storage/settings/file_settings_store.py:14-17](repo://openhands/storage/settings/file_settings_store.py#L14-L17), [openhands/storage/secrets/file_secrets_store.py:14-17](repo://openhands/storage/secrets/file_secrets_store.py#L14-L17), [openhands/core/config/utils.py:367-374](repo://openhands/core/config/utils.py#L367-L374)

## Conversation store

`ConversationStore` saves, reads, deletes and searches `ConversationMetadata`, checks whether a conversation exists, and can validate that a user owns one. Each implementation provides `get_instance(config, user_id)`, and the server picks the class from `server_config.conversation_store_class` ([[Server Application]]).

Sources: [openhands/storage/conversation/conversation_store.py:14-71](repo://openhands/storage/conversation/conversation_store.py#L14-L71)

`FileConversationStore` keeps each conversation's metadata in its `metadata.json`. `search` lists conversation folders, loads their metadata, sorts by creation time newest first and pages with an opaque page id. `delete_metadata` deletes the whole conversation folder, events included.

Sources: [openhands/storage/conversation/file_conversation_store.py:29-122](repo://openhands/storage/conversation/file_conversation_store.py#L29-L122)

`ConversationMetadata` holds the id, owner, selected repository, branch and git provider, title, creation and last-update times, what started it (`ConversationTrigger`: GUI, suggested task, resolver, API key, Slack, Jira, Linear, microagent management), PR numbers opened from it, the LLM model, and accumulated cost and token counts.

Sources: [openhands/storage/data_models/conversation_metadata.py:8-37](repo://openhands/storage/data_models/conversation_metadata.py#L8-L37)

`ConversationStatus` reports a conversation as `STARTING`, `RUNNING`, `STOPPED`, `ARCHIVED` or `ERROR`; the docstring maps `STOPPED` to a paused runtime and `ARCHIVED` to one that cannot restart.

Sources: [openhands/storage/data_models/conversation_status.py:1-23](repo://openhands/storage/data_models/conversation_status.py#L1-L23)

## Settings store

`Settings` is what the settings screens save: language, agent, iteration and budget limits, security analyzer and confirmation mode, LLM model, key and base URL, sandbox images and remote resource factor, MCP config, search and sandbox API keys, condenser options (`enable_default_condenser`, `condenser_max_size` of at least 20), git identity, and UI preferences.

Sources: [openhands/storage/data_models/settings.py:21-55](repo://openhands/storage/data_models/settings.py#L21-L55), [openhands/storage/data_models/settings.py:113-120](repo://openhands/storage/data_models/settings.py#L113-L120)

API keys serialise as `**********` unless the serialisation context sets `expose_secrets`, so settings returned by the API never contain them; the file store saves with `expose_secrets` so the keys survive a restart. The embedded secrets store always serialises empty, because secrets now live in their own store.

Sources: [openhands/storage/data_models/settings.py:57-75](repo://openhands/storage/data_models/settings.py#L57-L75), [openhands/storage/data_models/settings.py:122-126](repo://openhands/storage/data_models/settings.py#L122-L126), [openhands/storage/settings/file_settings_store.py:19-30](repo://openhands/storage/settings/file_settings_store.py#L19-L30)

`Settings.from_config` builds default settings from `config.toml` when an LLM key is configured, and `merge_with_config_settings` merges MCP servers from the config file into saved settings, config first.

Sources: [openhands/storage/data_models/settings.py:128-186](repo://openhands/storage/data_models/settings.py#L128-L186)

## Secrets store

`UserSecrets` holds the user's git provider tokens and custom secrets as immutable mappings; each custom secret has a value and a description. Like settings, values serialise only with `expose_secrets`.

Sources: [openhands/storage/data_models/user_secrets.py:26-92](repo://openhands/storage/data_models/user_secrets.py#L26-L92)

`FileSecretsStore` reads and writes `secrets.json`, dropping provider entries without a token on load.

Sources: [openhands/storage/secrets/file_secrets_store.py:14-49](repo://openhands/storage/secrets/file_secrets_store.py#L14-L49)

When a conversation starts, custom secrets become environment variables in the sandbox and are registered with the event stream so their values are masked in stored and displayed events; their descriptions are given to the agent through the workspace context ([[Conversations and Sessions]]).

Sources: [openhands/storage/data_models/user_secrets.py:142-155](repo://openhands/storage/data_models/user_secrets.py#L142-L155), [openhands/server/session/agent_session.py:140-158](repo://openhands/server/session/agent_session.py#L140-L158)

## Replacing a store

`SettingsStore`, `SecretsStore` and `ConversationStore` are abstract classes named in `ServerConfig`. The hosted [[Enterprise Server]] replaces all three with its own SaaS stores while keeping the same interfaces.

Sources: [openhands/storage/settings/settings_store.py:9-12](repo://openhands/storage/settings/settings_store.py#L9-L12), [openhands/storage/secrets/secrets_store.py:9-12](repo://openhands/storage/secrets/secrets_store.py#L9-L12), [openhands/server/config/server_config.py:16-24](repo://openhands/server/config/server_config.py#L16-L24), [enterprise/server/config.py:59-63](repo://enterprise/server/config.py#L59-L63)
