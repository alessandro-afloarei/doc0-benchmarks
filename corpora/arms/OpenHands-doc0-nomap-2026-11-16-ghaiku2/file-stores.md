---
title: "File Stores and Settings"
---
## Overview

Everything OpenHands keeps between requests goes through one small interface, `FileStore`: a path, a string, and four operations to write, read, list and delete. The events, the agent state, the conversation metadata and the statistics are all written to a file store under a per-conversation directory. Settings, secrets and conversation metadata sit on top of the same store through their own interfaces, and the server picks their implementations by name. This page covers the backends, the paths they write to, and the layers above them. The event log itself is on [[Event Stream]].

Sources: [openhands/storage/files.py:4-19](repo://openhands/storage/files.py#L4-L19), [openhands/storage/locations.py:1-8](repo://openhands/storage/locations.py#L1-L8)

## Choosing a backend

`get_file_store` builds the store from the `file_store` configuration. `local` requires `file_store_path` and writes under that directory, `s3` and `google_cloud` use the path as a bucket name, and any other value gets an in-memory store, which keeps nothing after the process exits. When a web-hook URL is set, the store is wrapped in a web-hook store, and a batched variant is used when batching is on.

Sources: [openhands/storage/__init__.py:14-31](repo://openhands/storage/__init__.py#L14-L31), [openhands/storage/__init__.py:32-55](repo://openhands/storage/__init__.py#L32-L55), [openhands/core/config/openhands_config.py:72-76](repo://openhands/core/config/openhands_config.py#L72-L76)

| Backend | Class | Where it writes | Use it when |
| --- | --- | --- | --- |
| `local` | `LocalFileStore` | A directory on disk, created at start | A single machine, the default |
| `s3` | `S3FileStore` | An S3 bucket, or a compatible service | History must be stored outside the server |
| `google_cloud` | `GoogleCloudFileStore` | A Google Cloud Storage bucket | History must be stored in Google Cloud |
| memory (any other value) | `InMemoryFileStore` | A dictionary in the process | Tests and short runs that need no history |
| web hook | `WebHookFileStore` or `BatchedWebHookFileStore` | Wraps another store and posts each write to a URL | An outside system must see every write |

Sources: [openhands/storage/local.py:8-21](repo://openhands/storage/local.py#L8-L21), [openhands/storage/s3.py:22-38](repo://openhands/storage/s3.py#L22-L38), [openhands/storage/google_cloud.py:12-23](repo://openhands/storage/google_cloud.py#L12-L23), [openhands/storage/memory.py:7-14](repo://openhands/storage/memory.py#L7-L14), [openhands/storage/web_hook.py:8-39](repo://openhands/storage/web_hook.py#L8-L39), [openhands/storage/batched_web_hook.py:16-45](repo://openhands/storage/batched_web_hook.py#L16-L45)

The local store turns a path into a file under its root, removing a leading slash first, so paths written by the rest of the code are always relative to the root. Its root expands `~` and is created on start.

Sources: [openhands/storage/local.py:11-21](repo://openhands/storage/local.py#L11-L21)

The web-hook store forwards each write and delete to the URL with the configured headers, and still writes to the store it wraps. The batched store queues writes and sends them as a group, both on a timer and on demand, and `flush` sends whatever is still queued.

Sources: [openhands/storage/web_hook.py:24-39](repo://openhands/storage/web_hook.py#L24-L39), [openhands/storage/web_hook.py:85-104](repo://openhands/storage/web_hook.py#L85-L104), [openhands/storage/batched_web_hook.py:126-201](repo://openhands/storage/batched_web_hook.py#L126-L201), [openhands/storage/batched_web_hook.py:262-267](repo://openhands/storage/batched_web_hook.py#L262-L267)

## Paths

A conversation's files live under `sessions/<id>/` when no user ID is given, or under `users/<user>/conversations/<id>/` when one is. `locations.py` fixes the names inside that directory: `events/<n>.json` for each event, `metadata.json`, `agent_state.pkl`, `llm_registry.json`, `conversation_stats.pkl` and `exp_config.json`.

Sources: [openhands/storage/locations.py:1-12](repo://openhands/storage/locations.py#L1-L12), [openhands/storage/locations.py:15-42](repo://openhands/storage/locations.py#L15-L42)

These names are what the rest of the code asks for. The agent state is written by [[Agent State and Limits]], and the conversation metadata by the file conversation store, which [[Conversation Lifecycle]] uses. Keeping every path behind a function in `locations.py` means a change of layout touches one file.

Sources: [openhands/storage/locations.py:21-30](repo://openhands/storage/locations.py#L21-L30), [openhands/controller/state/state.py:122-149](repo://openhands/controller/state/state.py#L122-L149)

## Settings, secrets and conversations

`SettingsStore`, `SecretsStore` and `ConversationStore` are abstract classes. `SettingsStore` loads and stores one `Settings` object, `SecretsStore` does the same for `UserSecrets`, and `ConversationStore` saves, reads, searches and deletes conversation metadata. Each has a `get_instance` method that builds it for a user.

Sources: [openhands/storage/settings/settings_store.py:9-36](repo://openhands/storage/settings/settings_store.py#L9-L36), [openhands/storage/secrets/secrets_store.py:9-36](repo://openhands/storage/secrets/secrets_store.py#L9-L36), [openhands/storage/conversation/conversation_store.py:14-71](repo://openhands/storage/conversation/conversation_store.py#L14-L71)

The file implementations, `FileSettingsStore`, `FileSecretsStore` and `FileConversationStore`, keep their data in the file store. The server takes the classes from its configuration through `get_impl`, so a deployment can replace any of them with its own class without changing the server.

Sources: [openhands/storage/settings/file_settings_store.py:15-20](repo://openhands/storage/settings/file_settings_store.py#L15-L20), [openhands/storage/secrets/file_secrets_store.py:15-20](repo://openhands/storage/secrets/file_secrets_store.py#L15-L20), [openhands/storage/conversation/file_conversation_store.py:29-35](repo://openhands/storage/conversation/file_conversation_store.py#L29-L35), [openhands/server/config/server_config.py:16-24](repo://openhands/server/config/server_config.py#L16-L24), [openhands/server/shared.py:70-77](repo://openhands/server/shared.py#L70-L77)

The conversation store keeps one metadata file per conversation, and its search and listing read those files. A listing therefore reads one small file per conversation, not the event files.

Sources: [openhands/storage/conversation/file_conversation_store.py:98-110](repo://openhands/storage/conversation/file_conversation_store.py#L98-L110), [openhands/storage/conversation/conversation_store.py:49-71](repo://openhands/storage/conversation/conversation_store.py#L49-L71)
