---
title: "Cloud and Service Integrations"
---
## Overview

Several modules of [[Modules Daemon (modulesd)]] pull security logs from outside services rather than reading the host. They come in two forms. The AWS, Azure and Google Cloud integrations are Python programs under `wodles/` that a thin C module launches on a schedule; the Python side talks to the provider's API and writes events straight to the queue socket. GitHub, Office 365 and Microsoft Graph are pure C modules that call the HTTP APIs with libcurl and write events through `wm_sendmsg`. Docker is a Python listener kept alive by its C module. In every case the events land on `queue/sockets/queue` with queue byte `1`, like a log line, and are decoded by the engine.

Sources: [src/wazuh_modules/wm_aws.h:19-19](repo://src/wazuh_modules/wm_aws.h#L19-L19), [src/wazuh_modules/wm_azure.h:16-16](repo://src/wazuh_modules/wm_azure.h#L16-L16), [src/wazuh_modules/wm_gcp.h:17-17](repo://src/wazuh_modules/wm_gcp.h#L17-L17), [src/wazuh_modules/wm_docker.h:17-17](repo://src/wazuh_modules/wm_docker.h#L17-L17)

## Catalogue

| Module tag | Implementation | Collects | Configured with |
| --- | --- | --- | --- |
| `aws-s3` | `wm_aws.c` runs `wodles/aws/aws-s3` | S3 buckets (CloudTrail, VPC Flow, Config, GuardDuty, WAF, ALB/CLB/NLB, server access, Cisco Umbrella, custom), CloudWatch Logs, Inspector, SQS subscribers (Security Lake, Security Hub, buckets) | `<bucket>`, `<service>`, `<subscriber>` blocks |
| `azure-logs` | `wm_azure.c` runs `wodles/azure/azure-logs` | Log Analytics queries, Microsoft Graph queries, Blob Storage | `<log_analytics>`, `<graph>`, `<storage>` |
| `gcp-pubsub`, `gcp-bucket` | `wm_gcp.c` runs `wodles/gcloud/gcloud` | Pub/Sub subscriptions, Cloud Storage access logs | Project, subscription or bucket, credentials file |
| `github` | `wm_github.c` | Organization audit log | Organization, API token, event type |
| `office365` | `wm_office365.c` | Management Activity API content for each configured subscription | Tenant, client ID and secret, subscriptions |
| `ms-graph` | `wm_ms_graph.c` | Configured Microsoft Graph resources and relationships | Tenant, client credentials, resources and relationships |
| `docker-listener` | `wm_docker.c` runs `wodles/docker/DockerListener` | Docker engine events | Attempts and schedule |

Sources: [wodles/aws/aws_s3.py:43-75](repo://wodles/aws/aws_s3.py#L43-L75), [wodles/aws/aws_s3.py:108-175](repo://wodles/aws/aws_s3.py#L108-L175), [wodles/azure/azure-logs.py:23-44](repo://wodles/azure/azure-logs.py#L23-L44), [wodles/gcloud/gcloud.py:15-95](repo://wodles/gcloud/gcloud.py#L15-L95), [src/wazuh_modules/wm_office365.h:35-41](repo://src/wazuh_modules/wm_office365.h#L35-L41), [src/wazuh_modules/wm_ms_graph.h:37-46](repo://src/wazuh_modules/wm_ms_graph.h#L37-L46)

## Script-backed integrations

### The C launcher

`wm_aws_main` shows the pattern the script-backed modules share. It computes the wait with `sched_scan_get_time_until_next_scan`, saves the next run time in a state file with `wm_state_io` so a restart does not trigger an early run, sleeps until then, and runs every configured bucket, service and subscriber in turn. Each one becomes a command line for `wodles/aws/aws-s3` executed with `wm_exec` and no timeout.

Sources: [src/wazuh_modules/wm_aws.c:52-140](repo://src/wazuh_modules/wm_aws.c#L52-L140), [src/wazuh_modules/wm_aws.c:370-390](repo://src/wazuh_modules/wm_aws.c#L370-L390)

The exit code is interpreted after the script finishes: 1 is an unknown error, 2 an argument error, anything else is logged with the script's `ERROR:` line. Lines the script wrote to stdout are forwarded with `wm_sendmsg` under the module's name; an internal error from `wm_exec` itself stops the module thread.

Sources: [src/wazuh_modules/wm_aws.c:496-545](repo://src/wazuh_modules/wm_aws.c#L496-L545)

### The Python side

`aws_s3.py` maps the `--type`, `--service` or `--subscriber` argument to a class: for example `cloudtrail` to `AWSCloudTrailBucket`, `cloudwatchlogs` to `AWSCloudWatchLogs`, `security_lake` to an S3 handler plus an SQS message processor. For services without explicit regions it iterates over all regions.

Sources: [wodles/aws/aws_s3.py:43-75](repo://wodles/aws/aws_s3.py#L43-L75), [wodles/aws/aws_s3.py:108-175](repo://wodles/aws/aws_s3.py#L108-L175)

All AWS classes derive from `WazuhIntegration`, which owns two concerns. It remembers progress in a SQLite file under `wodles/aws` (the last processed object per bucket and prefix), so each run only fetches new data, and it sends each event to the queue as a datagram prefixed with `1:Wazuh-AWS:`. A message larger than the socket buffer is skipped with an error, and a refused connection exits with code 11 ("Wazuh must be running").

Sources: [wodles/aws/wazuh_integration.py:38-62](repo://wodles/aws/wazuh_integration.py#L38-L62), [wodles/aws/wazuh_integration.py:293-320](repo://wodles/aws/wazuh_integration.py#L293-L320), [wodles/aws/wazuh_integration.py:470-480](repo://wodles/aws/wazuh_integration.py#L470-L480)

The Azure program dispatches on `--log_analytics`, `--graph` or `--storage` after checking its own state database, and the Google Cloud program dispatches on the integration type `pubsub` or `access_logs`; both follow the same send-to-queue approach through the shared `wodles/utils.py`.

Sources: [wodles/azure/azure-logs.py:23-44](repo://wodles/azure/azure-logs.py#L23-L44), [wodles/gcloud/gcloud.py:20-95](repo://wodles/gcloud/gcloud.py#L20-L95), [wodles/utils.py:138-142](repo://wodles/utils.py#L138-L142)

## HTTP-native integrations

### GitHub

For each organization, `wm_github` reads its state file (`last_log_time`). On the first run, or when `only_future_events` is set, it records "now" and starts from there. Each scan builds the audit-log URL for the window between the last time and now (`phrase=created:<from>..<to>`, ascending, paged), sends it with an `Authorization: token` header through `wurl_http_request`, and follows pagination until done. Every entry is wrapped as `{"integration":"github","github":{...}}` and sent; the new time is stored only after the window is complete, so a failure retries the same window.

Sources: [src/wazuh_modules/wm_github.c:250-360](repo://src/wazuh_modules/wm_github.c#L250-L360), [src/wazuh_modules/wm_github.c:360-375](repo://src/wazuh_modules/wm_github.c#L360-L375), [src/wazuh_modules/wm_github.h:23-29](repo://src/wazuh_modules/wm_github.h#L23-L29)

When requests keep failing, the module sends a failure event of the same shape with the error, so the problem is visible as an alert on the manager rather than only in the agent log.

Sources: [src/wazuh_modules/wm_github.c:465-480](repo://src/wazuh_modules/wm_github.c#L465-L480)

### Office 365 and Microsoft Graph

Office 365 follows the same state-and-window design per tenant and subscription. It first gets an OAuth2 client-credentials token, starts the Management Activity subscription, lists content blobs for the time window, downloads each blob, and sends each record as `{"integration":"office365","office365":{...}}`. Failures per tenant and subscription are counted and reported the same way as GitHub.

Sources: [src/wazuh_modules/wm_office365.c:40-113](repo://src/wazuh_modules/wm_office365.c#L40-L113), [src/wazuh_modules/wm_office365.c:345-460](repo://src/wazuh_modules/wm_office365.c#L345-L460), [src/wazuh_modules/wm_office365.c:460-500](repo://src/wazuh_modules/wm_office365.c#L460-L500), [src/wazuh_modules/wm_office365.h:35-41](repo://src/wazuh_modules/wm_office365.h#L35-L41)

The MS Graph module keeps a token per tenant (refreshing it when it expires), queries each configured resource and relationship filtered by `createdDateTime` or `activityDateTime`, and for relationships that reference devices expands them with additional device queries.

Sources: [src/wazuh_modules/wm_ms_graph.c:25-40](repo://src/wazuh_modules/wm_ms_graph.c#L25-L40), [src/wazuh_modules/wm_ms_graph.h:21-46](repo://src/wazuh_modules/wm_ms_graph.h#L21-L46)

## Docker listener

The Docker module is long-running rather than periodic: it starts `DockerListener` with `wpopenl`, registers the child for cleanup, and logs whatever the listener writes to stderr. When the listener exits it is started again at the next scheduled time; exit code 127 (script missing) or reaching the configured number of `attempts` stops the module.

Sources: [src/wazuh_modules/wm_docker.c:40-112](repo://src/wazuh_modules/wm_docker.c#L40-L112)
