---
title: "Inventory Harvester"
---
## Overview

The inventory harvester is the manager module of `wazuh-modulesd` (`inventory-harvester`) that turns agents' inventory and file integrity data into documents in the Wazuh indexer. It receives the same syscollector and FIM messages remoted publishes on the router, converts each into a document in the Wazuh Common Schema (WCS), and upserts or deletes it in one `wazuh-states-*` index per kind of data (packages, processes, ports, files, registry keys, and so on). It keeps no database of its own: the indexer is the state, and each message only says what to change.

Sources: [docs/ref/modules/inventory-harvester/architecture.md:1-30](repo://docs/ref/modules/inventory-harvester/architecture.md#L1-L30), [src/wazuh_modules/wmodules.c:103-106](repo://src/wazuh_modules/wmodules.c#L103-L106)

## Inputs

### Subscriptions

The facade subscribes to these router topics ([[Router Publish/Subscribe Module]]):

Sources: [src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp:27-64](repo://src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp#L27-L64)

| Topic | Goes to | Buffer type |
| --- | --- | --- |
| `deltas-syscollector` | System queue | DBSync delta |
| `deltas-syscheck` | FIM queue | DBSync delta |
| `rsync` | FIM or system queue, by the attribute type of the state message | RSync sync message |
| `wdb-agent-events` | Both queues | JSON action |
| `wdb-fim-events` | FIM queue | JSON action |
| `wdb-inventory-events` | System queue | JSON action |

Sources: [src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp:66-160](repo://src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp#L66-L160), [src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp:160-195](repo://src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp#L160-L195)

For `rsync`, the facade verifies the flatbuffer and inspects the state's attributes: FIM file and registry attributes go to the FIM queue, the eleven syscollector tables to the system queue, and integrity-clear messages likewise by component.

Sources: [src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp:66-160](repo://src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp#L66-L160)

### Queues

The two queues (`queue/harvester/system_event` and `queue/harvester/fim_event`) are persistent event dispatchers. Each has a worker that hands every event to its orchestrator; a JSON or processing error is logged and the event is dropped, so one bad message does not block the queue. The agent data comes from the source's sync messages, enriched by remoted with the agent's ID, name, IP and version ([[Remoted: Agent Connections]]).

Sources: [src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp:17-20](repo://src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp#L17-L20), [src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp:198-290](repo://src/wazuh_modules/inventory_harvester/src/inventoryHarvesterFacade.cpp#L198-L290)

## Orchestration

### Contexts and operations

`SystemInventoryOrchestrator::processEvent` decodes the queued buffer as a sync message, a delta, or JSON, and wraps it in a `SystemContext`. The context exposes typed accessors (`packageName`, `agentId`, ...) over whichever input it holds, and computes the affected component and the operation. Deltas map `INSERTED` and `MODIFIED` to `Upsert` and `DELETED` to `Delete`; sync state messages are upserts; integrity-clear messages become `DeleteAllEntries`; agent removals become `DeleteAgent`; and wazuh-db actions can request `IndexSync` or `UpgradeAgentDB`.

Sources: [src/wazuh_modules/inventory_harvester/src/systemInventoryOrchestrator.hpp:38-76](repo://src/wazuh_modules/inventory_harvester/src/systemInventoryOrchestrator.hpp#L38-L76), [src/wazuh_modules/inventory_harvester/src/systemInventory/systemContext.hpp:3416-3480](repo://src/wazuh_modules/inventory_harvester/src/systemInventory/systemContext.hpp#L3416-L3480)

### Chains per operation

`SystemFactoryOrchestrator` builds a short chain for each operation; the FIM side has the same structure with its own context and elements:

Sources: [src/wazuh_modules/inventory_harvester/src/systemInventory/systemFactoryOrchestrator.hpp:46-78](repo://src/wazuh_modules/inventory_harvester/src/systemInventory/systemFactoryOrchestrator.hpp#L46-L78), [src/wazuh_modules/inventory_harvester/src/fimInventory/fimFactoryOrchestrator.hpp:40-80](repo://src/wazuh_modules/inventory_harvester/src/fimInventory/fimFactoryOrchestrator.hpp#L40-L80)

| Operation | Chain | Effect in the indexer |
| --- | --- | --- |
| `Upsert` | `UpsertSystemElement` then `ElementDispatch` | Index the WCS document under `<agent id>_<item id>` |
| `Delete` | `DeleteSystemElement` then `ElementDispatch` | Delete that document |
| `DeleteAgent` | `ClearAgent` | Delete-by-query for all the agent's documents |
| `DeleteAllEntries` | `ClearElements` | Delete-by-query for the agent's documents of one component |
| `IndexSync` | `IndexSync` | Resynchronize the connector with the indexer |
| `UpgradeAgentDB` | `UpgradeAgentDB` | Trigger a resynchronization after a legacy upgrade |

Sources: [src/wazuh_modules/inventory_harvester/src/systemInventory/systemFactoryOrchestrator.hpp:46-78](repo://src/wazuh_modules/inventory_harvester/src/systemInventory/systemFactoryOrchestrator.hpp#L46-L78), [docs/ref/modules/inventory-harvester/architecture.md:12-22](repo://docs/ref/modules/inventory-harvester/architecture.md#L12-L22)

## Building documents

`UpsertSystemElement` switches on the affected component and calls that element's `build`: `OsElement`, `PackageElement`, `ProcessElement`, `PortElement`, `HwElement`, `HotfixElement`, `NetworkProtocolElement`, `NetIfaceElement`, `NetElement`, `UserElement` or `GroupElement`. Each fills a `DataHarvester<T>` with the document ID, the operation and a WCS model, which is then serialized to JSON by reflection.

Sources: [src/wazuh_modules/inventory_harvester/src/systemInventory/upsertElement.hpp:45-100](repo://src/wazuh_modules/inventory_harvester/src/systemInventory/upsertElement.hpp#L45-L100)

`PackageElement::build` is typical. It refuses a message without agent ID or package ID, sets the document ID to `<agent id>_<package item id>`, copies agent ID, name, version and IP (omitting the IP when it is `any`), copies the package fields (name, version, vendor, architecture, type, size, path, install time, description), and adds the cluster name and, in a cluster, the node name.

Sources: [src/wazuh_modules/inventory_harvester/src/systemInventory/elements/packageElement.hpp:33-80](repo://src/wazuh_modules/inventory_harvester/src/systemInventory/elements/packageElement.hpp#L33-L80)

## Indexes

The orchestrator creates one indexer connector per component. Index names follow `wazuh-states-<inventory type>-<name>-<cluster name>`, for example `wazuh-states-inventory-packages-<cluster>` or `wazuh-states-fim-files-<cluster>`, with the template `templates/wazuh-states-<type>-<name>.json` and an update-mappings file next to it. The templates live in `src/wazuh_modules/inventory_harvester/indexer/template`.

Sources: [src/wazuh_modules/inventory_harvester/src/systemInventoryOrchestrator.hpp:78-165](repo://src/wazuh_modules/inventory_harvester/src/systemInventoryOrchestrator.hpp#L78-L165), [src/wazuh_modules/inventory_harvester/src/policyHarvesterManager.hpp:294-315](repo://src/wazuh_modules/inventory_harvester/src/policyHarvesterManager.hpp#L294-L315)

| Index | Source |
| --- | --- |
| `inventory-system`, `inventory-hardware`, `inventory-hotfixes` | Syscollector OS, hardware, hotfixes |
| `inventory-packages`, `inventory-processes`, `inventory-ports` | Syscollector packages, processes, ports |
| `inventory-interfaces`, `inventory-protocols`, `inventory-networks` | Network interfaces, protocols, addresses |
| `inventory-users`, `inventory-groups` | Users and groups |
| `fim-files`, `fim-registries` | FIM files; registry keys and values |

Sources: [src/wazuh_modules/inventory_harvester/indexer/template/wazuh-states-inventory-packages.json:1-10](repo://src/wazuh_modules/inventory_harvester/indexer/template/wazuh-states-inventory-packages.json#L1-L10), [src/wazuh_modules/inventory_harvester/src/systemInventoryOrchestrator.hpp:78-165](repo://src/wazuh_modules/inventory_harvester/src/systemInventoryOrchestrator.hpp#L78-L165)

`ElementDispatch` publishes the serialized document to the connector for its component; batching, retries and server selection are the connector's job ([[Indexer Connector and Keystore]]).

Sources: [src/wazuh_modules/inventory_harvester/src/common/elementDispatch.hpp:34-52](repo://src/wazuh_modules/inventory_harvester/src/common/elementDispatch.hpp#L34-L52)
