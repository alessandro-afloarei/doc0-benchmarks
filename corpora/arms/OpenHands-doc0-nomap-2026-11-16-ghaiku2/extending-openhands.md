---
title: "Extending OpenHands"
---
## Overview

Most of the systems in OpenHands are chosen by name from configuration. Several of those names are dotted paths to a class that the deployment supplies, and the others are keys in a table. A deployment that needs different behaviour can supply its own class for an agent, a runtime, a conversation manager, a store or an experiment, and leave the rest unchanged. The enterprise package in `enterprise/` is the main user of this mechanism: it replaces the OSS server configuration and stacks its own middleware on the OSS app. This page lists the extension points, how each is loaded, and the rules a replacement must follow. The systems themselves are on the pages each one links to.

Sources: [openhands/utils/import_utils.py:1-30](repo://openhands/utils/import_utils.py#L1-L30), [enterprise/README.md:1-20](repo://enterprise/README.md#L1-L20)

## How a class is loaded

`import_from` imports a value from its fully qualified name, so `package.module.Class` becomes the class object. `get_impl` does that and then checks that the class is the base class or a subclass of it, so a replacement that does not extend the right base fails at load time. Results are cached per base class and name, so a name is imported once per process.

Sources: [openhands/utils/import_utils.py:8-33](repo://openhands/utils/import_utils.py#L8-L33), [openhands/utils/import_utils.py:34-70](repo://openhands/utils/import_utils.py#L34-L70)

When the name is `None`, `get_impl` returns the base class itself, which is how the OSS default is used when nothing is configured.

Sources: [openhands/utils/import_utils.py:34-41](repo://openhands/utils/import_utils.py#L34-L41)

## Extension points

| Extension point | Base class | Selected by | Where it is loaded |
| --- | --- | --- | --- |
| Agent | `Agent` | `config.agents.<name>.classpath` | [[Agents and the Agent Registry]] |
| Runtime | `Runtime` | `runtime` name or a dotted path | [[Runtime Implementations]] |
| Condenser | `Condenser` | the `type` in `[condenser]` | [[Condensers]] |
| Security analyser | `SecurityAnalyzer` | `security_analyzer` name | [[Security Analyzers]] |
| Conversation manager | `ConversationManager` | `conversation_manager_class` | [[Conversation Lifecycle]] |
| Settings, secrets and conversation stores | `SettingsStore`, `SecretsStore`, `ConversationStore` | `settings_store_class`, `secret_store_class`, `conversation_store_class` | [[File Stores and Settings]] |
| Server config | `ServerConfig` | the `OPENHANDS_CONFIG_CLS` environment variable | [[Server Application]] |
| User authentication | `UserAuth` | its implementation name | [[Server Application]] |
| Experiment manager | `ExperimentManager` | its class name | [[Conversation Lifecycle]] |

Sources: [openhands/core/config/utils.py:796-817](repo://openhands/core/config/utils.py#L796-L817), [openhands/runtime/__init__.py:90-103](repo://openhands/runtime/__init__.py#L90-L103), [openhands/server/shared.py:61-77](repo://openhands/server/shared.py#L61-L77), [openhands/server/config/server_config.py:14-30](repo://openhands/server/config/server_config.py#L14-L30), [openhands/server/config/server_config.py:52-60](repo://openhands/server/config/server_config.py#L52-L60), [openhands/server/user_auth/user_auth.py:85-92](repo://openhands/server/user_auth/user_auth.py#L85-L92), [openhands/experiments/experiment_manager.py:60-64](repo://openhands/experiments/experiment_manager.py#L60-L64)

## Custom agents

An agent is added to the configuration by giving an `[agent.<name>]` section a `classpath`. At load time `register_custom_agents` imports the class and registers it under that name, so `default_agent` or a delegate can name it. A class that fails to import is logged and not registered, and the rest of the configuration still loads.

Sources: [openhands/core/config/utils.py:796-818](repo://openhands/core/config/utils.py#L796-L818), [openhands/controller/agent.py:121-135](repo://openhands/controller/agent.py#L121-L135)

## Third-party runtimes

Packages under `third_party/runtime/impl` are discovered when the runtime module loads. For each package, the loader imports the module `<name>.<name>_runtime` and takes the class named `<NAME>Runtime` or `<Name>Runtime`. A package whose import fails with an `ImportError` is skipped quietly, and one that fails for another reason logs a warning. The discovered runtimes are then available under their package names, alongside the built-in ones.

Sources: [openhands/runtime/__init__.py:24-87](repo://openhands/runtime/__init__.py#L24-L87), [openhands/runtime/__init__.py:118-119](repo://openhands/runtime/__init__.py#L118-L119)

## The enterprise server

The enterprise package builds on the OSS code in two ways, as its README explains. It stacks middleware on the OSS middleware, so both run in the SaaS mode. It also overrides OSS classes: the enterprise server configuration replaces the OSS one through the dynamic import of the server configuration, and only one of the two is active at a time.

Sources: [enterprise/README.md:1-20](repo://enterprise/README.md#L1-L20), [openhands/server/config/server_config.py:52-60](repo://openhands/server/config/server_config.py#L52-L60)

## Rules for a replacement

A replacement must subclass the base class and implement its abstract methods. The base classes say which methods are required: for example, `SecurityAnalyzer` requires `security_risk` and `handle_api_request`, and `Agent` requires `step`. A replacement that leaves those methods out raises `NotImplementedError` when they are first called, as the security analyser base does.

Sources: [openhands/security/analyzer.py:8-29](repo://openhands/security/analyzer.py#L8-L29), [openhands/controller/agent.py:25-108](repo://openhands/controller/agent.py#L25-L108)

The conversation manager and the stores are resolved when the server's shared module is imported, so a broken replacement for them stops the server at start. A runtime class is resolved when a conversation asks for it, so a broken runtime name fails that conversation with the list of known names.

Sources: [openhands/server/shared.py:61-77](repo://openhands/server/shared.py#L61-L77), [openhands/runtime/__init__.py:90-103](repo://openhands/runtime/__init__.py#L90-L103)
