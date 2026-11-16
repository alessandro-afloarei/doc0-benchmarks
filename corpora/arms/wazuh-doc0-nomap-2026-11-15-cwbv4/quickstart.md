---
title: "Quickstart: Build and Install"
---
## Overview

This page takes a checkout of the repository to a running manager or agent: fetch the third-party dependencies, compile for one target, install under `/var/ossec`, and control the daemons with `wazuh-control`. How the Makefile is organized, the CMake projects and the package scripts are on [[Build System and Packaging]]; what the installed daemons do is on [[Wazuh Overview]].

Sources: [install.sh:50-154](repo://install.sh#L50-L154)

## Prerequisites

The build needs a C/C++ toolchain, `make`, CMake, and the autotools used by some external libraries. The `INSTALL` file lists the packages per distribution (for Debian and Ubuntu: `python gcc g++ make libc6-dev curl policycoreutils automake autoconf libtool`) and states gcc/g++ 5.5 and CMake 3.12.4 as the minimum versions.

Sources: [INSTALL:56-79](repo://INSTALL#L56-L79)

## Build with install.sh

### Interactive install

`./install.sh` asks for the language, the install type (manager, agent, local, or hybrid), the install directory, and which capabilities to enable. Its `Install` function then picks `make` or `gmake` for the platform, enters `src`, downloads the dependencies when `external/` is empty, and runs the build for the chosen type:

Sources: [install.sh:50-99](repo://install.sh#L50-L99)

```bash
find external/* > /dev/null 2>&1 || ${MAKEBIN} deps ${ALPINE_DEPS} TARGET=${INSTYPE}
...
${MAKEBIN} TARGET=${INSTYPE} INSTALLDIR=${INSTALLDIR} ${SYSC_FLAG} ${MSGPACK_FLAG} ${AUDIT_FLAG} ${CPYTHON_FLAGS} -j${THREADS} build
```

Sources: [install.sh:100-117](repo://install.sh#L100-L117)

After the build it stops a running installation when updating, calls `InstallWazuh` (which dispatches to `InstallAgent`, `InstallServer` or `InstallLocal`), creates the boot script with `runInit`, and starts Wazuh.

Sources: [install.sh:119-150](repo://install.sh#L119-L150), [src/init/inst-functions.sh:1452-1462](repo://src/init/inst-functions.sh#L1452-L1462)

### Unattended install

Every question has a `USER_*` variable in `etc/preloaded-vars.conf`; set it there and the script uses the value instead of asking. The common ones are `USER_INSTALL_TYPE` (`server`, `agent` or `local`), `USER_DIR`, `USER_NO_STOP`, `USER_ENABLE_SYSCHECK`, `USER_ENABLE_ROOTCHECK`, `USER_AGENT_SERVER_IP`, and `USER_BINARYINSTALL`. Passing `binary-install` on the command line sets `USER_BINARYINSTALL`, which skips compiling and installs what a previous build left in `src`.

Sources: [etc/preloaded-vars.conf:35-120](repo://etc/preloaded-vars.conf#L35-L120), [install.sh:33-45](repo://install.sh#L33-L45)

## Build by hand

The same steps work without the installer, from `src`: download the dependencies once, then build one target.

Sources: [src/Makefile:586-605](repo://src/Makefile#L586-L605)

```bash
cd src
make deps TARGET=server
make TARGET=server -j$(nproc)
```

Sources: [src/Makefile:1446-1453](repo://src/Makefile#L1446-L1453), [src/Makefile:586-605](repo://src/Makefile#L586-L605)

`deps` downloads one tarball per entry in `EXTERNAL_RES` (cJSON, curl, OpenSSL, SQLite, RocksDB, msgpack, googletest and others) from `RESOURCES_URL`. A build without `TARGET` fails with the list of valid targets: `server`, `local`, `hybrid`, `agent` and `winagent`. `make help` prints the options, such as `DEBUG=yes`, `USE_AUDIT=yes`, `DISABLE_SYSC=yes` and `INSTALLDIR=/path`, which is mandatory when the Python interpreter is built from sources.

Sources: [src/Makefile:1348-1349](repo://src/Makefile#L1348-L1349), [src/Makefile:1428-1453](repo://src/Makefile#L1428-L1453), [src/Makefile:596-630](repo://src/Makefile#L596-L630)

## What a server install adds

`InstallServer` runs `InstallLocal` and then copies the shared libraries built by CMake (`librouter.so`, `libcontent_manager.so`, `libvulnerability_scanner.so` and others) into `lib/`. `InstallLocal` installs the engine binary as `bin/wazuh-analysisd` and calls `installEngineStore`, which seeds the engine's file store with three documents taken from `src/engine/ruleset/schemas`: the engine schema, the logpar overrides, and the allowed fields. The engine refuses to start without the logpar overrides, so a hand-made install must copy them too.

Sources: [src/init/inst-functions.sh:1035-1072](repo://src/init/inst-functions.sh#L1035-L1072), [src/init/inst-functions.sh:1104-1115](repo://src/init/inst-functions.sh#L1104-L1115), [src/init/inst-functions.sh:1210-1240](repo://src/init/inst-functions.sh#L1210-L1240), [src/engine/source/main.cpp:392-400](repo://src/engine/source/main.cpp#L392-L400)

## Run it

`bin/wazuh-control` is the installed copy of `src/init/wazuh-server.sh` (or `wazuh-client.sh` on an agent). It reads the action from its first argument and the daemon name or flag from the second.

Sources: [src/init/wazuh-server.sh:595-600](repo://src/init/wazuh-server.sh#L595-L600)

| Command | Effect |
| --- | --- |
| `wazuh-control start` | Checks the configuration, takes the start lock and starts every daemon |
| `wazuh-control stop` | Stops every daemon in reverse order |
| `wazuh-control restart` | Stops and starts |
| `wazuh-control reload` | Restarts every daemon except `wazuh-execd` |
| `wazuh-control status` | Prints which daemons are running |
| `wazuh-control enable\|disable <name>` | Turns an optional daemon (such as `wazuh-clusterd`) on or off |
| `wazuh-control info [-v\|-r\|-t]` | Prints version, revision and install type, or one of them |

Sources: [src/init/wazuh-server.sh:550-570](repo://src/init/wazuh-server.sh#L550-L570), [src/init/wazuh-server.sh:600-644](repo://src/init/wazuh-server.sh#L600-L644)

`start_service` empties `tmp/` (keeping vulnerability feed archives), kills daemons whose names were deprecated, and starts each daemon; it skips `wazuh-clusterd` when the cluster is disabled. [[Service Control and Monitord]] follows the start and stop sequence in detail, and [[Configuration Loading (ossec.conf)]] explains the configuration the `start` action checks first.

Sources: [src/init/wazuh-server.sh:300-330](repo://src/init/wazuh-server.sh#L300-L330)

## Connect an agent

On an agent install, `ConfigureClient` asks for the manager's address, accepting an IPv4 address (`SERVER_IP`) or a host name (`HNAME`); `USER_AGENT_SERVER_IP` or `USER_AGENT_SERVER_NAME` skip the question. It then asks about syscheck, rootcheck, syscollector and SCA. When the agent starts without a key it enrolls itself through the manager's `wazuh-authd`, which [[Agent Enrollment (authd)]] describes; [[Agent Daemon (agentd)]] covers the connection that follows.

Sources: [install.sh:325-360](repo://install.sh#L325-L360)
