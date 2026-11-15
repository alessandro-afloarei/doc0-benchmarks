---
title: "Testing"
---
## Overview

Wazuh is tested at four levels, each with its own tooling. The C daemons have cmocka unit tests under `src/unit_tests`, built as a separate CMake project against an already compiled tree. The C++ modules (shared modules, syscollector, the data provider, the server modules and the engine) carry googletest suites next to their code, enabled by the same build flags described on [[Build System and Packaging]]. The Python framework and API have pytest suites inside their packages. Above those, `tests/integration` runs pytest against an installed manager or agent, and the engine has its own end-to-end suites under `src/engine/test`. The GitHub workflows in `.github/workflows` run each level.

Sources: [src/unit_tests/CMakeLists.txt:1-35](repo://src/unit_tests/CMakeLists.txt#L1-L35), [src/Makefile:148-155](repo://src/Makefile#L148-L155), [src/engine/test/README.md:1-12](repo://src/engine/test/README.md#L1-L12), [tests/integration/pytest.ini:1-12](repo://tests/integration/pytest.ini#L1-L12)

| Level | Location | Framework | Run with |
| --- | --- | --- | --- |
| C unit tests | `src/unit_tests` | cmocka, linker wrapping | `cmake -DTARGET=...` then `ctest` |
| C++ unit and component tests | `<module>/tests`, `src/engine/source/<module>/test` | googletest / gmock | `ctest` in the CMake build directory |
| Python unit tests | `framework/**/tests`, `api/api/test` | pytest | `python -m pytest framework`, `python -m pytest api/api` |
| Engine end-to-end | `src/engine/test` | Python tools, behave | `engine-it`, `engine-health-test`, `engine-helper-test` |
| Integration | `tests/integration` | pytest with `wazuh_testing` | `pytest --tier 0 --tier 1 test_<area>/` on an installed host |

Sources: [src/unit_tests/Readme.md:32-63](repo://src/unit_tests/Readme.md#L32-L63), [.github/workflows/5_testunit_engine.yml:27-35](repo://.github/workflows/5_testunit_engine.yml#L27-L35), [.github/workflows/5_testunit_framework.yml:42-49](repo://.github/workflows/5_testunit_framework.yml#L42-L49), [.github/workflows/5_testunit_api.yml:42-49](repo://.github/workflows/5_testunit_api.yml#L42-L49), [.github/workflows/4_testintegration_analysisd-tier-0-1.yml:66-80](repo://.github/workflows/4_testintegration_analysisd-tier-0-1.yml#L66-L80)

## C unit tests

### Building them

The C tests link against the objects of a real build, so Wazuh must first be compiled for the same target with debug and test options: `make TARGET=server|agent|winagent DEBUG=1 TEST=1`. Then, in `src/unit_tests`, a separate CMake build is configured with that target (`cmake -DTARGET=server|agent ..`; the Windows agent adds `-DCMAKE_TOOLCHAIN_FILE=../Toolchain-win32.cmake` and runs under wine). The project refuses to configure without `libwazuh.a`, `libwazuhext`, a valid `TARGET`, or the `lcov`, `gcov` and `genhtml` tools, and defines `WAZUH_UNIT_TESTING` for all sources.

Sources: [src/unit_tests/Readme.md:32-50](repo://src/unit_tests/Readme.md#L32-L50), [src/unit_tests/Readme.md:66-75](repo://src/unit_tests/Readme.md#L66-L75), [src/unit_tests/CMakeLists.txt:22-58](repo://src/unit_tests/CMakeLists.txt#L22-L58), [src/unit_tests/CMakeLists.txt:100-114](repo://src/unit_tests/CMakeLists.txt#L100-L114)

The target selects an include file (`server.cmake`, `agent.cmake`, `winagent.cmake`) that adds the subdirectories for that build and copies test configuration files (for FIM, anti-tampering, vulnerability detection) into the build tree. On the server, every test is compiled with `-O0 -coverage` and AddressSanitizer plus UndefinedBehaviorSanitizer, and linked with `-lcmocka` and the FIM eBPF library.

Sources: [src/unit_tests/CMakeLists.txt:36-98](repo://src/unit_tests/CMakeLists.txt#L36-L98), [src/unit_tests/server.cmake:1-24](repo://src/unit_tests/server.cmake#L1-L24)

### Mocking by linker wrapping

Each subdirectory turns the daemon's object files into a static library and builds one executable per test file. Dependencies are replaced with the GNU linker's `--wrap`: the list of flags for a test (for `test_manager` in remoted, dozens such as `-Wl,--wrap,OSHash_Get`, `-Wl,--wrap,wdb_get_agent_info`, `-Wl,--wrap,SendMSG`) makes every call to `f` land in `__wrap_f`, while `__real_f` still reaches the original. The loop at the end registers each executable with `add_test`.

Sources: [src/unit_tests/remoted/CMakeLists.txt:1-45](repo://src/unit_tests/remoted/CMakeLists.txt#L1-L45), [src/unit_tests/remoted/CMakeLists.txt:117-140](repo://src/unit_tests/remoted/CMakeLists.txt#L117-L140)

The wrappers live in `src/unit_tests/wrappers`, grouped by origin (`libc`, `posix`, `linux`, `windows`, `macos`, `externals` such as OpenSSL or SQLite, and `wazuh` for internal functions). A wrapper checks its arguments and returns a queued value with cmocka; wrappers that the daemon also needs during setup consult the global `test_mode` and fall through to the real function when it is off:

Sources: [src/unit_tests/wrappers/common.c:18-22](repo://src/unit_tests/wrappers/common.c#L18-L22), [src/unit_tests/wrappers/wazuh/shared/hash_op_wrappers.c:149-157](repo://src/unit_tests/wrappers/wazuh/shared/hash_op_wrappers.c#L149-L157)

```c
void *__real_OSHash_Get(const OSHash *self, const char *key);
void *__wrap_OSHash_Get(const OSHash *self, const char *key) {
    if (test_mode){
        check_expected(self);
        check_expected(key);
        return mock_type(void*);
    }
    return __real_OSHash_Get(self, key);
}
```

Sources: [src/unit_tests/wrappers/wazuh/shared/hash_op_wrappers.c:149-157](repo://src/unit_tests/wrappers/wazuh/shared/hash_op_wrappers.c#L149-L157)

A test sets `test_mode = 1` in its setup, declares the calls it expects (`expect_string(__wrap__mdebug1, formatted_msg, ...)`, `expect_function_call(__wrap_key_lock_write)`, `will_return`) and calls the function under test. Some tests include the daemon's `.c` file directly (`test_secure.c` includes `remoted/secure.c`) so they can reach its static functions. `main` lists the cases with `cmocka_unit_test_setup_teardown` and runs them as a group.

Sources: [src/unit_tests/remoted/test_manager.c:76-81](repo://src/unit_tests/remoted/test_manager.c#L76-L81), [src/unit_tests/remoted/test_secure.c:170-215](repo://src/unit_tests/remoted/test_secure.c#L170-L215), [src/unit_tests/remoted/test_secure.c:10-25](repo://src/unit_tests/remoted/test_secure.c#L10-L25), [src/unit_tests/remoted/test_secure.c:2283-2290](repo://src/unit_tests/remoted/test_secure.c#L2283-L2290)

### Running the C tests

In the build directory, `ctest` runs every test and writes details to `Testing/Temporary/LastTest.log`; a single test is an ordinary binary (`./test_create_db` inside `syscheckd`). `make coverage` zeroes the lcov counters, takes a baseline, runs `ctest`, captures counters with branch coverage, removes external code, the tests themselves and the C++ modules from the report, and writes an HTML report to `coverage-report`.

Sources: [src/unit_tests/Readme.md:50-63](repo://src/unit_tests/Readme.md#L50-L63), [src/unit_tests/CMakeLists.txt:115-138](repo://src/unit_tests/CMakeLists.txt#L115-L138)

## C++ tests

### Module suites

`make TEST=yes` passes `-DUNIT_TEST=ON` to the CMake projects of syscheck, DBSync, RSync, syscollector, sysinfo and the server tree, and builds googletest and Google Benchmark as external libraries. A module's `CMakeLists.txt` then links its library with coverage and adds its `tests` (and, for DBSync, `integrationTests`) directories; each test directory builds a gtest executable, for example `dbengine_unit_test` with `--coverage`.

Sources: [src/Makefile:148-155](repo://src/Makefile#L148-L155), [src/Makefile:896-904](repo://src/Makefile#L896-L904), [src/shared_modules/dbsync/CMakeLists.txt:99-108](repo://src/shared_modules/dbsync/CMakeLists.txt#L99-L108), [src/shared_modules/dbsync/tests/dbengine/CMakeLists.txt:1-40](repo://src/shared_modules/dbsync/tests/dbengine/CMakeLists.txt#L1-L40)

`src/build.py` runs the same suites for one module as part of its "ready to review" checks (tests, coverage thresholds, formatting), as described on [[Build System and Packaging]].

Sources: [src/build.py:1-60](repo://src/build.py#L1-L60)

### Engine suites

The engine has two switches. `make ENGINE_TEST=y` (without `TEST`) passes `-DWAZUH_ENGINE_TEST=ON`, which turns on `ENGINE_BUILD_TEST` and `ENGINE_BUILD_BENCHMARK`; `UNIT_TEST` (from `make DEBUG=1 TEST=1`) turns on the tests together with AddressSanitizer. With tests on, the engine registers the googletest and gmock libraries built under `external/googletest` and includes CTest.

Sources: [src/Makefile:896-904](repo://src/Makefile#L896-L904), [src/engine/CMakeLists.txt:34-45](repo://src/engine/CMakeLists.txt#L34-L45), [src/engine/CMakeLists.txt:154-174](repo://src/engine/CMakeLists.txt#L154-L174)

Each engine module keeps `test/mocks`, `test/src/unit` and `test/src/component`. The builder, for instance, exposes its mocks as `builder::mocks` for other modules, builds `builder_ctest` from the component tests (linked with the store, schema and definitions mocks) and `builder_utest` from the unit tests, and registers both with `gtest_discover_tests`. CI builds the server with `ENGINE_TEST=y` and runs `MALLOC_CHECK_=2 ctest -T test --output-on-failure` in the engine build directory.

Sources: [src/engine/source/builder/CMakeLists.txt:88-112](repo://src/engine/source/builder/CMakeLists.txt#L88-L112), [.github/workflows/5_testunit_engine.yml:27-35](repo://.github/workflows/5_testunit_engine.yml#L27-L35)

## Python unit tests

### Framework and API

The framework's tests sit in `tests` packages next to the code (`framework/wazuh/tests`, `framework/wazuh/core/tests`, ...) and the API's in `api/api/test`. `framework/pytest.ini` sets `asyncio_mode=auto`, so `async def` tests run without extra decorators. CI installs `framework/requirements-dev.txt` and runs `python -m pytest framework --ignore=tests --cov=framework`, and `python -m pytest api/api --ignore=test --cov=api` for the API.

Sources: [framework/pytest.ini:1-4](repo://framework/pytest.ini#L1-L4), [.github/workflows/5_testunit_framework.yml:42-49](repo://.github/workflows/5_testunit_framework.yml#L42-L49), [.github/workflows/5_testunit_api.yml:42-49](repo://.github/workflows/5_testunit_api.yml#L42-L49)

### Isolating the framework

Framework modules read the `wazuh` user and group at import time and decorate their functions with RBAC. Tests import them inside `patch('wazuh.core.common.wazuh_uid')` and `wazuh_gid`, replace `wazuh.rbac.orm` with a `MagicMock` while importing, and swap `expose_resources` for `RBAC_bypasser`, a decorator that calls the function unchanged, so a public function can be tested without an RBAC database ([[RBAC and Security]]).

Sources: [framework/wazuh/tests/test_agent.py:16-40](repo://framework/wazuh/tests/test_agent.py#L16-L40), [framework/wazuh/tests/util.py:53-61](repo://framework/wazuh/tests/util.py#L53-L61)

Data that would come from [[Wazuh DB]] is served from SQLite fixtures in `tests/data`: `InitAgent` loads `schema_global_test.sql` into an in-memory database with active, pending, never-connected and disconnected agents, and tests patch `WazuhDBConnection._send` with `send_msg_to_wdb`, which runs each query against that database.

Sources: [framework/wazuh/core/tests/test_agent.py:61-100](repo://framework/wazuh/core/tests/test_agent.py#L61-L100), [framework/wazuh/core/tests/test_agent.py:130-131](repo://framework/wazuh/core/tests/test_agent.py#L130-L131)

## Engine end-to-end tests

### The sandbox

These suites run a real engine binary in a throw-away directory. After installing the Python tools (`tools/api-communication`, `test/engine-test-utils`, `tools/engine-suite` and the suite packages) from `src/engine`, `setupEnvironment.py -e <dir>` creates `store/schema` with the engine, logpar-overrides and allowed-fields schemas, the `queue/sockets`, `kvdb` and `logs` directories, and copies the compiled `wazuh-engine` there; it stops if the engine has not been built. [[Engine Architecture and Startup]] describes what that binary loads.

Sources: [src/engine/test/README.md:14-55](repo://src/engine/test/README.md#L14-L55), [src/engine/test/setupEnvironment.py:9-37](repo://src/engine/test/setupEnvironment.py#L9-L37)

### Suites

| Suite | Tool | What it checks |
| --- | --- | --- |
| Integration (`integration_tests`) | `engine-it`, behave features | Catalog, KVDB, geo, policy, router and tester APIs working together |
| Helper (`helper_tests`) | `engine-helper-test` | Each helper function, from YAML descriptions in `helpers_description` |
| Health (`health_test`) | `engine-health-test` | Ruleset correctness: static metadata and schema checks, dynamic expected-output comparison |
| Acceptance (`acceptance_test`) | scripts | Performance of the engine against the legacy analysisd |

Sources: [src/engine/test/README.md:5-12](repo://src/engine/test/README.md#L5-L12), [src/engine/test/integration_tests/README.md:1-20](repo://src/engine/test/integration_tests/README.md#L1-L20), [src/engine/test/helper_tests/README.md:29-37](repo://src/engine/test/helper_tests/README.md#L29-L37), [src/engine/test/health_test/README.md:1-28](repo://src/engine/test/health_test/README.md#L1-L28)

### Running the engine suites

The integration suite is initialised once and then run whole or one feature at a time:

Sources: [src/engine/test/integration_tests/README.md:24-56](repo://src/engine/test/integration_tests/README.md#L24-L56)

```bash
./test/setupEnvironment.py -e /tmp/engine-integration-test
engine-it -e /tmp/engine-integration-test -t ./test/integration_tests init -b ./build/main
engine-it -e /tmp/engine-integration-test -t ./test/integration_tests run
engine-it -e /tmp/engine-integration-test -t ./test/integration_tests run -f test/integration_tests/catalog/api.feature
```

Sources: [src/engine/test/integration_tests/README.md:28-56](repo://src/engine/test/integration_tests/README.md#L28-L56)

The helper suite generates its test cases before running them: `init` loads the configuration, KVDBs and MaxMind test databases; `validate` checks the helper descriptions against their schema; `generate-tests` writes test cases (an asset using the helper, input events and the expected result) to an output directory; and `run` executes them. [[Engine Helper Functions]] covers the helpers themselves.

Sources: [src/engine/test/helper_tests/README.md:29-37](repo://src/engine/test/helper_tests/README.md#L29-L37), [src/engine/test/helper_tests/README.md:169-180](repo://src/engine/test/helper_tests/README.md#L169-L180)

The health suite has a static mode that inspects ruleset files (metadata, schema, mandatory mapping, custom field documentation, non-modifiable fields) and a dynamic mode that starts its own engine, loads decoders and rules, and compares the output for each `<test>_input.txt` line with the matching entry of `<test>_expected.json`. `engine-health-test run_all -e <env> -r <ruleset> -t <test_dir>` runs everything; because it loads assets into the environment, a second run needs a fresh environment. A failing test makes the exit code non-zero.

Sources: [src/engine/test/health_test/README.md:20-28](repo://src/engine/test/health_test/README.md#L20-L28), [src/engine/test/health_test/README.md:34-45](repo://src/engine/test/health_test/README.md#L34-L45), [src/engine/test/health_test/README.md:202-220](repo://src/engine/test/health_test/README.md#L202-L220), [src/engine/test/health_test/README.md:359-378](repo://src/engine/test/health_test/README.md#L359-L378), [src/engine/test/health_test/README.md:394-398](repo://src/engine/test/health_test/README.md#L394-L398)

## Integration tests

### Layout

`tests/integration` holds one directory per component (`test_fim`, `test_logcollector`, `test_remoted`, `test_analysisd`, `test_wazuh_db`, `test_api`, `test_authd`, `test_vulnerability_detector`, ...). The tests run on a host where Wazuh is installed and drive it as a user would: they rewrite `ossec.conf`, restart daemons, simulate agents or managers, and watch logs and sockets. Their helpers come from the `wazuh_testing` package of the separate `qa-integration-framework` repository, which CI clones on the matching branch and installs with pip.

Sources: [tests/integration/conftest.py:6-32](repo://tests/integration/conftest.py#L6-L32), [.github/workflows/4_testintegration_analysisd-tier-0-1.yml:66-80](repo://.github/workflows/4_testintegration_analysisd-tier-0-1.yml#L66-L80)

A test module is data-driven. It loads its cases from `data/test_cases/*.yaml` (each with a name, configuration parameters and metadata) and fills `data/configuration_templates/*.yaml` with them through `get_test_cases_data` and `load_configuration_template`, then parametrizes the test over the resulting configurations. Module-level `pytestmark` sets the host type and tier, and `daemons_handler_configuration` says which daemons to restart:

Sources: [tests/integration/test_remoted/test_active_response/test_active_response_send.py:21-41](repo://tests/integration/test_remoted/test_active_response/test_active_response_send.py#L21-L41), [tests/integration/test_remoted/test_active_response/data/test_cases/cases_ar.yaml:1-17](repo://tests/integration/test_remoted/test_active_response/data/test_cases/cases_ar.yaml#L1-L17)

```python
pytestmark = [pytest.mark.server, pytest.mark.tier(level=1)]
```

Sources: [tests/integration/test_remoted/test_active_response/test_active_response_send.py:25-25](repo://tests/integration/test_remoted/test_active_response/test_active_response_send.py#L25-L25)

### Shared fixtures

`tests/integration/conftest.py` provides the fixtures the modules combine: backing up and setting the Wazuh configuration from `test_configuration`, writing `local_internal_options.conf`, truncating monitored logs, file monitors, and `daemons_handler`, which restarts either all of Wazuh through `wazuh-control` or only the listed daemons before the test and stops them afterwards (in reverse order for the API daemons). `ignore_errors` lets a test start daemons with an invalid configuration on purpose.

Sources: [tests/integration/conftest.py:139-176](repo://tests/integration/conftest.py#L139-L176), [tests/integration/conftest.py:271-300](repo://tests/integration/conftest.py#L271-L300), [tests/integration/conftest.py:302-390](repo://tests/integration/conftest.py#L302-L390)

### Selecting tests

`pytest.ini` enforces declared markers: `tier(level)`, the platforms `linux`, `win32`, `darwin`, `sunos5`, and the host types `server` and `agent`. `pytest_collection_modifyitems` deselects tests whose platform marks exclude the current OS, whose host type marks exclude the installed service (agent or server), or whose first tier is outside `--tier`, `--tier-minimum` and `--tier-maximum`. CI runs tiers 0 and 1 per component (`python -m pytest --tier 0 --tier 1 test_analysisd/`) and tier 2 in separate workflows.

Sources: [tests/integration/pytest.ini:1-12](repo://tests/integration/pytest.ini#L1-L12), [tests/integration/conftest.py:37-115](repo://tests/integration/conftest.py#L37-L115), [.github/workflows/4_testintegration_analysisd-tier-0-1.yml:76-80](repo://.github/workflows/4_testintegration_analysisd-tier-0-1.yml#L76-L80)
