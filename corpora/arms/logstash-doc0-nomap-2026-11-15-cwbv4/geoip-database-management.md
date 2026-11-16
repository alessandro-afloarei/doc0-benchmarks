---
title: "GeoIP Database Management"
---
## Overview

The GeoIP filter (a separate gem) needs MaxMind GeoLite2 City and ASN databases. Rather than ship stale databases, x-pack runs a database manager that downloads current ones from Elastic's GeoIP service, keeps them on disk under `path.data`, checks for updates on a schedule, and notifies the plugins using them when a new version arrives. To follow the MaxMind EULA it also stops serving a database that could not be refreshed for 30 days. The manager is a process-wide singleton; plugins subscribe to a database type and are told when its path changes or expires. It is added through the x-pack mechanisms described on [[X-Pack Extensions and License Checking]].

Sources: [x-pack/lib/geoip_database_management/manager.rb:43-70](repo://x-pack/lib/geoip_database_management/manager.rb#L43-L70), [x-pack/lib/geoip_database_management/constants.rb:5-18](repo://x-pack/lib/geoip_database_management/constants.rb#L5-L18)

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `xpack.geoip.downloader.enabled` | `true` | Manage databases; when false, existing managed databases are deleted |
| `xpack.geoip.downloader.endpoint` | `https://geoip.elastic.co/v1/database` | Service to download from (deprecated alias `xpack.geoip.download.endpoint`) |
| `xpack.geoip.downloader.poll.interval` | `24h` | How often to check for updates |

Sources: [x-pack/lib/geoip_database_management/extension.rb:7-23](repo://x-pack/lib/geoip_database_management/extension.rb#L7-L23)

## The manager

`Manager.instance` reads the settings and uses `path.data/geoip_database_management` as its root, with a `metadata.csv` file recording, per database type, the last check time, the MD5 of the downloaded archive, and the directory holding it. When the downloader is disabled, it deletes the metadata and every managed database directory on startup.

Sources: [x-pack/lib/geoip_database_management/manager.rb:49-70](repo://x-pack/lib/geoip_database_management/manager.rb#L49-L70), [x-pack/lib/geoip_database_management/metadata.rb:10-60](repo://x-pack/lib/geoip_database_management/metadata.rb#L10-L60)

Nothing is downloaded until a plugin asks. `subscribe_database_path(type)` accepts `City` or `ASN`, returns `nil` when the manager is disabled, and otherwise starts the manager once (`ensure_started!`) and returns a `Subscription` for that type.

Sources: [x-pack/lib/geoip_database_management/manager.rb:75-89](repo://x-pack/lib/geoip_database_management/manager.rb#L75-L89)

Starting creates the directories, builds a `State` per type (with the path from metadata, or `PENDING` if never downloaded), initialises metrics, runs one download job immediately, and then schedules a `TimerTask` every `poll.interval` on a thread named "geoip database sync task".

Sources: [x-pack/lib/geoip_database_management/manager.rb:125-176](repo://x-pack/lib/geoip_database_management/manager.rb#L125-L176)

## Download job

`execute_download_job` asks the `Downloader` for updates.

Sources: [x-pack/lib/geoip_database_management/manager.rb:178-208](repo://x-pack/lib/geoip_database_management/manager.rb#L178-L208)

1. `GET <endpoint>?key=<node uuid>&elastic_geoip_service_tos=agree` lists available databases. Any query string on the configured endpoint is ignored with a warning. A non-2xx answer raises `BadResponseCodeError`.
2. For each type, skip it if the service does not list it or if its MD5 matches the local archive; otherwise download it.
3. Download the `.tgz` into a new directory named after the current Unix time, retrying 3 times, and reject it if its MD5 differs from the listing.
4. Extract it and verify the `.mmdb` file exists and contains the MaxMind metadata marker.

Sources: [x-pack/lib/geoip_database_management/downloader.rb:42-123](repo://x-pack/lib/geoip_database_management/downloader.rb#L42-L123), [x-pack/lib/geoip_database_management/downloader.rb:127-170](repo://x-pack/lib/geoip_database_management/downloader.rb#L127-L170)

The HTTP client uses a 15-second request and 5-second connect timeout and honours `http_proxy`. A failure for one type does not affect the other.

Sources: [x-pack/lib/geoip_database_management/downloader.rb:59-73](repo://x-pack/lib/geoip_database_management/downloader.rb#L59-L73), [x-pack/lib/geoip_database_management/downloader.rb:136-145](repo://x-pack/lib/geoip_database_management/downloader.rb#L136-L145)

For each successful download the manager records metadata and calls `State#update!`, which swaps in a new `DbInfo` and notifies every subscription. Types that were already current just get their check time refreshed. In all cases the job then checks database ages, deletes database directories no longer referenced by metadata, and records whether the run fully succeeded.

Sources: [x-pack/lib/geoip_database_management/manager.rb:178-208](repo://x-pack/lib/geoip_database_management/manager.rb#L178-L208), [x-pack/lib/geoip_database_management/manager.rb:289-329](repo://x-pack/lib/geoip_database_management/manager.rb#L289-L329)

## Expiry

| Days since last successful check | Effect | Status metric |
| --- | --- | --- |
| under 25 | none | `up_to_date` |
| 25 to 29 | warning with days left | `to_be_expired` |
| 30 or more | error; state expired, subscribers told, file deleted, path unset in metadata | `expired` |

Sources: [x-pack/lib/geoip_database_management/manager.rb:210-254](repo://x-pack/lib/geoip_database_management/manager.rb#L210-L254)

The error message suggests allowing internet access, pointing `xpack.geoip.downloader.endpoint` at a self-managed service, or configuring the plugin with its own database file.

Sources: [x-pack/lib/geoip_database_management/manager.rb:223-231](repo://x-pack/lib/geoip_database_management/manager.rb#L223-L231)

## Subscriptions

A `DbInfo` is an immutable path with `pending`, `expired` or `removed` flags. A `Subscription` holds the current `DbInfo` behind a read/write lock; `value` reads it, and `observe` registers callbacks with `construct` (called at once with the current value), `on_update` (new path) and `on_expire`. `release!` unsubscribes. Notification takes the write lock only to swap the value, then calls observers under a read lock, so readers never see a half-applied update.

Sources: [x-pack/lib/geoip_database_management/db_info.rb:5-35](repo://x-pack/lib/geoip_database_management/db_info.rb#L5-L35), [x-pack/lib/geoip_database_management/subscription.rb:13-124](repo://x-pack/lib/geoip_database_management/subscription.rb#L13-L124), [x-pack/lib/geoip_database_management/subscription_observer.rb:18-78](repo://x-pack/lib/geoip_database_management/subscription_observer.rb#L18-L78)

## The GeoIP filter's database manager

`LogStash::Filters::Geoip::DatabaseManager` adapts the general manager for the geoip filter. When a filter instance has no `database` option, behaviour depends on whether the downloader is enabled.

Sources: [x-pack/lib/filters/geoip/database_manager.rb:26-62](repo://x-pack/lib/filters/geoip/database_manager.rb#L26-L62)

- With the downloader enabled, it subscribes to both types (once), logs that using managed databases means accepting the MaxMind EULA, remembers the plugin, and returns the current path. Updates and expiries are forwarded to every registered plugin through `update_filter`.
- With the downloader disabled, it falls back to the CC-licensed databases vendored in the `logstash-filter-geoip` gem, copied to `path.data/plugins/filters/geoip/CC`.

Sources: [x-pack/lib/filters/geoip/database_manager.rb:64-136](repo://x-pack/lib/filters/geoip/database_manager.rb#L64-L136)

When the filter sets `database` itself, the path is used as is, with a reminder about the EULA, and no updates are tracked.

Sources: [x-pack/lib/filters/geoip/database_manager.rb:122-127](repo://x-pack/lib/filters/geoip/database_manager.rb#L122-L127)

## Metrics

The agent creates the `geoip_download_manager` metric namespace at startup when x-pack is present and hands it to the manager. It holds, for `ASN` and `City`, `status` (`init`, `up_to_date`, `to_be_expired`, `expired`), `last_updated_at` and `fail_check_in_days`, and under `download_stats` the `successes` and `failures` counters, `last_checked_at`, and `status` (`updating`, `succeeded`, `failed`). Node stats include this section once a download status exists ([[Monitoring API]]).

Sources: [logstash-core/lib/logstash/agent.rb:661-689](repo://logstash-core/lib/logstash/agent.rb#L661-L689), [x-pack/lib/geoip_database_management/metric.rb:7-66](repo://x-pack/lib/geoip_database_management/metric.rb#L7-L66), [logstash-core/lib/logstash/api/modules/node_stats.rb:45-46](repo://logstash-core/lib/logstash/api/modules/node_stats.rb#L45-L46)
