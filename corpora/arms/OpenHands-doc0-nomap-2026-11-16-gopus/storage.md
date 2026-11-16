---
title: "Storage"
---
## Overview

Everything OpenHands persists goes through one small interface, `FileStore`: event logs, agent state, conversation metadata, user settings and secrets, cost metrics and task lists. A `FileStore` stores strings or bytes at slash-separated paths and can `write`, `read`, `list` and `delete`. Choosing a backend, local disk, memory, S3 or Google Cloud Storage, therefore moves all of a server's data at once.

Sources: [openhands/storage/files.py:1-19](repo://openhands/storage/files.py#L1-L19), [openhands/storage/README.md:1-16](repo://openhands/storage/README.md#L1-L16)

On top of the file store sit three typed stores the server uses: `ConversationStore` for conversation metadata, `SettingsStore` for user settings and `SecretsStore` for provider tokens and custom secrets. Each is an abstract class with a file-based default, chosen by class path in `ServerConfig`, as [[Web Server and REST API]] describes. How events are written to the file store is covered in [[Event Stream]].

Sources: [openhands/server/shared.py:29-77](repo://openhands/server/shared.py#L29-L77), [openhands/server/config/server_config.py:16-24](repo://openhands/server/config/server_config.py#L16-L24)

## Backends

`get_file_store(file_store, file_store_path, ...)` picks the backend from the `file_store` setting, default `local` at `~/.openhands`. Any unrecognized value gives the in-memory store.

Sources: [openhands/storage/__init__.py:14-31](repo://openhands/storage/__init__.py#L14-L31), [openhands/core/config/openhands_config.py:72-76](repo://openhands/core/config/openhands_config.py#L72-L76)

| `file_store` | Class | Location | Settings |
| --- | --- | --- | --- |
| `local` | `LocalFileStore` | Directory at `file_store_path` (`~` expanded, created if missing) | `file_store_path` is required |
| `memory` | `InMemoryFileStore` | A dict in the process; lost on exit | none |
| `s3` | `S3FileStore` | Bucket named by `file_store_path`, or `AWS_S3_BUCKET` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_ENDPOINT` for S3-compatible services, `AWS_S3_SECURE` |
| `google_cloud` | `GoogleCloudFileStore` | Bucket named by `file_store_path`, or `GOOGLE_CLOUD_BUCKET_NAME` | `GOOGLE_APPLICATION_CREDENTIALS` |

Sources: [openhands/storage/local.py:1-53](repo://openhands/storage/local.py#L1-L53), [openhands/storage/memory.py:1-51](repo://openhands/storage/memory.py#L1-L51), [openhands/storage/s3.py:20-40](repo://openhands/storage/s3.py#L20-L40), [openhands/storage/google_cloud.py:12-22](repo://openhands/storage/google_cloud.py#L12-L22), [openhands/storage/README.md:18-48](repo://openhands/storage/README.md#L18-L48)

`LocalFileStore` creates parent directories on write, and `delete` removes a file or a whole directory tree. `S3FileStore` turns client errors into readable messages for denied access, a missing bucket or a missing key, and raises them as `FileNotFoundError`, the same exception callers such as the event store catch to mean "not there".

Sources: [openhands/storage/local.py:18-53](repo://openhands/storage/local.py#L18-L53), [openhands/storage/s3.py:42-99](repo://openhands/storage/s3.py#L42-L99), [openhands/events/event_store.py:126-130](repo://openhands/events/event_store.py#L126-L130)

## Web hooks

Any backend can be wrapped to notify another system of changes, which `file_store_web_hook_url` turns on. `WebHookFileStore` performs each write or delete on the wrapped store, then on a background thread sends `POST {url}{path}` with the contents or `DELETE {url}{path}`, retrying three times. When no headers are configured it sends `X-Session-API-Key` from `SESSION_API_KEY`.

Sources: [openhands/storage/web_hook.py:8-90](repo://openhands/storage/web_hook.py#L8-L90), [openhands/storage/__init__.py:32-57](repo://openhands/storage/__init__.py#L32-L57)

With `file_store_web_hook_batch`, `BatchedWebHookFileStore` collects changes and sends them as one `POST {url}` with a JSON array of `{method, path, content, encoding}` items, binary content base64-encoded. A batch is sent five seconds after the last change or as soon as it reaches 1 MB. Reads and listings always go to the wrapped store.

Sources: [openhands/storage/batched_web_hook.py:12-84](repo://openhands/storage/batched_web_hook.py#L12-L84), [openhands/storage/batched_web_hook.py:126-170](repo://openhands/storage/batched_web_hook.py#L126-L170), [openhands/storage/README.md:62-127](repo://openhands/storage/README.md#L62-L127)

## Path layout

`openhands/storage/locations.py` decides where each piece of a conversation lives. Without a user id, conversations are under `sessions/<id>/`; with one (multi-user deployments), under `users/<user_id>/conversations/<id>/`.

Sources: [openhands/storage/locations.py:1-42](repo://openhands/storage/locations.py#L1-L42)

| Path in the conversation directory | Contents | Written by |
| --- | --- | --- |
| `events/<n>.json` | One serialized event | [[Event Stream]] |
| `event_cache/<start>-<end>.json` | 25 events per page, for fast reads | [[Event Stream]] |
| `metadata.json` | `ConversationMetadata` | `FileConversationStore` |
| `agent_state.pkl` | Pickled, base64-encoded `State` | [[Agent Controller]] |
| `conversation_stats.pkl` | Pickled metrics per LLM service | `ConversationStats` in [[LLM Layer]] |
| `init.json`, `llm_registry.json`, `exp_config.json` | Initialization data, registry state, experiment config | server and experiments |
| `TASKS.md` | The agent's task list | the runtime's `task_tracker` handling |

Sources: [openhands/storage/locations.py:1-42](repo://openhands/storage/locations.py#L1-L42), [openhands/events/event_store.py:155-160](repo://openhands/events/event_store.py#L155-L160), [openhands/runtime/base.py:898-917](repo://openhands/runtime/base.py#L898-L917)

At the top of the store, `settings.json` and `secrets.json` hold the single user's settings and secrets in the file-based stores, and a JWT secret is generated and saved on first start so session ids stay stable, as [[Configuration]] describes.

Sources: [openhands/storage/settings/file_settings_store.py:15-43](repo://openhands/storage/settings/file_settings_store.py#L15-L43), [openhands/storage/secrets/file_secrets_store.py:15-49](repo://openhands/storage/secrets/file_secrets_store.py#L15-L49), [openhands/core/config/utils.py:367-374](repo://openhands/core/config/utils.py#L367-L374)

## Conversation metadata

`ConversationMetadata` describes a conversation without its events: its id, owner, selected repository, branch and git provider, title, creation and last-update times, what triggered it (`gui`, `resolver`, `suggested_task`, `openhands_api`, Slack, Jira, Linear and others), linked PR numbers, the LLM model, and running totals of cost and tokens. The server updates the last-update time, cost, tokens and title on each event, as [[Conversations and Sessions]] explains.

Sources: [openhands/storage/data_models/conversation_metadata.py:1-37](repo://openhands/storage/data_models/conversation_metadata.py#L1-L37)

`ConversationStore` declares `save_metadata`, `get_metadata`, `validate_metadata` (does the conversation belong to this user), `delete_metadata`, `exists`, `search(page_id, limit)` and `get_all_metadata`. `FileConversationStore` keeps one `metadata.json` per conversation; `search` lists the conversation directories, skipping hidden ones, loads them, sorts them newest first by creation time and pages through them with an opaque `page_id` that encodes the offset.

Sources: [openhands/storage/conversation/conversation_store.py:14-71](repo://openhands/storage/conversation/conversation_store.py#L14-L71), [openhands/storage/conversation/file_conversation_store.py:20-122](repo://openhands/storage/conversation/file_conversation_store.py#L20-L122)

When a browser connects, a `ConversationValidator` decides which user may open the conversation. The class comes from `OPENHANDS_CONVERSATION_VALIDATOR_CLS`; the default performs no real check and makes sure metadata exists, creating it if needed.

Sources: [openhands/storage/conversation/conversation_validator.py:13-81](repo://openhands/storage/conversation/conversation_validator.py#L13-L81)

## Settings

`Settings` is what the user saves in the GUI's settings pages: language, agent, iteration and budget limits, confirmation mode and security analyzer, the LLM model, key and base URL, sandbox images and resource factor, MCP servers, search and sandbox API keys, condenser options, git identity, and preferences such as sound notifications and analytics consent.

Sources: [openhands/storage/data_models/settings.py:20-51](repo://openhands/storage/data_models/settings.py#L20-L51)

Secrets in `Settings` are `SecretStr`. They serialize as `**********` unless the serialization context has `expose_secrets`, which only the stores use when writing, so API responses never contain the key. The embedded `secrets_store` is always serialized empty: tokens live in the secrets store instead.

Sources: [openhands/storage/data_models/settings.py:57-126](repo://openhands/storage/data_models/settings.py#L57-L126), [openhands/storage/settings/file_settings_store.py:28-31](repo://openhands/storage/settings/file_settings_store.py#L28-L31)

`Settings.from_config` builds settings from `config.toml` (agent, limits, security, LLM, MCP, search key) and returns nothing when the file defines no LLM API key. `merge_with_config_settings` combines saved MCP servers with those in `config.toml`, putting the config file's first.

Sources: [openhands/storage/data_models/settings.py:128-186](repo://openhands/storage/data_models/settings.py#L128-L186)

## Secrets

`UserSecrets` holds two read-only mappings: `provider_tokens` (a `ProviderToken` per git provider, with optional host and user id) and `custom_secrets` (named values with a description). Like settings, they serialize hidden unless `expose_secrets` is set, and the loaders turn dicts back into immutable `MappingProxyType` mappings.

Sources: [openhands/storage/data_models/user_secrets.py:26-140](repo://openhands/storage/data_models/user_secrets.py#L26-L140)

`get_env_vars` returns the custom secrets by name, and `set_event_stream_secrets` registers them with the conversation's event stream so their values are masked in every stored event. `get_custom_secrets_descriptions` gives the names and descriptions the agent sees in its workspace context, without the values. `FileSecretsStore.load` drops provider entries that have no token.

Sources: [openhands/storage/data_models/user_secrets.py:142-164](repo://openhands/storage/data_models/user_secrets.py#L142-L164), [openhands/storage/secrets/file_secrets_store.py:19-32](repo://openhands/storage/secrets/file_secrets_store.py#L19-L32)

## Replacing a store

Each typed store has the same extension pattern, stated in its docstring: subclass `ConversationStore`, `SettingsStore` or `SecretsStore`, implement `load` and `store` (or the metadata methods) and the async `get_instance(config, user_id)` factory, then set the matching `ServerConfig` class path. `DefaultUserAuth` calls `get_instance` with the request's user id, so an implementation can scope data per user.

Sources: [openhands/storage/settings/settings_store.py:9-36](repo://openhands/storage/settings/settings_store.py#L9-L36), [openhands/storage/secrets/secrets_store.py:9-36](repo://openhands/storage/secrets/secrets_store.py#L9-L36), [openhands/server/user_auth/default_user_auth.py:36-74](repo://openhands/server/user_auth/default_user_auth.py#L36-L74)
