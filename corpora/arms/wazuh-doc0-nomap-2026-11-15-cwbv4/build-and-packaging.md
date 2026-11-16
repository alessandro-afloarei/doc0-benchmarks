---
title: "Build System and Packaging"
---
## Overview

Wazuh is built by one GNU Makefile (`src/Makefile`) that compiles the C daemons directly and drives CMake for the C++ parts: the shared modules, syscollector and the data provider, FIM's database layer, the server modules and the analysis engine. Third-party libraries are downloaded as prebuilt-source tarballs into `src/external` and compiled once. On top of that, `packages/` contains Docker-based scripts that run the build and produce `.deb`, `.rpm`, macOS, Windows MSI, Solaris, AIX, HP-UX and WPK packages. [[Quickstart: Build and Install]] shows the short path; this page explains the pieces.

Sources: [src/Makefile:586-605](repo://src/Makefile#L586-L605), [src/CMakeLists.txt:130-142](repo://src/CMakeLists.txt#L130-L142), [packages/README.md:1-12](repo://packages/README.md#L1-L12)

## Targets

`TARGET` is mandatory and selects what is built:

Sources: [src/Makefile:596-605](repo://src/Makefile#L596-L605)

| Target | Builds |
| --- | --- |
| `server` | All manager daemons (`BUILD_SERVER`) and the CMake projects, including the engine |
| `local` | The same binaries, for a stand-alone local installation |
| `hybrid` | The same binaries; the installer also configures an agent |
| `agent` | Unix agent daemons (`BUILD_AGENT`) |
| `winagent` | Windows agent, cross-compiled with MinGW |

Sources: [src/Makefile:680-760](repo://src/Makefile#L680-L760), [install.sh:880-895](repo://install.sh#L880-L895), [install.sh:1014-1025](repo://install.sh#L1014-L1025)

`make build` (`build: ${TARGET}`) runs the selected rule; each one depends on `external` (the third-party libraries) and then builds the CMake projects in `BUILD_CMAKE_PROJECTS` before the C binaries. Common options are `DEBUG=yes` (debug CMake build types), `TEST=yes` (unit tests and googletest), `DISABLE_SYSC=yes`, `USE_AUDIT=yes`, `USE_SELINUX=yes`, and `INSTALLDIR`.

Sources: [src/Makefile:586-590](repo://src/Makefile#L586-L590), [src/Makefile:607-640](repo://src/Makefile#L607-L640), [src/Makefile:155-165](repo://src/Makefile#L155-L165)

## External dependencies

`make deps` downloads one tarball per library in `EXTERNAL_RES` (cJSON, curl, libdb, libffi, libyaml, OpenSSL, procps, SQLite, zlib, audit, msgpack, bzip2, nlohmann JSON, googletest, PCRE2, libplist, pacman, libarchive, popt, Lua, rpm, RocksDB, lzma, cpp-httplib, benchmark, libbpf) from `RESOURCES_URL`; combined with `deps`, `EXTERNAL_SRC_ONLY=yes` downloads only the sources that are compiled as part of the build. Server builds add the engine's libraries: simdjson, spdlog, yaml-cpp, pugixml, libmaxminddb, date, fmt, fast_float, protobuf, abseil and re2. Each is built in its own `build` directory with fixed CMake options, for example RocksDB without tools or tests and with position-independent code.

Sources: [src/Makefile:1348-1349](repo://src/Makefile#L1348-L1349), [src/Makefile:1428-1453](repo://src/Makefile#L1428-L1453), [src/Makefile:906-910](repo://src/Makefile#L906-L910), [src/Makefile:979-1041](repo://src/Makefile#L979-L1041)

The top-level `src/CMakeLists.txt` can also download a missing dependency itself (`check_and_download_dep`), so CMake-only builds of the server modules work from a clean tree.

Sources: [src/CMakeLists.txt:1-60](repo://src/CMakeLists.txt#L1-L60)

## CMake projects

### Agent-side libraries

`build_shared_modules` configures and builds DBSync and RSync, `build_sysinfo` the data provider, `build_syscollector` the syscollector module, and the FIM database library is built from `syscheckd`. Each uses `cmake ${CMAKE_OPTS} ... && make` in its own directory, which also works for Windows through the MinGW toolchain options.

Sources: [src/Makefile:780-806](repo://src/Makefile#L780-L806), [src/Makefile:134-136](repo://src/Makefile#L134-L136)

### Server tree

For server targets, `build_wazuh_cmake` configures `src/CMakeLists.txt` with `-DTARGET=server`. It requires C++17, defaults to a `Release` build (`RelWithDebInfo` when symbols are requested), and adds the shared utilities, router, content manager, HTTP request library, indexer connector, vulnerability scanner, keystore, inventory harvester and the engine. The engine builds the `wazuh-engine` executable, which the installer copies as `wazuh-analysisd`.

Sources: [src/Makefile:1822-1823](repo://src/Makefile#L1822-L1823), [src/CMakeLists.txt:1-15](repo://src/CMakeLists.txt#L1-L15), [src/CMakeLists.txt:130-142](repo://src/CMakeLists.txt#L130-L142), [src/engine/CMakeLists.txt:187-187](repo://src/engine/CMakeLists.txt#L187-L187)

### Module quality checks

`src/build.py` wraps the C++ module workflow used before opening a pull request: `-r <module>` runs the "ready to review" checks (among them coverage thresholds and `astyle` formatting), `-m` compiles a module, and `-d` runs the checks and cleans up.

Sources: [src/build.py:1-60](repo://src/build.py#L1-L60), [src/ci/run_check.py:20-60](repo://src/ci/run_check.py#L20-L60), [src/ci/run_check.py:115-140](repo://src/ci/run_check.py#L115-L140)

## Packages

### Linux packages

`packages/generate_package.sh -t manager|agent -a <arch> --system deb|rpm` builds a Docker image from `packages/<debs|rpms>/<arch>/<target>/Dockerfile`, copies `build.sh` into it, and runs it with the output directory mounted. Inside, `build.sh` prepares the source directory and calls the `build_package` helper for the format, which runs `debuild` or `rpmbuild` with the specs in `packages/debs/SPECS` and `packages/rpms/SPECS`; the Debian maintainer scripts, for example, create the `wazuh` system user in `postinst`. Options cover revision, debug symbols, checksums and the CentOS 5 legacy build.

Sources: [packages/generate_package.sh:70-90](repo://packages/generate_package.sh#L70-L90), [packages/build.sh:80-121](repo://packages/build.sh#L80-L121), [packages/debs/utils/helper_function.sh:49-58](repo://packages/debs/utils/helper_function.sh#L49-L58), [packages/rpms/utils/helper_function.sh:48-60](repo://packages/rpms/utils/helper_function.sh#L48-L60), [packages/debs/SPECS/wazuh-manager/debian/postinst:30-35](repo://packages/debs/SPECS/wazuh-manager/debian/postinst#L30-L35), [packages/README.md:14-40](repo://packages/README.md#L14-L40)

### Other platforms

| Directory | Produces |
| --- | --- |
| `packages/macos` | macOS `.pkg` with pre/post-install scripts and entitlements |
| `packages/windows` | Cross-compiled Windows agent and the MSI (`generate_wazuh_msi.ps1`) |
| `packages/solaris`, `packages/aix`, `packages/hp-ux` | Agent packages built on those systems |
| `packages/wpk` | WPK upgrade packages |

Sources: [packages/macos/generate_wazuh_packages.sh:1-20](repo://packages/macos/generate_wazuh_packages.sh#L1-L20), [packages/windows/generate_compiled_windows_agent.sh:1-20](repo://packages/windows/generate_compiled_windows_agent.sh#L1-L20)

### WPK packages

A WPK is what [[Agent Upgrades and Task Manager]] sends to agents. `generate_wpk_package.sh` takes a built package (deb, rpm, apk, msi or pkg) and runs `wpkpack.py` in a container: it merges the package and installer scripts into one file, gzips it, and signs the result with the WPK private key and certificate, either from a key directory or from AWS Secrets Manager. The agent verifies that signature before unpacking.

Sources: [packages/wpk/README.md:1-25](repo://packages/wpk/README.md#L1-L25), [packages/wpk/wpkpack.py:29-112](repo://packages/wpk/wpkpack.py#L29-L112), [src/wazuh_modules/agent_upgrade/agent/wm_agent_upgrade_com.c:325-340](repo://src/wazuh_modules/agent_upgrade/agent/wm_agent_upgrade_com.c#L325-L340)
