---
title: "Storage and Persistence"
---
## Overview

OpenHands keeps everything it must remember between requests in a `FileStore`: conversation events, conversation metadata, the user's settings and the user's secrets. A `FileStore` is a small interface with four operations, read, write, list and delete, over string paths. The backend is chosen by configuration. The stores in this page are thin wrappers that turn each kind of record into one path and one JSON document.

Sources: [openhands/storage/files.py:4-19](repo://openhands/storage/files.py#L4-L19), [openhands/storage/__init__.py:14-31](repo://openhands/storage/__init__.py#L14-L31)

## Backends

`get_file_store` chooses the backend from `file_store`. `local` gives a `LocalFileStore` at `file_store_path`, `s3` gives an `S3FileStore` and `google_cloud` gives a `GoogleCloudFileStore`. Any other value gives an `InMemoryFileStore`, which keeps the files in a dictionary for the life of the process.

Sources: [openhands/storage/__init__.py:14-31](repo://openhands/storage/__init__.py#L14-L31), [openhands/storage/local.py:8-22](repo://openhands/storage/local.py#L8-L22), [openhands/storage/memory.py:7-20](repo://openhands/storage/memory.py#L7-L20)

If a webhook URL is configured, the chosen backend is wrapped. A plain `WebHookFileStore` writes through to the inner store, then submits the notification for each write and delete to a background executor, so the caller does not wait for the webhook. The batched variant collects the changes and sends them together. The webhook is sent with the session API key header when one is set in the environment.

Sources: [openhands/storage/__init__.py:32-57](repo://openhands/storage/__init__.py#L32-L57), [openhands/storage/web_hook.py:8-24](repo://openhands/storage/web_hook.py#L8-L24), [openhands/storage/web_hook.py:85-110](repo://openhands/storage/web_hook.py#L85-L110), [openhands/storage/batched_web_hook.py:16-30](repo://openhands/storage/batched_web_hook.py#L16-L30)

## Paths

Every conversation has a directory. Without a user id it is `sessions/<sid>/`, and with one it is `users/<user_id>/conversations/<sid>/`. Inside it, events are stored one per file as `events/<id>.json`, and the metadata, the initial data, the agent state, the LLM registry and the stats each have a fixed name.

Sources: [openhands/storage/locations.py:1-42](repo://openhands/storage/locations.py#L1-L42)

The event files are read and written by `EventStream`, described in [[Events and the Event Stream]]. The other files in the conversation directory are written by the session and the agent code.

Sources: [openhands/events/stream.py:186-196](repo://openhands/events/stream.py#L186-L196)

## Conversation metadata

`FileConversationStore` saves each conversation's metadata as `metadata.json`, validated against a type adapter. Reading a file without a `created_at` field is treated as a missing conversation. Deleting a conversation removes its whole directory.

Sources: [openhands/storage/conversation/file_conversation_store.py:29-66](repo://openhands/storage/conversation/file_conversation_store.py#L29-L66)

`search` lists the metadata files, sorts them by the sort key, newest first, and returns one page. The page id is an offset that the next call reads back.

Sources: [openhands/storage/conversation/file_conversation_store.py:67-96](repo://openhands/storage/conversation/file_conversation_store.py#L67-L96)

## Settings and secrets

`FileSettingsStore` keeps the user's settings in one file, `settings.json`. It writes the settings with secrets exposed, so the file holds the working API key. A missing file loads as `None`, and the conversation start path then reports that settings are missing.

Sources: [openhands/storage/settings/file_settings_store.py:15-31](repo://openhands/storage/settings/file_settings_store.py#L15-L31), [openhands/server/services/conversation_service.py:99-124](repo://openhands/server/services/conversation_service.py#L99-L124)

`FileSecretsStore` keeps the user's secrets in one file, and it drops any provider token that has no value when it loads. The secrets are written with their values exposed, like the settings.

Sources: [openhands/storage/secrets/file_secrets_store.py:15-36](repo://openhands/storage/secrets/file_secrets_store.py#L15-L36)

Each store builds its file store from the configuration with the same factory. So every store uses the same backend and the same webhook setting.

Sources: [openhands/storage/settings/file_settings_store.py:32-43](repo://openhands/storage/settings/file_settings_store.py#L32-L43), [openhands/storage/conversation/file_conversation_store.py:104-115](repo://openhands/storage/conversation/file_conversation_store.py#L104-L115)

The configuration fields that choose the backend are described in [[Configuration Loading]]. The event files written through this store are described in [[Events and the Event Stream]].

Sources: [openhands/core/config/openhands_config.py:72-76](repo://openhands/core/config/openhands_config.py#L72-L76)
