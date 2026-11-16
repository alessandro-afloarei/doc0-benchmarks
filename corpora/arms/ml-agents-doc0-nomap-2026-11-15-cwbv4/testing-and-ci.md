---
title: "Testing and Continuous Integration"
---
## Overview

The repository is tested at three levels. Python unit and learning tests run with pytest against small Python-only environments, so trainers can be checked to actually learn without launching Unity. The Unity package has Editor and Runtime test assemblies run by Unity's test framework. Integration jobs build real Unity players and train or run inference against them. GitHub Actions run the Python tests and repository checks on every pull request; Unity's internal Yamato CI runs the Unity tests, coverage, builds and integration tests across editors and platforms.

Sources: [.github/workflows/pytest.yml:1-90](repo://.github/workflows/pytest.yml#L1-L90), [.yamato/com.unity.ml-agents-test.yml:1-40](repo://.yamato/com.unity.ml-agents-test.yml#L1-L40), [.yamato/training-int-tests.yml:1-43](repo://.yamato/training-int-tests.yml#L1-L43)

## Python tests

### Layout and markers

Trainer tests live in `ml-agents/mlagents/trainers/tests` (with network and algorithm tests under `torch_entities`), and environment API tests in `ml-agents-envs/tests`, covering the gym and PettingZoo wrappers, registry, RPC communicator and conversion, side channels, steps and timers. `pytest.ini` turns on strict markers and defines one marker, `slow`, for tests that train; the learning tests in `test_simple_rl.py` set it for the whole module.

Sources: [pytest.ini:1-4](repo://pytest.ini#L1-L4), [ml-agents/mlagents/trainers/tests/torch_entities/test_simple_rl.py:49-60](repo://ml-agents/mlagents/trainers/tests/torch_entities/test_simple_rl.py#L49-L60)

### Ports for parallel runs

Tests that open real communicators each need a free port. The root `conftest.py` provides a `base_port` fixture backed by a `PortAllocator` that hands out ports from 6005 upward, sharing the next free port between pytest-xdist workers through a file and a file lock in the temp directory, so the suite can run in parallel with `-n`.

Sources: [conftest.py:1-40](repo://conftest.py#L1-L40), [conftest.py:65-83](repo://conftest.py#L65-L83)

### Learning tests with simple environments

`simple_test_envs.py` implements `BaseEnv` without Unity. In `SimpleEnvironment` each agent has a position on `[-1, 1]` moved by its action (clamped to a step size) and is rewarded +1 for reaching the goal end and -1 for the other. Constructor options add visual, vector, variable-length and goal observations and set the continuous and discrete action sizes, so one environment exercises every encoder and action type. `MemoryEnvironment` only shows the goal on the first step, which requires recurrent memory; `MultiAgentEnvironment` runs several agents and groups; `RecordEnvironment` produces demonstrations; `UnexpectedExceptionEnvironment` raises on step.

Sources: [ml-agents/mlagents/trainers/tests/simple_test_envs.py:36-108](repo://ml-agents/mlagents/trainers/tests/simple_test_envs.py#L36-L108), [ml-agents/mlagents/trainers/tests/simple_test_envs.py:286-343](repo://ml-agents/mlagents/trainers/tests/simple_test_envs.py#L286-L343), [ml-agents/mlagents/trainers/tests/simple_test_envs.py:551-621](repo://ml-agents/mlagents/trainers/tests/simple_test_envs.py#L551-L621)

`check_environment_trains(env, trainer_config, ...)` wires such an environment into the real training stack: a `SimpleEnvManager`, a `TrainerFactory`, a `TrainerController` and a `DebugWriter` stats writer that prints cumulative rewards, all in a temporary output folder with seed 1337. After training it averages each behavior's last five episode rewards and asserts that they exceed a success threshold (0.9 by default). The tests in `test_simple_rl.py` call it for PPO, SAC and POCA with discrete, continuous and mixed actions, visual encoders, recurrent networks, variable-length observations, goal conditioning and self-play ([[Trainer Controller and Environment Managers]]).

Sources: [ml-agents/mlagents/trainers/tests/check_env_trains.py:14-99](repo://ml-agents/mlagents/trainers/tests/check_env_trains.py#L14-L99), [ml-agents/mlagents/trainers/tests/torch_entities/test_simple_rl.py:49-150](repo://ml-agents/mlagents/trainers/tests/torch_entities/test_simple_rl.py#L49-L150), [ml-agents/mlagents/trainers/tests/torch_entities/test_simple_rl.py:151-260](repo://ml-agents/mlagents/trainers/tests/torch_entities/test_simple_rl.py#L151-L260), [ml-agents/mlagents/trainers/tests/torch_entities/test_simple_rl.py:360-380](repo://ml-agents/mlagents/trainers/tests/torch_entities/test_simple_rl.py#L360-L380)

## GitHub Actions

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `pytest` | PRs touching the Python packages, pushes to main, develop and release branches, manual | Installs both packages, test requirements and the example plugin with pinned constraints on Python 3.10.12, runs pytest with coverage on 8 workers, `not slow` by default |
| `pre-commit` | every PR and push | Runs all pre-commit hooks, a markdown link check, and `utils/validate_meta_files.py` |
| `nightly` | daily at 07:00 UTC | Full markdown link check and the full pytest suite including slow tests |
| `publish_pypi` | `release_N` and `release_N_testM` tags | Verifies the tag against each package's version, builds sdist and wheel, publishes to TestPyPI or PyPI |
| `publish_docs`, `colab`, `lock`, `validate_catalog`, `publish_pypi_python_api` | various | Documentation publishing, Colab notebook checks and repository housekeeping |

Sources: [.github/workflows/pytest.yml:1-90](repo://.github/workflows/pytest.yml#L1-L90), [.github/workflows/pre-commit.yml:1-66](repo://.github/workflows/pre-commit.yml#L1-L66), [.github/workflows/nightly.yml:1-40](repo://.github/workflows/nightly.yml#L1-L40), [.github/workflows/publish_pypi.yaml:1-48](repo://.github/workflows/publish_pypi.yaml#L1-L48)

The pytest job sets `TEST_ENFORCE_BUFFER_KEY_TYPES=1`, which the test package reads to turn on `AgentBuffer.CHECK_KEY_TYPES_AT_RUNTIME`, so buffer keys are type-checked at run time during tests ([[Agent Processor and Trajectories]]).

Sources: [.github/workflows/pytest.yml:32-35](repo://.github/workflows/pytest.yml#L32-L35), [ml-agents/mlagents/trainers/tests/__init__.py:52-55](repo://ml-agents/mlagents/trainers/tests/__init__.py#L52-L55), [ml-agents/mlagents/trainers/buffer.py:254-300](repo://ml-agents/mlagents/trainers/buffer.py#L254-L300)

The publish workflow relies on the custom `verify` command in each `setup.py`, which exits with an error when the `GITHUB_REF` tag differs from the package's `__release_tag__`.

Sources: [ml-agents/setup.py:15-31](repo://ml-agents/setup.py#L15-L31), [.github/workflows/publish_pypi.yaml:27-30](repo://.github/workflows/publish_pypi.yaml#L27-L30)

## Yamato jobs

The `.yamato` folder defines Unity's CI. Package tests run on Windows, macOS and Linux with Unity 6000.0 against both `Project` and `DevProject`, with a coverage job that requires at least 72% coverage of the `Unity.ML-Agents` assembly. Other jobs pack, validate, publish and promote the package, build standalone and WebGL players, run performance tests, test protobuf generation, and exercise the Python APIs against built players.

Sources: [.yamato/com.unity.ml-agents-test.yml:1-40](repo://.yamato/com.unity.ml-agents-test.yml#L1-L40)

The training integration test depends on the Linux standalone build job and runs `ml-agents/tests/yamato/training_int_tests.py` with Python 3.10 in the `ml-agents/ubuntu-ci` image; it triggers on pull requests to main, develop or release branches that change the package, the example project or the Python packages, and keeps the build logs and trained models as artifacts. Helper scripts in `ml-agents/tests/yamato` cover standalone builds, the low-level API, gym and compressed sensors.

Sources: [.yamato/training-int-tests.yml:1-43](repo://.yamato/training-int-tests.yml#L1-L43), [ml-agents/tests/yamato/training_int_tests.py:1-40](repo://ml-agents/tests/yamato/training_int_tests.py#L1-L40)

## Unity package tests

`com.unity.ml-agents/Tests` holds an Editor test assembly (Academy, agents, actuators, sensors, analytics, communicator, demonstrations, inference and more) and a Runtime test assembly. They run in the Yamato package test and coverage jobs above. Analytics code paths are tested with `AnalyticsUtils.DisableAnalyticsSending` so events are built but not sent ([[Usage Analytics]]).

Sources: [com.unity.ml-agents/Tests/Editor/AcademyTests.cs:1-40](repo://com.unity.ml-agents/Tests/Editor/AcademyTests.cs#L1-L40), [com.unity.ml-agents/Runtime/Analytics/AnalyticsUtils.cs:44-63](repo://com.unity.ml-agents/Runtime/Analytics/AnalyticsUtils.cs#L44-L63)

## Repository utilities

| Script | Purpose |
| --- | --- |
| `utils/validate_versions.py` | Checks that `mlagents` and `mlagents_envs` declare the same `__version__`; can also set the version in both packages, the Unity `package.json` and `Academy.cs`, and print release-tag commands |
| `utils/validate_meta_files.py` | Checks Unity `.meta` files (run by the pre-commit workflow) |
| `utils/validate_inits.py` | Checks that Python package folders have `__init__.py` files |
| `utils/validate_release_links.py` | Checks documentation links and pip commands reference the current release |
| `utils/run_markdown_link_check.py` | Runs `markdown-link-check` over Markdown files |
| `utils/make_readme_table.py`, `utils/generate_markdown_docs.py` | Generate the release table and API Markdown docs |

Sources: [utils/validate_versions.py:1-60](repo://utils/validate_versions.py#L1-L60), [utils/validate_versions.py:94-147](repo://utils/validate_versions.py#L94-L147), [utils/validate_meta_files.py:1-30](repo://utils/validate_meta_files.py#L1-L30), [utils/validate_inits.py:1-40](repo://utils/validate_inits.py#L1-L40)

## Regenerating protobuf bindings

`protobuf-definitions/make.sh` regenerates both sides of the protocol ([[Communication Protocol]]). It deletes and recreates the C# output folder `com.unity.ml-agents/Runtime/Grpc/CommunicatorObjects` and the Python package `mlagents_envs/communicator_objects`, runs `protoc` for C# (with internal access), Python and mypy stubs, generates the gRPC service with the C# plugin and `grpc_tools.protoc`, wraps `UnityToExternalGrpc.cs` in the `UNITY_EDITOR || UNITY_STANDALONE` guard, and leaves an empty `__init__.py`. The `COMPILER` variable must first be pointed at a Grpc.Tools installation; the Yamato `protobuf-generation-test` job regenerates the bindings and fails with a patch artifact when `git diff` shows the committed files are out of date.

Sources: [protobuf-definitions/make.sh:1-53](repo://protobuf-definitions/make.sh#L1-L53), [protobuf-definitions/README.md:5-60](repo://protobuf-definitions/README.md#L5-L60), [.yamato/protobuf-generation-test.yml:1-30](repo://.yamato/protobuf-generation-test.yml#L1-L30)
