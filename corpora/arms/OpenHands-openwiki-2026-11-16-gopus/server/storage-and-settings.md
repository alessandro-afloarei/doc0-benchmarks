---
type: subsystem
title: Storage, Settings, Secrets, and Auth Extension Points
description: How the OpenHands server persists data and identifies users — FileStore backends and webhooks, conversation metadata, settings and secrets stores, user authentication, the session API key, and the ServerConfig/get_impl class-loading seams that let deployments such as the enterprise SaaS replace each piece.
tags: [storage, settings, secrets, authentication, extension-points, server-config]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-6855f5cb740a117f0ec89b40
    resource: repo://openhands/server/dependencies.py
  - id: openwiki-source-88be4e444237a3309881b53c
    resource: repo://openhands/server/routes/settings.py
  - id: openwiki-source-7e3b4bedad14af18fc5d861e
    resource: repo://openhands/server/shared.py
  - id: openwiki-source-e6edead93b3c17764753cbdb
    resource: repo://openhands/server/user_auth/default_user_auth.py
  - id: openwiki-source-a80e9a1da1515233f9c7a139
    resource: repo://openhands/server/user_auth/user_auth.py
  - id: openwiki-source-3627b67e8337b522b301f047
    resource: repo://openhands/storage/__init__.py
  - id: openwiki-source-2c04600c29d2c5701b2c02fd
    resource: repo://openhands/storage/conversation/conversation_validator.py
  - id: openwiki-source-1aabfc60e3a12549b20907d4
    resource: repo://openhands/storage/conversation/file_conversation_store.py
  - id: openwiki-source-4cb874318cf2686cfbc9b2b2
    resource: repo://openhands/storage/data_models/settings.py
  - id: openwiki-source-d5332d718f6cd21e525b683b
    resource: repo://openhands/storage/secrets/file_secrets_store.py
  - id: openwiki-source-7208fb274b31c2db7c97c202
    resource: repo://openhands/storage/settings/file_settings_store.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Storage, Settings, Secrets, and Auth Extension Points

The OSS server is single-user and file-backed. Multi-tenant deployments ([Enterprise](../enterprise/saas-server.md)) swap in their own implementations through **class-loading seams** rather than forking the code. This page describes those seams and the default implementations.

## Process-wide wiring (`openhands/server/shared.py`)

When it is imported, `shared.py` builds the server's singletons:

- `config = load_openhands_config()` ([Configuration System](../configuration/config-system.md))
- `server_config = load_server_config()`, which instantiates the class named by `OPENHANDS_CONFIG_CLS`. The default is `ServerConfig`.
- `file_store = get_file_store(...)`
- `sio = socketio.AsyncServer(...)`. It uses a Redis client manager when `REDIS_HOST` is set, so multiple replicas can share Socket.IO rooms, and has a 4 MB buffer for file uploads.
- `MonitoringListenerImpl`, `ConversationManagerImpl` (plus its instance), `SettingsStoreImpl`, `SecretsStoreImpl`, and `ConversationStoreImpl`. Each one is resolved with `get_impl(BaseClass, server_config.<x>_class)`.

### `ServerConfig` seams

| Attribute | OSS default |
| --- | --- |
| `settings_store_class` | `openhands.storage.settings.file_settings_store.FileSettingsStore` |
| `secret_store_class` | `openhands.storage.secrets.file_secrets_store.FileSecretsStore` |
| `conversation_store_class` | `openhands.storage.conversation.file_conversation_store.FileConversationStore` |
| `conversation_manager_class` | `StandaloneConversationManager` (or `CONVERSATION_MANAGER_CLASS`) |
| `monitoring_listener_class` | `openhands.server.monitoring.MonitoringListener` |
| `user_auth_class` | `openhands.server.user_auth.default_user_auth.DefaultUserAuth` |

`ServerConfig` also sets `app_mode` (`OSS` or `SAAS`) and feature flags (`ENABLE_BILLING`, `HIDE_LLM_SETTINGS`). `get_config()` returns these to the frontend through `GET /api/options/config` ([Frontend](../frontend/web-ui.md)).

Seams outside `ServerConfig`, all loaded through environment variables:

- `OPENHANDS_CONVERSATION_VALIDATOR_CLS`: `ConversationValidator`, which checks Socket.IO connections to a conversation.
- `OPENHANDS_GITHUB_SERVICE_CLS`, `OPENHANDS_GITLAB_SERVICE_CLS`, `OPENHANDS_BITBUCKET_SERVICE_CLS`: provider services ([Git Providers](../integrations/git-providers.md)).
- `OPENHANDS_MCP_CONFIG_CLS`: default MCP servers ([MCP](../integrations/mcp.md)).
- `runtime` classpaths ([Runtime Implementations](../runtime/runtime-implementations.md)).

## FileStore

`FileStore` (`openhands/storage/files.py`) is a minimal key/value interface: `write`, `read`, `list`, `delete`. `get_file_store(type, path, webhook_url, webhook_headers, webhook_batch)` builds one:

| `file_store` | Class | Notes |
| --- | --- | --- |
| `local` (default) | `LocalFileStore` | Rooted at `file_store_path` (default `~/.openhands`, with `~` expanded). Creates directories as needed. |
| `s3` | `S3FileStore` | Bucket from `file_store_path` or `AWS_S3_BUCKET`. Credentials and endpoint from `AWS_*` env vars (MinIO-compatible). |
| `google_cloud` | `GoogleCloudFileStore` | GCS bucket |
| anything else, e.g. `memory` | `InMemoryFileStore` | For tests and ephemeral runs |

When `file_store_web_hook_url` is set, the store is wrapped in `WebHookFileStore`, or in `BatchedWebHookFileStore` when batching is on. The wrapper mirrors every write and delete to an HTTP endpoint. By default it sends the `X-Session-API-Key` header from `SESSION_API_KEY`. Nested runtimes use this to stream conversation files back to the SaaS control plane.

Path layout comes from `openhands/storage/locations.py`. A conversation lives under `sessions/{sid}/`, or `users/{user_id}/conversations/{sid}/` when there is a user id. It holds `events/`, `event_cache/`, `metadata.json`, `init.json`, `agent_state.pkl`, `conversation_stats.pkl`, and `TASKS.md` ([Event Stream](../architecture/event-stream.md#storage-layout)).

## Conversation metadata

`ConversationStore` (`storage/conversation/conversation_store.py`) has `save_metadata`, `get_metadata`, `delete_metadata`, `exists`, `search(page_id, limit)`, `get_all_metadata`, `validate_metadata`, and `get_instance(config, user_id)`. `ConversationMetadata` (`storage/data_models/conversation_metadata.py`) records:

- the conversation id and owner `user_id`;
- `selected_repository`, `selected_branch`, `git_provider`;
- `title`, `trigger` (`gui`, `suggested_task`, `resolver`, `openhands_api`, `slack`, `jira`, `linear`, `microagent_management`, and so on), `pr_number`s;
- `created_at` and `last_updated_at`;
- `llm_model` and accumulated cost and tokens.

`FileConversationStore` writes the metadata as JSON to `sessions/{id}/metadata.json`. `search` lists every directory under `sessions/`, loads and sorts the entries (newest first), and pages with an opaque offset token. Directories that can't be loaded are skipped with a warning.

## Settings and secrets

- **`Settings`** (`openhands/storage/data_models/settings.py`, also exposed as `openhands.server.settings`) holds per-user preferences: language, agent, max iterations and budget, `security_analyzer`, `confirmation_mode`, `llm_model`, `llm_api_key`, `llm_base_url`, runtime resource factor, sandbox images, `mcp_config`, `search_api_key`, `sandbox_api_key`, condenser options (`enable_default_condenser`, `condenser_max_size`), git user name and email, and UI and analytics flags. Secret fields serialize as `**********` unless the serialization context has `expose_secrets=True`. `Settings.from_config()` derives defaults from `config.toml` when an LLM API key is configured. `merge_with_config_settings()` merges MCP servers from `config.toml` into the stored settings, with `config.toml` taking priority.
- **`UserSecrets`** (`storage/data_models/user_secrets.py`) holds immutable `provider_tokens` (git tokens with host) and `custom_secrets` (name → value + description). Custom secrets are exported to the sandbox and masked in events. Their descriptions go to the agent through workspace context ([Microagents/Memory](../architecture/memory-and-condensers.md#memory-recall-and-microagents)).
- **Stores:** `SettingsStore` and `SecretsStore` (abstract `load`, `store`, `get_instance`). The file implementations write `settings.json` and `secrets.json` at the root of the file store **with secrets exposed in plaintext**, so protect `~/.openhands` accordingly. The CLI uses the same `FileSettingsStore` ([CLI](../interfaces/cli.md)).

### Routes

- `openhands/server/routes/settings.py` (prefix `/api`):
  - `GET /settings` returns settings with secrets redacted, plus `llm_api_key_set` and `provider_tokens_set` flags (provider → host).
  - `POST /settings` merges the request into the existing stored settings (keeping fields like analytics consent when omitted) and stores the result.
  - `POST /reset-settings` returns 410 Gone.
- `openhands/server/routes/secrets.py` (prefix `/api`): `POST /add-git-providers`, `POST /unset-provider-tokens`, and CRUD on `/secrets` (`GET`, `POST`, `PUT /secrets/{id}`, `DELETE /secrets/{id}`). Listing returns names and descriptions only.

## User authentication

`UserAuth` (`openhands/server/user_auth/user_auth.py`) is the per-request identity: `get_user_id`, `get_user_email`, `get_access_token`, `get_provider_tokens`, `get_user_settings(_store)`, `get_secrets_store`, `get_user_secrets`, `get_auth_type`, and the classmethod `get_instance(request)`. `get_user_auth(request)` resolves `server_config.user_auth_class` and caches the instance on `request.state.user_auth`. FastAPI dependencies in `user_auth/__init__.py` (`get_user_id`, `get_provider_tokens`, `get_user_settings`, …) are used throughout the routes.

`DefaultUserAuth` is single-tenant. `user_id`, email, and access token are always `None`. Settings and secrets come from the file stores, and provider tokens come from the stored `UserSecrets`.

### Session API key

When the `SESSION_API_KEY` env var is set, `get_dependencies()` (`openhands/server/dependencies.py`) adds a dependency to every router that requires a matching `X-Session-API-Key` header and returns 401 otherwise. This is how a server running *inside* a sandbox (nested conversations) is protected. When the variable is unset, the local OSS server needs no API key.

## Related pages

- [Web Server, Sessions, and Conversation Management](web-server.md)
- [Enterprise (SaaS) Server](../enterprise/saas-server.md)
- [Events and the Event Stream](../architecture/event-stream.md)
- [Configuration System](../configuration/config-system.md)
