---
title: "Storage, Settings and Secrets"
---
## Overview

Everything OpenHands persists goes through a `FileStore`: a four-method interface over paths and strings. Event streams, saved agent state, conversation statistics, conversation metadata, user settings and user secrets are all files under it. Which backend holds them (local disk, memory, S3, Google Cloud) and whether writes are mirrored to a webhook is decided once by `get_file_store` from the config. Three higher-level store interfaces (settings, secrets, conversations) and a user-auth interface sit on top and are extension points for multi-user deployments.

Sources: [openhands/storage/files.py:4-19](repo://openhands/storage/files.py#L4-L19), [openhands/storage/__init__.py:14-57](repo://openhands/storage/__init__.py#L14-L57)

## FileStore backends

`FileStore` declares `write(path, contents)`, `read(path)`, `list(path)` and `delete(path)`. `get_file_store` chooses an implementation from `file_store_type`.

Sources: [openhands/storage/__init__.py:14-31](repo://openhands/storage/__init__.py#L14-L31)

| `file_store` | Class | Notes |
| --- | --- | --- |
| `local` | `LocalFileStore` | Requires `file_store_path`; expands a leading `~`, creates the root and parent directories on write; `list` appends `/` to directories |
| `s3` | `S3FileStore` | Bucket from the path argument or `AWS_S3_BUCKET`; credentials, `AWS_S3_SECURE` and `AWS_S3_ENDPOINT` from the environment |
| `google_cloud` | `GoogleCloudFileStore` | Bucket from the path argument or `GOOGLE_CLOUD_BUCKET_NAME` |
| anything else | `InMemoryFileStore` | A dictionary of path to text; nothing survives the process |

Sources: [openhands/storage/__init__.py:21-31](repo://openhands/storage/__init__.py#L21-L31), [openhands/storage/local.py:8-53](repo://openhands/storage/local.py#L8-L53), [openhands/storage/s3.py:22-45](repo://openhands/storage/s3.py#L22-L45), [openhands/storage/google_cloud.py:12-22](repo://openhands/storage/google_cloud.py#L12-L22), [openhands/storage/memory.py:7-50](repo://openhands/storage/memory.py#L7-L50)

When `file_store_web_hook_url` is set, the chosen store is wrapped. `WebHookFileStore` performs every write and delete on the underlying store first and then submits an HTTP notification to the executor. `BatchedWebHookFileStore` instead collects updates and sends them together after 5 seconds or 1 MB, whichever comes first. If no headers are configured, the wrapper sends `X-Session-API-Key` from the `SESSION_API_KEY` environment variable when it is defined.

Sources: [openhands/storage/__init__.py:32-57](repo://openhands/storage/__init__.py#L32-L57), [openhands/storage/web_hook.py:8-50](repo://openhands/storage/web_hook.py#L8-L50), [openhands/storage/batched_web_hook.py:11-45](repo://openhands/storage/batched_web_hook.py#L11-L45)

## Where conversation data lives

`locations.py` is the single source of file names. A conversation's directory is `sessions/<sid>/` for a single-user setup and `users/<user_id>/conversations/<sid>/` when there is a user id. Under it are `events/<id>.json` and `event_cache/` (see [[Events and the Event Stream]]), `metadata.json`, `init.json`, `agent_state.pkl` (the pickled `State` from the [[Agent Controller Loop]]), `llm_registry.json`, `conversation_stats.pkl` and `exp_config.json`.

Sources: [openhands/storage/locations.py:1-42](repo://openhands/storage/locations.py#L1-L42)

`ConversationStats` keeps the per-service `Metrics` of the [[LLM Layer]] and writes them to the stats file; it combines restored metrics with those of currently registered services so a restart loses nothing.

Sources: [openhands/server/services/conversation_stats.py:14-60](repo://openhands/server/services/conversation_stats.py#L14-L60)

## Settings, secrets and conversation stores

Each of the three interfaces is an `ABC` with an async `get_instance(config, user_id)` class method, and each says in its docstring that an application can replace it by setting the matching class name in `server_config` (`settings_store_class`, `secret_store_class`, `conversation_store_class`); [[Server, Conversations and Sessions]] shows where `get_impl` resolves them.

Sources: [openhands/server/config/server_config.py:16-32](repo://openhands/server/config/server_config.py#L16-L32)

| Interface | Methods | File-backed implementation |
| --- | --- | --- |
| `SettingsStore` | `load`, `store` | `FileSettingsStore`, a `settings.json` file |
| `SecretsStore` | `load`, `store` | `FileSecretsStore`, a `secrets.json` file; provider tokens without a token value are dropped on load |
| `ConversationStore` | `save_metadata`, `get_metadata`, `delete_metadata`, `exists`, `search`, `validate_metadata`, `get_all_metadata` | `FileConversationStore`, which writes each conversation's `metadata.json` |

Sources: [openhands/storage/settings/settings_store.py:9-36](repo://openhands/storage/settings/settings_store.py#L9-L36), [openhands/storage/secrets/secrets_store.py:9-36](repo://openhands/storage/secrets/secrets_store.py#L9-L36), [openhands/storage/conversation/conversation_store.py:14-71](repo://openhands/storage/conversation/conversation_store.py#L14-L71), [openhands/storage/settings/file_settings_store.py:14-43](repo://openhands/storage/settings/file_settings_store.py#L14-L43), [openhands/storage/secrets/file_secrets_store.py:14-49](repo://openhands/storage/secrets/file_secrets_store.py#L14-L49)

The file settings and secrets stores serialize with `expose_secrets` on, so the stored JSON contains the real key values; the in-memory model hides them as `SecretStr`. `FileConversationStore.get_metadata` treats a file without `created_at` as not found. `search` lists the directory, loads each metadata file (skipping unreadable ones with a warning), sorts newest first and pages through them with an offset-based page id.

Sources: [openhands/storage/settings/file_settings_store.py:28-30](repo://openhands/storage/settings/file_settings_store.py#L28-L30), [openhands/storage/conversation/file_conversation_store.py:37-96](repo://openhands/storage/conversation/file_conversation_store.py#L37-L96)

`ConversationMetadata` records the id, repository, branch, git provider, title, last-updated and created times, how the conversation was triggered (`gui`, `suggested_task`, `resolver`, `openhands_api`, `slack`, `microagent_management`, Jira or Linear), the PR numbers the agent opened and cost and token totals.

Sources: [openhands/storage/data_models/conversation_metadata.py:8-37](repo://openhands/storage/data_models/conversation_metadata.py#L8-L37)

## Settings and secrets models

`Settings` holds what the settings screens edit: language, agent, `max_iterations`, `security_analyzer`, `confirmation_mode`, `llm_model`, `llm_api_key`, `llm_base_url`, the default condenser switch and `condenser_max_size`, sandbox images, `mcp_config`, `search_api_key`, `max_budget_per_task`, and git user name and email. `WebSession.initialize_agent` is where these override the config for a conversation.

Sources: [openhands/storage/data_models/settings.py:21-51](repo://openhands/storage/data_models/settings.py#L21-L51), [openhands/server/session/session.py:132-212](repo://openhands/server/session/session.py#L132-L212)

`UserSecrets` holds `provider_tokens` (the `ProviderToken` map from [[Git Provider Integrations and Resolver]]) and `custom_secrets`. It can register its values as event-stream secrets, produce environment variables for the sandbox and list the custom secrets' descriptions for the agent.

Sources: [openhands/storage/data_models/user_secrets.py:26-36](repo://openhands/storage/data_models/user_secrets.py#L26-L36), [openhands/storage/data_models/user_secrets.py:142-164](repo://openhands/storage/data_models/user_secrets.py#L142-L164)

## User authentication

`UserAuth` is the request-scoped interface the routes depend on: `get_user_id`, `get_user_email`, `get_access_token`, `get_provider_tokens`, the settings and secrets stores and their loaded values, `get_auth_type` and a `get_instance(request)` factory. `DefaultUserAuth` is the single-user implementation: user id, email and token are always `None`, and it builds the stores through `shared.SettingsStoreImpl` and `shared.SecretsStoreImpl`, caching them. When it loads settings it merges them with the `config.toml` values (`merge_with_config_settings`).

Sources: [openhands/server/user_auth/user_auth.py:18-80](repo://openhands/server/user_auth/user_auth.py#L18-L80), [openhands/server/user_auth/default_user_auth.py:18-94](repo://openhands/server/user_auth/default_user_auth.py#L18-L94)

`ConversationValidator` is the same kind of hook for sockets: `create_conversation_validator()` returns an implementation whose `validate` decides which user may connect to a conversation ([[Server, Conversations and Sessions]]).

Sources: [openhands/storage/conversation/conversation_validator.py:13-40](repo://openhands/storage/conversation/conversation_validator.py#L13-L40)
