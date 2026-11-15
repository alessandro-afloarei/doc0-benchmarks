---
title: "Security Configuration Assessment"
---
## Overview

Security Configuration Assessment (SCA) checks a host against hardening benchmarks written as YAML policies, such as the CIS benchmarks shipped under `ruleset/sca`. Each policy is a list of checks; each check combines rules that test files, directories, running processes, command output or Windows registry values, and ends as `passed`, `failed` or not applicable. SCA runs as a module of `wazuh-modulesd` ([[Modules Daemon (modulesd)]]) and reports results to the manager through the local queue. The older Rootcheck scanner, which runs inside `wazuh-syscheckd`, is covered at the end of this page.

Sources: [src/wazuh_modules/wm_sca.c:148-160](repo://src/wazuh_modules/wm_sca.c#L148-L160), [ruleset/sca/debian/cis_debian10.yml:13-29](repo://ruleset/sca/debian/cis_debian10.yml#L13-L29)

## Policy files

A policy has three top-level sections. `policy` holds its `id`, `file`, `name`, `description` and `references`. `requirements` is a single check-like block that decides whether the policy applies to this host at all (for example, `/etc/debian_version` must exist). `checks` lists the checks, each with an `id`, `title`, `description`, `rationale`, `remediation`, `compliance` mappings, a `condition` and `rules`.

Sources: [ruleset/sca/debian/cis_debian10.yml:13-50](repo://ruleset/sca/debian/cis_debian10.yml#L13-L50)

```yaml
policy:
  id: "cis_debian10"
  file: "cis_debian10.yml"
  name: "CIS Debian Linux 10 Benchmark v2.0.0"

requirements:
  title: "Check Debian version"
  condition: all
  rules:
    - "f:/etc/debian_version"
    - "f:/proc/sys/kernel/ostype -> Linux"
```

Sources: [ruleset/sca/debian/cis_debian10.yml:13-28](repo://ruleset/sca/debian/cis_debian10.yml#L13-L28)

## Rule syntax

### Rule types

Each rule is a string `[!]<type>:<target> [-> <pattern>]`. `wm_sca_get_value` splits the type prefix from the value, and a leading `!` negates the rule:

Sources: [src/wazuh_modules/wm_sca.c:1428-1463](repo://src/wazuh_modules/wm_sca.c#L1428-L1463)

| Prefix | Tests | Example |
| --- | --- | --- |
| `f:` | A file exists, or its content matches the pattern | `f:/proc/sys/kernel/ostype -> Linux` |
| `d:` | A directory exists, or a file in it matches | `d:/etc/modprobe.d -> r:\.*.conf -> r:install /bin/false` |
| `p:` | A process with this name is running | `p:avahi-daemon` |
| `c:` | A command's output matches the pattern | `c:sysctl net.ipv4.ip_forward -> r:= 0` |
| `r:` | A Windows registry key or value | `r:HKLM\SOFTWARE\... -> Value -> 1` |

Sources: [src/wazuh_modules/wm_sca.c:1100-1210](repo://src/wazuh_modules/wm_sca.c#L1100-L1210), [src/wazuh_modules/wm_sca.c:1210-1260](repo://src/wazuh_modules/wm_sca.c#L1210-L1260), [ruleset/sca/debian/cis_debian10.yml:46-48](repo://ruleset/sca/debian/cis_debian10.yml#L46-L48)

Patterns are matched with the OS_Regex engine unless the policy or the check sets `regex_type: pcre2`. Patterns may combine minterms with ` && `, each optionally negated with `!`, and `n:` patterns capture a number and compare it (`n:^\s*MaxAuthTries\s+(\d+) compare <= 4`). Command rules (`c:`) in a policy that came from the manager are only run when the internal option `sca.remote_commands` is enabled on the agent, so a central policy cannot run arbitrary commands by default; commands time out after `sca.commands_timeout` seconds.

Sources: [src/wazuh_modules/wm_sca.c:1043-1058](repo://src/wazuh_modules/wm_sca.c#L1043-L1058), [src/wazuh_modules/wm_sca.c:2005-2045](repo://src/wazuh_modules/wm_sca.c#L2005-L2045), [src/wazuh_modules/wm_sca.c:1890-1912](repo://src/wazuh_modules/wm_sca.c#L1890-L1912), [src/wazuh_modules/wm_sca.c:1149-1160](repo://src/wazuh_modules/wm_sca.c#L1149-L1160), [src/wazuh_modules/wm_sca.c:165-175](repo://src/wazuh_modules/wm_sca.c#L165-L175)

### Conditions

The `condition` aggregates the rule results. Evaluation stops as soon as the outcome is known:

Sources: [src/wazuh_modules/wm_sca.c:891-923](repo://src/wazuh_modules/wm_sca.c#L891-L923)

| Condition | Passes when | Stops early when |
| --- | --- | --- |
| `all` | Every rule matches | A rule does not match |
| `any` | At least one rule matches | A rule matches |
| `none` | No rule matches | A rule matches |

Sources: [src/wazuh_modules/wm_sca.c:891-923](repo://src/wazuh_modules/wm_sca.c#L891-L923), [src/wazuh_modules/wm_sca.c:1018-1027](repo://src/wazuh_modules/wm_sca.c#L1018-L1027)

A rule that cannot be evaluated (a file that cannot be read, a command that times out) returns `INVALID`. Only `any` can still pass after an invalid rule; otherwise the check ends as not applicable, reported with an empty result and a `reason`.

Sources: [src/wazuh_modules/wm_sca.c:1290-1300](repo://src/wazuh_modules/wm_sca.c#L1290-L1300), [src/wazuh_modules/wm_sca.c:1324-1348](repo://src/wazuh_modules/wm_sca.c#L1324-L1348)

## Scan flow

`wm_sca_main` reads its internal options, creates one result table per policy, connects to the queue, and starts two helper threads (the request listener and the dump thread) before calling `wm_sca_start`. That loop sleeps until the next scheduled time from the module's `interval`/`day`/`wday`/`time` settings, scans every policy, and then sends a `policies` message listing the scanned policy IDs so the manager can purge results of removed policies.

Sources: [src/wazuh_modules/wm_sca.c:160-258](repo://src/wazuh_modules/wm_sca.c#L160-L258), [src/wazuh_modules/wm_sca.c:293-345](repo://src/wazuh_modules/wm_sca.c#L293-L345)

For each enabled policy, `wm_sca_read_files` follows these steps:

Sources: [src/wazuh_modules/wm_sca.c:346-360](repo://src/wazuh_modules/wm_sca.c#L346-L360)

1. Parse the YAML file and convert it to JSON with `yaml2json`; a policy that fails `wm_sca_check_policy` (duplicate IDs, missing fields) is skipped.
2. Compute the SHA-256 of the policy file. If it changed since the last scan, drop the stored results for that policy.
3. Evaluate `requirements` with `wm_sca_do_scan`. If they are not met, log "Skipping policy" and move on.
4. Evaluate every check, counting passed, failed and invalid results.
5. Compute an integrity hash over all check results and send the summary.

Sources: [src/wazuh_modules/wm_sca.c:360-470](repo://src/wazuh_modules/wm_sca.c#L360-L470), [src/wazuh_modules/wm_sca.c:470-506](repo://src/wazuh_modules/wm_sca.c#L470-L506)

## Messages to the manager

### Message types

Results travel on the queue with queue byte `p` (`SCA_MQ`). Three message types carry them:

Sources: [src/headers/mq_op.h:28-28](repo://src/headers/mq_op.h#L28-L28)

| `type` | When | Content |
| --- | --- | --- |
| `check` | A check result differs from the stored one (never on the first scan) | Policy, check metadata, compliance, rules, `result`, `reason` |
| `summary` | After every policy scan | `scan_id`, `policy_id`, `passed`, `failed`, `invalid`, `total_checks`, `score`, `start_time`, `end_time`, `hash`, `hash_file`, `first_scan` |
| `policies` | After all policies | The list of policy IDs scanned |

Sources: [src/wazuh_modules/wm_sca.c:1350-1362](repo://src/wazuh_modules/wm_sca.c#L1350-L1362), [src/wazuh_modules/wm_sca.c:2533-2600](repo://src/wazuh_modules/wm_sca.c#L2533-L2600), [src/wazuh_modules/wm_sca.c:293-312](repo://src/wazuh_modules/wm_sca.c#L293-L312)

The score is `passed / (passed + failed) * 100`, so not-applicable checks do not lower it. Sending only changed checks keeps steady-state traffic small; the summary's `hash` lets the manager detect that its copy is out of date.

Sources: [src/wazuh_modules/wm_sca.c:2565-2580](repo://src/wazuh_modules/wm_sca.c#L2565-L2580)

### Resynchronizing results

When the manager's hash does not match, it asks the agent for a dump: [[Agent Daemon (agentd)]] forwards `#!-sca-dump` to the SCA request socket. `wm_sca_request_thread` reads `sca-dump:<policy_id>:<first_scan>` and queues a request; `wm_sca_dump_db_thread` waits a random delay below `sca.request_db_interval` minutes (two seconds for a first scan), then resends every stored check of that policy followed by a `dump_end` message.

Sources: [src/wazuh_modules/wm_sca.c:3179-3230](repo://src/wazuh_modules/wm_sca.c#L3179-L3230), [src/wazuh_modules/wm_sca.c:3001-3060](repo://src/wazuh_modules/wm_sca.c#L3001-L3060), [src/wazuh_modules/wm_sca.c:3105-3115](repo://src/wazuh_modules/wm_sca.c#L3105-L3115)

## Rootcheck

Rootcheck is the older policy and anomaly scanner. It runs in a thread of `wazuh-syscheckd` (`w_rootcheck_thread`) and scans every `rootcheck.time` seconds when enabled. `run_rk_check` reads the rootkit file and trojan signature databases and the audit policy files under `ruleset/rootcheck/db`, then runs the built-in anomaly checks:

Sources: [src/rootcheck/run_rk_check.c:300-330](repo://src/rootcheck/run_rk_check.c#L300-L330), [src/rootcheck/run_rk_check.c:110-220](repo://src/rootcheck/run_rk_check.c#L110-L220)

| Check | Looks for |
| --- | --- |
| `check_rc_files`, `check_rc_trojans` | Known rootkit files and trojaned binaries |
| `check_rc_dev` | Unexpected files under `/dev` |
| `check_rc_sys` | Hidden files, suspicious permissions across the filesystem |
| `check_rc_pids` | Processes hidden from `ps` |
| `check_rc_ports` | Ports in use but hidden from `netstat` |
| `check_rc_if` | Interfaces in promiscuous mode |
| `check_rc_unixaudit`, `check_rc_win*` | Policy files in the legacy rootcheck format |

Sources: [src/rootcheck/run_rk_check.c:225-265](repo://src/rootcheck/run_rk_check.c#L225-L265)

Findings are sent with `notify_rk` to the queue with queue byte `9` (`ROOTCHECK_MQ`); results below policy-violation level are not sent. The standalone `rootcheck` binary prints the same results to the terminal instead.

Sources: [src/rootcheck/run_rk_check.c:19-58](repo://src/rootcheck/run_rk_check.c#L19-L58)
