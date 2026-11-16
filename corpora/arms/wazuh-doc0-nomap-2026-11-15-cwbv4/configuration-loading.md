---
title: "Configuration Loading (ossec.conf)"
---
## Overview

Every C daemon reads the same XML file, `etc/ossec.conf`, but each one only parses the sections it owns. Agents also read a second file, `etc/shared/agent.conf`, that the manager distributes to agent groups. Tuning values that users rarely change live in a separate key-value file, `etc/internal_options.conf`, overridden by `etc/local_internal_options.conf`. The analysis engine reads only that last pair. This page follows how each of these is read; what each section means is on the page of the component that owns it.

Sources: [src/headers/defs.h:160-167](repo://src/headers/defs.h#L160-L167), [src/headers/defs.h:259-266](repo://src/headers/defs.h#L259-L266), [src/headers/defs.h:326-331](repo://src/headers/defs.h#L326-L331)

## ReadConfig and section flags

### The module bit mask

A daemon calls `ReadConfig(modules, cfgfile, d1, d2)` with a bit mask that names the sections it wants and two opaque pointers that the section readers fill. The flags are octal constants such as `CSYSCHECK`, `CLOCALFILE`, `CREMOTE`, `CCLIENT`, `CAR` (active response), `CWMODULE`, `CAUTHD`, `CBUFFER`, `CCLUSTER` and `WAZUHDB`. `CAGENT_CONFIG` is not a section: it switches the reader into shared-configuration mode.

Sources: [src/config/config.h:14-50](repo://src/config/config.h#L14-L50)

### Reading the file

`ReadConfig` parses the whole file with `OS_ReadXML`, then walks the root elements. In normal mode it only accepts `<ossec_config>` blocks; in `CAGENT_CONFIG` mode it only accepts `<agent_config>` blocks. Any other root element is an error, and a file can hold several `<ossec_config>` blocks, each read in order.

Sources: [src/config/config.c:258-320](repo://src/config/config.c#L258-L320), [src/config/config.c:432-445](repo://src/config/config.c#L432-L445)

### Dispatching sections

`read_main_elements` maps each child element to its reader, and calls the reader only when the matching flag is set. A daemon that did not ask for `<syscheck>` skips it without validating it, so a typo in a section is reported by the daemon that owns it.

Sources: [src/config/config.c:61-80](repo://src/config/config.c#L61-L80)

| Element | Flag | Reader |
| --- | --- | --- |
| `global` | `CGLOBAL`, `CMAIL` | `Read_Global` |
| `syscheck` | `CSYSCHECK` | `Read_Syscheck` |
| `rootcheck` | `CROOTCHECK` | `Read_Rootcheck` |
| `localfile` | `CLOCALFILE` | `Read_Localfile` |
| `remote` | `CREMOTE` | `Read_Remote` |
| `client` | `CCLIENT` | `Read_Client`, or `Read_Client_Shared` in agent.conf |
| `client_buffer` | `CBUFFER` | `Read_ClientBuffer` |
| `command`, `active-response` | `CAR` | `ReadActiveCommands`, `ReadActiveResponses` |
| `wodle`, `sca`, `vulnerability-detection`, `indexer`, `gcp-pubsub`, `gcp-bucket`, `github`, `office365`, `ms-graph`, `agent-upgrade`, `task-manager` | `CWMODULE` | `Read_WModule` and the module readers |
| `auth` | `CAUTHD` | `Read_Authd` |
| `labels` | `CLABELS` | `Read_Labels` |
| `cluster` | `CCLUSTER` | `Read_Cluster` |
| `socket` | `CLGCSOCKET` | `Read_LogCollecSocket` |
| `wdb` | `WAZUHDB` | `Read_WazuhDB` |

Sources: [src/config/config.c:19-130](repo://src/config/config.c#L19-L130), [src/config/config.c:130-238](repo://src/config/config.c#L130-L238)

The old `<vulnerability-detector>` element is still accepted and read by the same function as `<vulnerability-detection>` with an `old_vd` flag. The `<logging>` element is matched and ignored here, because logging format is read elsewhere.

Sources: [src/config/config.c:143-175](repo://src/config/config.c#L143-L175), [src/config/config.c:194-196](repo://src/config/config.c#L194-L196)

On failure `ReadConfig` returns `OS_INVALID` and `PrintErrorAcordingToModules` logs it: as a warning when only syscheck or rootcheck was being read, as an error otherwise.

Sources: [src/config/config.c:447-458](repo://src/config/config.c#L447-L458)

## How a daemon reads its configuration

Each daemon calls `ReadConfig` from its own config function, usually twice on an agent: once for `ossec.conf` and once for `agent.conf`. Logcollector is typical: it fails when `ossec.conf` is invalid, but on an agent (`CLIENT` builds) it then adds `CAGENT_CONFIG` and reads `AGENTCONFIG` without checking the result, so a broken shared file never stops the agent.

Sources: [src/logcollector/config.c:86-95](repo://src/logcollector/config.c#L86-L95)

```c
if (ReadConfig(modules, cfgfile, &log_config, NULL) < 0) {
    return (OS_INVALID);
}

#ifdef CLIENT
modules |= CAGENT_CONFIG;
log_config.agent_cfg = 1;
ReadConfig(modules, AGENTCONFIG, &log_config, NULL);
log_config.agent_cfg = 0;
#endif
```

Sources: [src/logcollector/config.c:86-95](repo://src/logcollector/config.c#L86-L95)

The modules daemon follows the same pattern for `CWMODULE`; on the manager it reads the router module instead of an `agent.conf`. Agentd reads its `client` section and then a second pass for labels and the client buffer, each into a different structure.

Sources: [src/wazuh_modules/wmodules.c:70-90](repo://src/wazuh_modules/wmodules.c#L70-L90), [src/client-agent/config.c:55-80](repo://src/client-agent/config.c#L55-L80)

## Shared agent configuration

`agent.conf` holds one or more `<agent_config>` blocks. In `CAGENT_CONFIG` mode `ReadConfig` returns at once when the internal option `agent.remote_conf` is `0`, so an agent can refuse centralized configuration. Each block may carry filters, which agents evaluate with `OS_Match2` against their own data:

Sources: [src/config/config.c:275-277](repo://src/config/config.c#L275-L277), [src/config/config.c:327-344](repo://src/config/config.c#L327-L344)

| Attribute | Matched against |
| --- | --- |
| `name` | The agent name from its key |
| `os` | The `uname` string |
| `profile` | The agent's `<config-profile>` list |
| `overwrite` | Accepted, not a filter |

Sources: [src/config/config.c:269-277](repo://src/config/config.c#L269-L277), [src/config/config.c:320-399](repo://src/config/config.c#L320-L399)

A block with no attributes is generic. A block whose filter does not match is skipped, and its sections are only parsed when `passed_agent_test` is still set. The filter checks are compiled only into agents (`#ifdef CLIENT`), so on the manager every block passes. How the file reaches the agent (the `merged.mg` bundle) is on [[Agent Daemon (agentd)]].

Sources: [src/config/config.c:400-431](repo://src/config/config.c#L400-L431)

## Internal options

`getDefine_Int(high, low, min, max)` looks up `high.low` in `local_internal_options.conf` first and falls back to `internal_options.conf`. A missing key, a non-numeric value, or a value outside `[min, max]` calls `merror_exit`, so a bad internal option stops the daemon at start rather than running with a guessed value. Remoted, for example, reads `remoted.worker_pool` with bounds 1 to 16.

Sources: [src/shared/validate_op.c:259-291](repo://src/shared/validate_op.c#L259-L291), [src/shared/validate_op.c:90-175](repo://src/shared/validate_op.c#L90-L175), [src/remoted/secure.c:275-283](repo://src/remoted/secure.c#L275-L283)

## Engine configuration

The engine does not parse `ossec.conf`. Its `FileLoader` reads `internal_options.conf` and then `local_internal_options.conf`, keeps only lines whose key starts with `analysisd.`, strips inline `#` comments and outer quotes, and lets the local file override. Each key is registered with a default and an environment variable; `Conf::get` returns the environment variable first, then the file value, then the default.

Sources: [src/engine/source/conf/src/fileLoader.cpp:33-120](repo://src/engine/source/conf/src/fileLoader.cpp#L33-L120), [src/engine/source/conf/include/conf/conf.hpp:142-190](repo://src/engine/source/conf/include/conf/conf.hpp#L142-L190)

`Conf::load` validates every file value against its unit type before storing it: integers must parse completely, and string lists must be comma separated without brackets. [[Engine Architecture and Startup]] lists the keys and their defaults.

Sources: [src/engine/source/conf/src/conf.cpp:105-180](repo://src/engine/source/conf/src/conf.cpp#L105-L180), [src/engine/source/conf/src/conf.cpp:200-209](repo://src/engine/source/conf/src/conf.cpp#L200-L209)

## Checking a configuration

`wazuh-control start` runs every daemon with `-t` before starting any. A daemon that fails the test leaves `var/run/<daemon>.failed`, and the script prints `Configuration error` and exits without starting anything. The engine honors `-t` by calling `os_logging_config` from `libwazuhshared.so`.

Sources: [src/init/wazuh-server.sh:221-241](repo://src/init/wazuh-server.sh#L221-L241), [src/engine/source/main.cpp:142-154](repo://src/engine/source/main.cpp#L142-L154)

## Generating ossec.conf

The installer builds `ossec.conf` from fragments under `etc/templates/config`. `GetTemplate` looks for each fragment in the most specific directory first: `<distribution>/<version>/<subversion>/`, then `<distribution>/<version>/`, then `<distribution>/`, and finally `generic/`. `WriteManager`, `WriteAgent` and `WriteLocal` concatenate the fragments (global, logging, remote, rootcheck, syscollector, and so on) inside one `<ossec_config>`.

Sources: [src/init/template-select.sh:12-34](repo://src/init/template-select.sh#L12-L34), [src/init/inst-functions.sh:473-513](repo://src/init/inst-functions.sh#L473-L513)

`gen_ossec.sh conf <install_type> <distribution> <version> [path]` runs the same writers outside the installer and prints the generated file to standard output.

Sources: [gen_ossec.sh:24-76](repo://gen_ossec.sh#L24-L76)

```bash
./gen_ossec.sh conf manager ubuntu 22.04
```

Sources: [gen_ossec.sh:15-76](repo://gen_ossec.sh#L15-L76)
