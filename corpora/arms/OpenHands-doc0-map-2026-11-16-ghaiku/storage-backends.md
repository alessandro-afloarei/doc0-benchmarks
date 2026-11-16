---
title: "Storage Backends"
---
## Overview

Everything the server persists goes through one small interface, `FileStore`: write, read, list and delete a path. The backends behind it are local disk, memory, S3, Google Cloud Storage, and two webhook wrappers. Above the file store, the conversation, settings and secrets stores decide which paths hold what, and `locations.py` builds those paths. The event store in [[Events and the Event Stream]] is one of the clients of this layer.

Sources: [openhands/storage/files.py:4-19](repo://openhands/storage/files.py#L4-L19)

## The file store contract

`FileStore` declares four methods: `write` takes a path and string or bytes, `read` returns the stored text, `list` returns the entries under a path, and `delete` removes a path. A backend implements those four and nothing else.

Sources: [openhands/storage/files.py:4-19](repo://openhands/storage/files.py#L4-L19)

## Choosing a backend

`get_file_store` picks the backend by name. `local` requires a path and uses the disk. `s3` and `google_cloud` take the path argument as their bucket or location. Any other name falls back to the in-memory store. When a webhook URL is set, the chosen store is wrapped in a webhook store, which is batched when batch mode is on. The wrapper sends the session API key as a header when one is set in the environment.

Sources: [openhands/storage/__init__.py:14-31](repo://openhands/storage/__init__.py#L14-L31) [openhands/storage/__init__.py:32-45](repo://openhands/storage/__init__.py#L32-L45)

## The backends

| Backend | Class | Where the bytes go | Source |
| --- | --- | --- | --- |
| Local disk | `LocalFileStore` | A directory, created on start, with `~` expanded | [openhands/storage/local.py:8-20](repo://openhands/storage/local.py#L8-L20) |
| Memory | `InMemoryFileStore` | A dictionary held by the process | [openhands/storage/memory.py:7-12](repo://openhands/storage/memory.py#L7-L12) |
| S3 | `S3FileStore` | An S3 bucket named by the constructor | [openhands/storage/s3.py:22-38](repo://openhands/storage/s3.py#L22-L38) |
| Google Cloud | `GoogleCloudFileStore` | A Google Cloud Storage bucket | [openhands/storage/google_cloud.py:12-20](repo://openhands/storage/google_cloud.py#L12-L20) |
| Webhook | `WebHookFileStore` | Wraps another store and notifies a URL when a file is written | [openhands/storage/web_hook.py:8-40](repo://openhands/storage/web_hook.py#L8-L40) |
| Batched webhook | `BatchedWebHookFileStore` | Wraps another store and queues updates before sending them | [openhands/storage/batched_web_hook.py:16-46](repo://openhands/storage/batched_web_hook.py#L16-L46) |

Sources: [openhands/storage/local.py:8-20](repo://openhands/storage/local.py#L8-L20) [openhands/storage/memory.py:7-12](repo://openhands/storage/memory.py#L7-L12) [openhands/storage/s3.py:22-38](repo://openhands/storage/s3.py#L22-L38) [openhands/storage/google_cloud.py:12-20](repo://openhands/storage/google_cloud.py#L12-L20) [openhands/storage/web_hook.py:8-40](repo://openhands/storage/web_hook.py#L8-L40) [openhands/storage/batched_web_hook.py:16-46](repo://openhands/storage/batched_web_hook.py#L16-L46)

## Paths

`get_conversation_dir` builds the folder of one conversation. With a user id the path sits under `users/<user>/conversations/<sid>/`, and without one it sits under the shared conversation base directory. Functions such as `get_conversation_event_filename` and `get_conversation_metadata_filename` name the files inside that folder.

Sources: [openhands/storage/locations.py:4-10](repo://openhands/storage/locations.py#L4-L10) [openhands/storage/locations.py:11-20](repo://openhands/storage/locations.py#L11-L20) [openhands/storage/locations.py:21-42](repo://openhands/storage/locations.py#L21-L42)

## Stores on top

`FileConversationStore` saves, loads, deletes, checks and searches conversation metadata through the file store. `FileSettingsStore` and `FileSecretsStore` keep the user's settings and secrets in the same way. Each one implements an abstract store class: `ConversationStore`, `SettingsStore` and `SecretsStore`.

Sources: [openhands/storage/conversation/file_conversation_store.py:29-70](repo://openhands/storage/conversation/file_conversation_store.py#L29-L70) [openhands/storage/settings/file_settings_store.py:15-16](repo://openhands/storage/settings/file_settings_store.py#L15-L16) [openhands/storage/secrets/file_secrets_store.py:15-16](repo://openhands/storage/secrets/file_secrets_store.py#L15-L16)
