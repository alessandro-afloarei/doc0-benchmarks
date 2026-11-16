---
title: "Indexer Connector and Keystore"
---
## Overview

The indexer connector (`src/shared_modules/indexer_connector`) is the library server modules use to write documents into the Wazuh indexer (OpenSearch). A module creates one `IndexerConnector` per index and calls `publish` with small JSON operations; the connector queues them on disk, turns them into `_bulk` requests, picks a healthy indexer node, adapts the batch size to what the indexer accepts, and keeps a local record of which document IDs exist so it can delete or resynchronize an agent's documents. Credentials come from `wazuh-keystore`, a small encrypted key-value store. The [[Vulnerability Scanner]] and the [[Inventory Harvester]] are its users.

Sources: [src/shared_modules/indexer_connector/src/indexerConnector.cpp:24-60](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L24-L60), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:780-820](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L780-L820)

## Publishing operations

### Message format

Each call to `publish` carries a JSON with an `id` and an `operation`, plus `data` for inserts. The dispatcher callback groups queued messages into one bulk body:

Sources: [src/shared_modules/indexer_connector/src/indexerConnector.cpp:590-660](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L590-L660)

| `operation` | Bulk action | Local ID store |
| --- | --- | --- |
| Insert (any other value) | `{"index":{"_index":..., "_id":...}}` followed by the document | `put(id, data)` |
| `DELETED` | `{"delete":{...}}` for the ID, or for every stored ID with that prefix when seek-delete is on | IDs removed |
| `DELETED_BY_QUERY` | A `_delete_by_query` on `agent.id` | Every stored ID for the agent removed |

Sources: [src/shared_modules/indexer_connector/src/indexerConnector.cpp:176-201](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L176-L201), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:600-655](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L600-L655)

A message missing `id` or `operation` is logged and skipped. Bulk requests go to `<server>/_bulk?refresh=wait_for`, so documents are searchable when the request returns.

Sources: [src/shared_modules/indexer_connector/src/indexerConnector.cpp:590-600](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L590-L600), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:770-780](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L770-L780)

### Persistent queue and local IDs

The dispatcher is a RocksDB-backed queue under `queue/indexer/<index>`, so operations survive restarts and indexer outages. A second RocksDB under `queue/indexer/db/<index>` keeps the IDs (and data) of the documents the connector has indexed; it lets `DELETED` with seek-delete remove every document whose ID starts with an agent's prefix, and lets resynchronization compare the indexer's contents with the local view.

Sources: [src/shared_modules/indexer_connector/src/indexerConnector.cpp:500-522](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L500-L522), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:780-790](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L780-L790)

## Adapting to the indexer

The bulk size starts at 25000 operations. After five consecutive successful requests below that size, it doubles (capped at 25000). On HTTP 413 (request too large) it halves and the batch is retried; if halving would go below 5, the connector stops with an error asking to review the configuration. HTTP 409 (version conflict) and 429 (too many requests) throw with a "retrying in 1 second" message, and any other status throws the indexer's error.

Sources: [src/shared_modules/indexer_connector/src/indexerConnector.cpp:30-38](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L30-L38), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:655-745](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L655-L745)

## Choosing a server

`ServerSelector` is a round-robin over the configured hosts that skips hosts the `Monitoring` thread marks unavailable; when every host is down, `getNext` throws "No available server" and the batch is retried later. `Monitoring` polls each host's `_cluster/health` every 60 seconds and treats `green` and `yellow` as available.

Sources: [src/shared_modules/indexer_connector/src/serverSelector.hpp:25-68](repo://src/shared_modules/indexer_connector/src/serverSelector.hpp#L25-L68), [src/shared_modules/indexer_connector/src/monitoring.hpp:28-110](repo://src/shared_modules/indexer_connector/src/monitoring.hpp#L28-L110), [src/shared_modules/indexer_connector/src/monitoring.hpp:150-201](repo://src/shared_modules/indexer_connector/src/monitoring.hpp#L150-L201)

## Initialization

The constructor reads the index template file (failing if it cannot be opened) and an optional update-mappings file, and starts a thread that keeps calling `initialize` until it succeeds, waiting 1 second at first and doubling the wait up to 60. `initialize` puts the index template at `_index_template/<index>_template`, puts the index with the template's settings (a 400 answer, such as an index that already exists, is not an error), and applies the update-mappings document to `<index>/_mapping` when there is one. Operations published before initialization completes wait in the persistent queue.

Sources: [src/shared_modules/indexer_connector/src/indexerConnector.cpp:524-560](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L524-L560), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:444-498](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L444-L498), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:815-856](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L815-L856)

## Resynchronizing an agent

A separate sync queue handles per-agent resynchronization. `getAgentDocumentsIds` pages through `_search?scroll=1m` for all documents of an agent (10000 per page, the indexer's limit), and `diff` compares them with the local ID store: IDs only in the local store are sent again as index actions, and IDs only in the indexer are deleted, in one bulk request. `abuseControl` skips a sync for an agent that was synchronized less than 30 minutes ago.

Sources: [src/shared_modules/indexer_connector/src/indexerConnector.cpp:203-300](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L203-L300), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:389-442](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L389-L442), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:790-812](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L790-L812)

## TLS and credentials

`initConfiguration` reads the `ssl` options of the `<indexer>` configuration: one or more `certificate_authorities` (several are merged into `tmp/root-ca-merged.pem`), a client `certificate` and `key`. The username and password come from the keystore column `indexer`, keys `username` and `password`; when they are missing the connector falls back to `admin`/`admin` with a warning. The credentials are read once per process under a global mutex, because the keystore database cannot be opened concurrently.

Sources: [src/shared_modules/indexer_connector/src/indexerConnector.cpp:116-174](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L116-L174), [src/shared_modules/indexer_connector/src/indexerConnector.cpp:63-115](repo://src/shared_modules/indexer_connector/src/indexerConnector.cpp#L63-L115)

## The keystore

### Storage

The keystore is a RocksDB at `queue/keystore` with one column family per consumer (`indexer` for the connector). `Keystore::put` encrypts each value with AES-256 (`EVPHelper::encryptAES256`), creating the column family if needed; `Keystore::get` decrypts. Version 1 of the keystore used RSA with `etc/sslmanager.key`; on first use, `upgrade` re-encrypts every value with AES and records version 2, and if that fails it deletes the column's keys and asks for them to be saved again.

Sources: [src/shared_modules/keystore/src/keyStore.cpp:1-100](repo://src/shared_modules/keystore/src/keyStore.cpp#L1-L100)

### The wazuh-keystore tool

Administrators write values with the `wazuh-keystore` binary, which changes to the install directory and calls `Keystore::put`:

Sources: [src/shared_modules/keystore/src/main.cpp:58-110](repo://src/shared_modules/keystore/src/main.cpp#L58-L110)

```bash
/var/ossec/bin/wazuh-keystore -f indexer -k username -v admin
/var/ossec/bin/wazuh-keystore -f indexer -k password -vp /path/to/file.txt
echo "secret" | /var/ossec/bin/wazuh-keystore -f indexer -k password
```

Sources: [src/shared_modules/keystore/src/argsParser.hpp:95-108](repo://src/shared_modules/keystore/src/argsParser.hpp#L95-L108)

`-v` takes the value on the command line, `-vp` reads the first line of a file, and with neither the value is read from standard input, which keeps passwords out of the process list and shell history.

Sources: [src/shared_modules/keystore/src/main.cpp:66-108](repo://src/shared_modules/keystore/src/main.cpp#L66-L108), [src/shared_modules/keystore/src/argsParser.hpp:48-52](repo://src/shared_modules/keystore/src/argsParser.hpp#L48-L52)
