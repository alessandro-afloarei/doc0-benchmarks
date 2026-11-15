---
title: "Engine Store, KVDB, Schema and Geo"
---
## Overview

The engine keeps four kinds of persistent data. The store holds documents: assets, policies, integrations, the schema, route tables and other internal state, as JSON files under `analysisd.store_path`. The KVDB holds key-value databases in RocksDB that helpers look up at run time. The schema describes the type of every known field and is used by the builder and the parsers. The Geo manager tracks MaxMind databases for IP geolocation. All four are created in `main.cpp` before the builder, which depends on them ([[Engine Architecture and Startup]]).

Sources: [src/engine/source/main.cpp:338-383](repo://src/engine/source/main.cpp#L338-L383)

## The store

### Names and namespaces

Every document is addressed by a `base::Name`, a list of parts written with `/` such as `decoder/syslog/0`. User content (assets, policies, integrations) lives in namespaces: on disk a document `decoder/syslog/0` in namespace `system` is stored as `namespaces/system/decoder/syslog/0`. The rest of the engine uses the namespace-free "virtual" name; `virtualToRealName` and `realToVirtualName` translate.

Sources: [src/engine/source/store/include/store/store.hpp:31-60](repo://src/engine/source/store/include/store/store.hpp#L31-L60), [src/engine/source/store/src/store.cpp:48-48](repo://src/engine/source/store/src/store.cpp#L48-L48)

When the `Store` is constructed it walks the `namespaces` collection recursively and fills a two-way cache (name to namespace, namespace to names). A virtual name may belong to only one namespace; a duplicate found on disk is logged and ignored. `getNamespace(name)` is answered from this cache, which is how the policy loader knows where an asset lives.

Sources: [src/engine/source/store/src/store.cpp:282-368](repo://src/engine/source/store/src/store.cpp#L282-L368), [src/engine/source/store/src/store.cpp:369-374](repo://src/engine/source/store/src/store.cpp#L369-L374)

### Namespaced and internal documents

The store offers two APIs. The namespaced one (`createDoc`, `readDoc`, `updateDoc`, `upsertDoc`, `deleteDoc`, `readCol`) checks the cache under a reader-writer lock, translates the name, and updates the cache on success; creating a name that already exists in any namespace fails. The internal one (`createInternalDoc`, `readInternalDoc`, ...) bypasses namespaces and the cache and is used for engine state: `schema/engine-schema/0`, `router/router/0`, `geo/...`. Internal writes may not start with `namespaces`.

Sources: [src/engine/source/store/src/store.cpp:376-451](repo://src/engine/source/store/src/store.cpp#L376-L451), [src/engine/source/store/src/store.cpp:540-615](repo://src/engine/source/store/src/store.cpp#L540-L615)

### The file driver

The only driver, `FileDriver`, maps each name part to a directory level (`nameToPath`) and stores a document as a file containing its JSON text. Creating a document creates the parent directories; deleting one removes directories left empty. Collections are directories, and `readCol` lists their entries as names.

Sources: [src/engine/source/store/drivers/fileDriver/src/fileDriver.cpp:35-123](repo://src/engine/source/store/drivers/fileDriver/src/fileDriver.cpp#L35-L123), [src/engine/source/store/drivers/fileDriver/src/fileDriver.cpp:176-260](repo://src/engine/source/store/drivers/fileDriver/src/fileDriver.cpp#L176-L260)

The installer seeds the store with three internal documents copied from `src/engine/ruleset/schemas`: the engine schema, the logpar overrides and the allowed fields, as described on [[Quickstart: Build and Install]].

Sources: [src/init/inst-functions.sh:1035-1072](repo://src/init/inst-functions.sh#L1035-L1072)

## The catalog

The catalog is the API's view of the store. It accepts resources as JSON or YAML, converts them to JSON documents, and before writing a decoder, rule, filter, output or integration it runs `builder->validateAsset` or `validateIntegration`, so invalid content is never stored. `putResource` also requires that the name inside the content matches the name in the request, and that the resource already exists in the requested namespace.

Sources: [src/engine/source/api/catalog/src/catalog.cpp:40-80](repo://src/engine/source/api/catalog/src/catalog.cpp#L40-L80), [src/engine/source/api/catalog/src/catalog.cpp:110-225](repo://src/engine/source/api/catalog/src/catalog.cpp#L110-L225), [src/engine/source/api/catalog/src/catalog.cpp:266-348](repo://src/engine/source/api/catalog/src/catalog.cpp#L266-L348)

## KVDB

### Databases

`KVDBManager` opens one RocksDB instance under `analysisd.kvdb_path`, and each named KVDB is a column family in it. On start it lists the existing column families and opens them all. `createDB(name, path)` creates a column family and can fill it from a JSON file whose top-level keys become keys; `deleteDB` drops the column family, but only when no handler is using it ("Usage Reference Count").

Sources: [src/engine/source/kvdb/src/kvdbManager.cpp:21-115](repo://src/engine/source/kvdb/src/kvdbManager.cpp#L21-L115), [src/engine/source/kvdb/src/kvdbManager.cpp:156-260](repo://src/engine/source/kvdb/src/kvdbManager.cpp#L156-L260)

### Handlers

Consumers ask for a handler with `getKVDBHandler(db, scope)`. The scope (`builder` for helpers, the API for management) is recorded in a reference-counted collection, which is what prevents a database used by a loaded policy from being deleted. A handler offers `get`, `set`, `add`, `remove`, `contains` and paged `dump`; values are JSON strings.

Sources: [src/engine/source/kvdb/src/kvdbManager.cpp:122-137](repo://src/engine/source/kvdb/src/kvdbManager.cpp#L122-L137), [src/engine/source/kvdb/src/kvdbHandler.cpp:16-130](repo://src/engine/source/kvdb/src/kvdbHandler.cpp#L16-L130), [src/engine/source/kvdb/src/kvdbHandler.cpp:130-200](repo://src/engine/source/kvdb/src/kvdbHandler.cpp#L130-L200), [src/engine/source/main.cpp:458-462](repo://src/engine/source/main.cpp#L458-L462)

The `kvdb_*` helpers ([[Engine Helper Functions]]) get their handler when the policy is built, so a KVDB must exist before a policy that uses it is loaded; the lookup itself happens per event.

Sources: [src/engine/source/builder/src/register.hpp:317-341](repo://src/engine/source/builder/src/register.hpp#L317-L341)

## Schema

The schema document `schema/engine-schema/0` has a `fields` object with one entry per dotted field name, each with a `type` (Elasticsearch types such as `keyword`, `long`, `ip`, `date`, `object`) and an `array` flag. `Schema::load` builds a tree from those names, adding intermediate objects as needed.

Sources: [src/engine/ruleset/schemas/engine-schema.json:1-30](repo://src/engine/ruleset/schemas/engine-schema.json#L1-L30), [src/engine/source/schemf/src/schema.cpp:18-56](repo://src/engine/source/schemf/src/schema.cpp#L18-L56), [src/engine/source/schemf/src/schema.cpp:194-249](repo://src/engine/source/schemf/src/schema.cpp#L194-L249)

The schema is used in three places. The builder validates every helper against the target field's type through validation tokens (a filter on a `long` field must compare numbers). Logpar picks the parser for a captured field from its type ([[Log Parsing (HLP and Logpar)]]). Fields that are not in the schema are custom fields and are not type-checked. If the schema document is missing, the engine starts without it and logs that consistency with the indexer mappings is not guaranteed.

Sources: [src/engine/source/schemf/src/schema.cpp:245-249](repo://src/engine/source/schemf/src/schema.cpp#L245-L249), [src/engine/source/builder/src/builders/baseHelper.cpp:240-260](repo://src/engine/source/builder/src/builders/baseHelper.cpp#L240-L260), [src/engine/source/main.cpp:368-383](repo://src/engine/source/main.cpp#L368-L383)

## Geo

### Database registry

The Geo manager keeps a map of open MaxMind databases, each typed as city or ASN, opened with `MMDB_open` in memory-mapped mode. Each database is recorded in the store as an internal document `geo/<file name>` holding its path, type and MD5 hash, and on start the manager reopens every recorded database, deleting entries whose file can no longer be opened.

Sources: [src/engine/source/geo/src/manager.cpp:18-62](repo://src/engine/source/geo/src/manager.cpp#L18-L62), [src/engine/source/geo/src/manager.cpp:64-136](repo://src/engine/source/geo/src/manager.cpp#L64-L136), [src/engine/source/geo/include/geo/manager.hpp:22-22](repo://src/engine/source/geo/include/geo/manager.hpp#L22-L22)

### Updating a database

`remoteUpsertDb(path, type, dbUrl, hashUrl)` downloads the expected MD5 first and does nothing if it matches the stored hash. Otherwise it downloads the database (up to `MAX_RETRIES` attempts, until the content's MD5 matches), writes it, and, for a database that is already open, closes and reopens it while holding that database's write lock, so lookups never see a half-written file. The `geoip` and `as` helpers take a locator from the manager and read with the database's read lock.

Sources: [src/engine/source/geo/src/manager.cpp:231-330](repo://src/engine/source/geo/src/manager.cpp#L231-L330), [src/engine/source/geo/src/locator.cpp:300-310](repo://src/engine/source/geo/src/locator.cpp#L300-L310), [src/engine/source/builder/src/register.hpp:263-268](repo://src/engine/source/builder/src/register.hpp#L263-L268)
