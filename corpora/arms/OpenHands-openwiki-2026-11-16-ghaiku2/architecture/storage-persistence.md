---
type: architecture-component
title: Storage, Persistence, and Secrets
description: The FileStore abstraction and its local, in-memory, S3, Google Cloud, and webhook backends; the on-disk layout of conversations, events, and per-user settings and secrets; the conversation, settings, and secrets store interfaces and their file implementations; and what is and is not protected at rest.
tags: [storage, file-store, persistence, conversations, settings, secrets, s3, google-cloud, webhook, data-layout]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-3627b67e8337b522b301f047
    resource: repo://openhands/storage/__init__.py
  - id: openwiki-source-098665abffae2aa96cc5f110
    resource: repo://openhands/storage/data_models/user_secrets.py
  - id: openwiki-source-6edab453316a5e90be94659a
    resource: repo://openhands/storage/files.py
  - id: openwiki-source-c7fbc0bab8bf4b6a1164a01c
    resource: repo://openhands/storage/locations.py
  - id: openwiki-source-97985104444e860a7acfea31
    resource: repo://openhands/storage/s3.py
  - id: openwiki-source-d5332d718f6cd21e525b683b
    resource: repo://openhands/storage/secrets/file_secrets_store.py
  - id: openwiki-source-7208fb274b31c2db7c97c202
    resource: repo://openhands/storage/settings/file_settings_store.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Storage, Persistence, and Secrets

Everything OpenHands needs to remember between requests and between process restarts goes through one small abstraction, `FileStore` (`openhands/storage/files.py`). Conversation metadata, the event log, agent state, settings, and secrets are all written as files through it. The backend is chosen by configuration, so the same code runs against a local directory, memory, or a cloud bucket.

## FileStore abstraction

`FileStore` (`openhands/storage/files.py`) is the interface with four methods: `write(path, contents)`, `read(path)`, `list(path)`, and `delete(path)`. Paths are slash-separated keys, not OS paths.

Backends (`openhands/storage/`):

- `LocalFileStore` (`local.py`) maps keys to files under a root directory. The root expands `~` and is created if missing. Absolute keys are resolved under the root.
- `InMemoryFileStore` (`memory.py`) keeps everything in process memory. It is the fallback for any `file_store` value that is not `local`, `s3`, or `google_cloud`.
- `S3FileStore` (`s3.py`) stores objects in an S3 bucket. The bucket defaults to the `AWS_S3_BUCKET` environment variable. Access-denied errors are reported with the bucket name.
- `GoogleCloudFileStore` (`google_cloud.py`) stores blobs in a Google Cloud Storage bucket.
- `WebHookFileStore` (`web_hook.py`) wraps any other store and posts each write to a configured URL. `BatchedWebHookFileStore` (`batched_web_hook.py`) batches those posts. The `X-Session-API-Key` header is set from `SESSION_API_KEY` when no headers are configured.

<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`get_file_store` (`openhands/storage/__init__.py`, ~L14-L60) selects the backend from `config.file_store` (`local`, `s3`, `google_cloud`, or anything else for memory) and `config.file_store_path`, then applies the webhook wrapper if a URL is set. The defaults are `file_store = local` and `file_store_path = ~/.openhands` (see [Configuration Model](/openwiki/architecture/configuration.md)).

## On-disk layout

Key construction is centralized in `openhands/storage/locations.py`:

- Conversations live under `sessions/<sid>/` without a user, or under `users/<user_id>/conversations/<sid>/` with one (`get_conversation_dir`, ~L4-L8).
- Inside a conversation directory:
  - `events/<id>.json` for each event (`get_conversation_event_filename`, ~L15-L18);
  - `metadata.json` for conversation metadata;
  - `init.json` for the initial settings;
  - `agent_state.pkl` for the pickled agent state;
  - `llm_registry.json` and `conversation_stats.pkl` for metrics;
  - `exp_config.json` for experiment assignment.
- Settings are stored at `settings.json` and secrets at `secrets.json` at the root of the file store (`FileSettingsStore.path` and `FileSecretsStore.path`).

<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The event files and cache pages are described in [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md). Because events are individual files, a conversation's full history can be read back from storage without the process that produced it.

## Store interfaces

Three abstract stores sit above the file store. Each has an async `get_instance` factory that builds the file-backed implementation from config.

<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`ConversationStore`** (`openhands/storage/conversation/conversation_store.py`, class at ~L14) saves and loads `ConversationMetadata`, checks that a user owns a conversation (`validate_metadata`), deletes it, checks existence, and searches and pages through conversations (`search`, `get_all_metadata`). `FileConversationStore` (`file_conversation_store.py`, class at ~L29) implements it on the file store, with metadata under `sessions/` or `users/<id>/conversations/` and sorting by last update (`_sort_key`, ~L118). `get_instance` (~L105) builds the file store from config. A `conversation_validator` (`conversation_validator.py`) uses the store to authorize socket connections (see [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md)).
- **`SettingsStore`** (`openhands/storage/settings/settings_store.py`, class at ~L9) loads and stores `Settings`, the persisted per-user options for sessions (for example `language`). `FileSettingsStore` writes JSON to `settings.json`.
- **`SecretsStore`** (`openhands/storage/secrets/secrets_store.py`, class at ~L9) loads and stores `UserSecrets`, which hold provider tokens and custom secrets. `FileSecretsStore` (`file_secrets_store.py`, class at ~L15) writes JSON to `secrets.json`.

`UserSecrets` (`openhands/storage/data_models/user_secrets.py`, class at ~L26) serializes provider tokens and custom secret values only when the serialization context asks for exposed secrets (~L46-L62, ~L78-L84). Its `load` and `store` paths use that flag.

The enterprise SaaS layer provides its own settings and secrets stores (`enterprise/storage/saas_settings_store.py` and `saas_secrets_store.py`) in place of the file-backed ones.

## Protection at rest

The file-backed secrets store does not encrypt. `FileSecretsStore.store` writes `UserSecrets` as JSON with `expose_secrets` set (`file_secrets_store.py` ~L34-L36), so provider tokens and custom secret values are plain text in `secrets.json` on whichever backend is configured. Access control therefore depends on the storage location: file permissions for the local store, bucket policy for S3 and Google Cloud, and whatever the webhook receiver does with the posted contents. The in-memory backend keeps the values only for the process lifetime.

<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Secrets are protected in transit to the sandbox and in the event log by the redaction described in [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md) and [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md). Those protections do not apply to the stored secrets file itself.

The enterprise Jira Data Center integration store takes its webhook secret and service-account key as values already encrypted by the caller (`enterprise/storage/jira_dc_integration_store.py`), so encryption for that integration is handled outside the OSS store path.

## Invariants and failure behavior

- A key is always relative to the store root, and a store operation is a single whole-file write or read. There are no partial-update semantics.
- Event files are written once and never modified. The event ID is the file name.
- A missing settings or secrets file loads as `None` (`FileNotFoundError` is caught in both `load` methods), and the caller uses defaults.

## Extension seams

- A new backend is a `FileStore` subclass, added to the selection in `get_file_store`.
- A new metadata or settings backend is a subclass of the abstract store, with a `get_instance` factory.
- Enterprise and SaaS deployments replace the stores with database-backed implementations.

## Representative tests

- `tests/unit/storage/` (6 test files) covers the file store and the conversation, settings, and secrets stores.
- `enterprise/tests/unit/test_saas_secrets_store.py` covers the SaaS secrets store.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Configuration Model](/openwiki/architecture/configuration.md)
<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md)
<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md)
<!-- openwiki: broken internal link [/openwiki/enterprise/saas-platform.md] link "/openwiki/enterprise/saas-platform.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Enterprise SaaS Platform](/openwiki/enterprise/saas-platform.md)
