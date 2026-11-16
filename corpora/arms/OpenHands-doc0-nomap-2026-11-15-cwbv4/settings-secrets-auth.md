---
title: "Settings, Secrets and User Auth"
---
## Overview

In the web application, what the user picks in the settings screen, such as the model and API key, the agent, confirmation mode or the sandbox image, is stored per user as `Settings`. Credentials are kept apart in `UserSecrets`: tokens for git providers, and named custom secrets that the agent receives as environment variables. Both are read and written through the REST API, and every route finds the current user's stores through a `UserAuth` object, which is how the same routes serve one local user in OSS mode and many users in the cloud.

Sources: [openhands/storage/data_models/settings.py:21-55](repo://openhands/storage/data_models/settings.py#L21-L55), [openhands/storage/data_models/user_secrets.py:24-36](repo://openhands/storage/data_models/user_secrets.py#L24-L36), [openhands/server/user_auth/user_auth.py:24-94](repo://openhands/server/user_auth/user_auth.py#L24-L94)

The files behind these stores are on [[Storage]]; how settings reach a running conversation is on [[Sessions and Socket.IO]].

Sources: [openhands/server/session/session.py:132-152](repo://openhands/server/session/session.py#L132-L152)

## Settings

### Fields

`Settings` is a Pydantic model whose fields are all optional overrides of the server config:

Sources: [openhands/storage/data_models/settings.py:21-31](repo://openhands/storage/data_models/settings.py#L21-L31)

| Group | Fields |
| --- | --- |
| Agent and LLM | `agent`, `llm_model`, `llm_api_key`, `llm_base_url`, `max_iterations`, `max_budget_per_task` |
| Safety | `confirmation_mode`, `security_analyzer` |
| Context | `enable_default_condenser`, `condenser_max_size` (at least 20) |
| Sandbox | `sandbox_base_container_image`, `sandbox_runtime_container_image`, `sandbox_api_key`, `remote_runtime_resource_factor` |
| Tools | `mcp_config`, `search_api_key` |
| Git | `git_user_name`, `git_user_email` |
| UI and account | `language`, `enable_sound_notifications`, `enable_proactive_conversation_starters`, `enable_solvability_analysis`, `user_consents_to_analytics`, `email`, `email_verified` |

Sources: [openhands/storage/data_models/settings.py:21-55](repo://openhands/storage/data_models/settings.py#L21-L55), [openhands/storage/data_models/settings.py:113-120](repo://openhands/storage/data_models/settings.py#L113-L120)

### Secret fields

API keys are `SecretStr`. When serialised they appear masked unless the serialisation context has `expose_secrets`, which only the stores use when writing; empty keys serialise as null. The model still carries a legacy `secrets_store` field from before secrets had their own store; it always serialises as empty.

Sources: [openhands/storage/data_models/settings.py:57-75](repo://openhands/storage/data_models/settings.py#L57-L75), [openhands/storage/data_models/settings.py:122-126](repo://openhands/storage/data_models/settings.py#L122-L126)

### Defaults from config.toml

`Settings.from_config` builds settings from the server's config file, or returns nothing when the default LLM has no API key. `merge_with_config_settings` merges the file's MCP servers into the stored settings, the file taking priority, so servers configured by the operator are always present. `DefaultUserAuth` applies this merge every time it loads settings.

Sources: [openhands/storage/data_models/settings.py:128-186](repo://openhands/storage/data_models/settings.py#L128-L186), [openhands/server/user_auth/default_user_auth.py:49-61](repo://openhands/server/user_auth/default_user_auth.py#L49-L61)

### Routes

`GET /api/settings` returns 404 when nothing is stored, which the frontend takes as the cue to show first-run setup. Otherwise it returns the settings without the key values and with `llm_api_key_set`, `search_api_key_set` and `provider_tokens_set` (each provider with its host) instead, so the browser learns what is configured without receiving the keys.

Sources: [openhands/server/routes/settings.py:28-88](repo://openhands/server/routes/settings.py#L28-L88), [openhands/server/settings.py:28-36](repo://openhands/server/settings.py#L28-L36)

`POST /api/settings` stores new settings, keeping the stored LLM key, model, base URL, search key and analytics consent when the request leaves them out, so the UI can save other fields without resending the key. It also updates the server's global `remote_runtime_resource_factor` and git user, which apply to sessions started afterwards. `/api/reset-settings` answers 410.

Sources: [openhands/server/routes/settings.py:90-131](repo://openhands/server/routes/settings.py#L90-L131), [openhands/server/routes/settings.py:133-193](repo://openhands/server/routes/settings.py#L133-L193)

## Secrets

### UserSecrets

`UserSecrets` is a frozen model of two read-only maps: `provider_tokens`, from `ProviderType` (GitHub, GitLab, Bitbucket) to a `ProviderToken` with token, host and provider user id; and `custom_secrets`, from a name to a `CustomSecret` with value and description. Like settings, it serialises values only with `expose_secrets`; when loading, unknown provider names and invalid entries are skipped.

Sources: [openhands/storage/data_models/user_secrets.py:24-138](repo://openhands/storage/data_models/user_secrets.py#L24-L138)

At conversation start, custom secrets become environment variables named after the secret (`get_env_vars`), their values are registered with the event stream for masking (`set_event_stream_secrets`), and their names and descriptions are listed in the agent's workspace context so it knows they exist without seeing them.

Sources: [openhands/storage/data_models/user_secrets.py:140-164](repo://openhands/storage/data_models/user_secrets.py#L140-L164), [openhands/server/session/agent_session.py:130-150](repo://openhands/server/session/agent_session.py#L130-L150), [openhands/server/session/agent_session.py:317-320](repo://openhands/server/session/agent_session.py#L317-L320)

### Git provider tokens

`POST /api/add-git-providers` validates each new token against its provider (and re-validates a stored token when only the host changed), answering 401 with a message on a mismatch. It then merges the tokens into the stored secrets, keeping the stored token for a provider whose request omits it so the host can be edited alone. `POST /api/unset-provider-tokens` removes all provider tokens. How tokens are used is on [[Git Provider Integrations]].

Sources: [openhands/server/routes/secrets.py:57-101](repo://openhands/server/routes/secrets.py#L57-L101), [openhands/server/routes/secrets.py:103-182](repo://openhands/server/routes/secrets.py#L103-L182)

When settings are loaded, `invalidate_legacy_secrets_store` moves provider tokens still kept in the old `secrets_store` field of settings into the secrets store, once, and clears them from settings.

Sources: [openhands/server/routes/secrets.py:33-55](repo://openhands/server/routes/secrets.py#L33-L55)

### Custom secrets

| Route | Behaviour |
| --- | --- |
| `GET /api/secrets` | names and descriptions only, never values |
| `POST /api/secrets` | add a secret; 400 if the name exists |
| `PUT /api/secrets/{id}` | rename or change the description, keeping the value |
| `DELETE /api/secrets/{id}` | remove a secret |

Sources: [openhands/server/routes/secrets.py:184-260](repo://openhands/server/routes/secrets.py#L184-L260), [openhands/server/routes/secrets.py:260-350](repo://openhands/server/routes/secrets.py#L260-L350)

## User authentication

### UserAuth

`UserAuth` is the per-request view of the current user. It provides the user id and email, an access token, the provider tokens, the settings store and settings, the secrets store and secrets, and the auth type (`cookie` or `bearer`). `get_user_auth(request)` creates it once per request from `server_config.user_auth_class` and caches it on `request.state`. Small dependency functions such as `get_user_id`, `get_provider_tokens`, `get_user_settings` and `get_secrets_store` wrap it, and routes declare them with `Depends`.

Sources: [openhands/server/user_auth/user_auth.py:19-94](repo://openhands/server/user_auth/user_auth.py#L19-L94), [openhands/server/user_auth/__init__.py:12-56](repo://openhands/server/user_auth/__init__.py#L12-L56)

### DefaultUserAuth

The OSS implementation assumes one user: the user id, email and access token are all `None`, the settings and secrets stores are the server's configured store classes for that user, and the provider tokens come from the stored secrets. Every request therefore sees the same settings, which is why OSS OpenHands is documented as a single-user application. The [[Enterprise Server]] replaces this class with one that authenticates users through Keycloak.

Sources: [openhands/server/user_auth/default_user_auth.py:17-94](repo://openhands/server/user_auth/default_user_auth.py#L17-L94), [README.md:114-119](repo://README.md#L114-L119)

### Socket connections

Socket.IO connections do not go through `UserAuth`. The connect handler passes the cookies and `Authorization` header to the conversation validator chosen by `OPENHANDS_CONVERSATION_VALIDATOR_CLS`, which returns the user id; the default performs no check.

Sources: [openhands/server/listen_socket.py:66-76](repo://openhands/server/listen_socket.py#L66-L76), [openhands/storage/conversation/conversation_validator.py:13-81](repo://openhands/storage/conversation/conversation_validator.py#L13-L81)
