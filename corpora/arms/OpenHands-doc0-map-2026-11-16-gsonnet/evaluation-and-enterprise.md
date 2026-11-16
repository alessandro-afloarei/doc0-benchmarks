---
title: "Evaluation Harness and Enterprise Edition"
---
## Overview

Two directories reuse the platform instead of extending the open-source server. `evaluation/` drives the same `run_controller` that headless mode uses, once per benchmark instance, and records the agent's history and result as JSON lines. `enterprise/` is the multi-tenant server behind OpenHands Cloud: it imports the open-source app, adds routes, middleware and integrations, and replaces the classes that `shared.py` resolves by name (settings store, conversation manager, user auth) with database- and Redis-backed ones. Its README warns that it is licensed under the Polyform Free Trial License, which is not an open-source license.

Sources: [evaluation/README.md:1-12](repo://evaluation/README.md#L1-L12), [enterprise/README.md:1-20](repo://enterprise/README.md#L1-L20), [enterprise/saas_server.py:40-58](repo://enterprise/saas_server.py#L40-L58)

## Evaluation harness

### Instances, metadata and outputs

Each benchmark is a directory under `evaluation/benchmarks/` (SWE-bench, GAIA, WebArena, BioCoder, ToolQA and many more) with a `run_infer.py` that supplies a `process_instance` function. The shared machinery is `evaluation/utils/shared.py`, so a benchmark script reduces to: build a config, build a runtime, run the controller, collect the result.

Sources: [evaluation/README.md:3-14](repo://evaluation/README.md#L3-L14), [evaluation/utils/shared.py:44-80](repo://evaluation/utils/shared.py#L44-L80)

`EvalMetadata` describes a run (agent class, LLM config, agent config, iteration limit, output directory, start time, git commit, dataset and split, condenser config) and `EvalOutput` one instance's result: its `instance_id`, a free-form `test_result`, the instruction, the history, metrics and an error. `make_metadata` builds the metadata and the output directory `<dir>/<dataset>/<agent>/<model>_maxiter_<n>[_N_<note>]`, with a `logs` folder inside, and records the current git commit.

Sources: [evaluation/utils/shared.py:44-80](repo://evaluation/utils/shared.py#L44-L80), [evaluation/utils/shared.py:164-217](repo://evaluation/utils/shared.py#L164-L217)

The README adds that only the `[llm]` section of `config.toml` is used for evaluation, so other settings such as `save_trajectory_path` are not applied; named sections such as `[llm.eval_...]` select the model under test, and a `[condenser.X]` section can configure condensation ([[Configuration]], [[Condensers]]).

Sources: [evaluation/README.md:20-70](repo://evaluation/README.md#L20-L70)

### Running a benchmark

`prepare_dataset` requires an `instance_id` column, reads any existing output file and treats its ids as already finished, restricts to `eval_ids` if given or skips the first `skip_num` rows, and samples `eval_n_limit` instances with a fixed random seed 42. Finished instances are removed from the work list, so a rerun resumes.

Sources: [evaluation/utils/shared.py:219-290](repo://evaluation/utils/shared.py#L219-L290)

`run_evaluation` then runs `process_instance_func` over the dataset. With more than one worker it uses a multiprocessing pool and `imap_unordered`; with one it loops. Each result is appended to the output file and the progress bar updates. A `KeyboardInterrupt` triggers cleanup.

Sources: [evaluation/utils/shared.py:486-550](repo://evaluation/utils/shared.py#L486-L550)

Every instance goes through `_process_instance_wrapper`, which retries up to `max_retries` (default 5) times with a 5-second pause. A timeout (when `timeout_seconds` is set) returns an `EvalOutput` with an error and no retry. After the last failed attempt it either raises `RuntimeError`, or, if `EVAL_SKIP_MAXIMUM_RETRIES_EXCEEDED` is `true`, logs the instance as skipped and goes on. When an error looks like a fatal runtime disconnect, `runtime_failure_count` is incremented and passed to the next attempt if `process_instance_func` accepts it.

Sources: [evaluation/utils/shared.py:387-479](repo://evaluation/utils/shared.py#L387-L479)

### What a benchmark supplies

The SWE-bench `process_instance` shows the pattern. It builds a config, resets the logger per instance for multiprocessing, and raises the sandbox `remote_runtime_resource_factor` (doubling each time, up to 8) after runtime failures. It creates and connects a runtime, runs `initialize_runtime`, builds the instruction as a `MessageAction`, and calls `run_controller` with `fake_user_response_fn` chosen by agent class. A fatal `state.last_error` raises `EvalException` so the wrapper retries. Finally it extracts the git patch from the sandbox, closes the runtime, serializes `state.history` with `event_to_dict`, and returns an `EvalOutput`.

Sources: [evaluation/benchmarks/swe_bench/run_infer.py:606-711](repo://evaluation/benchmarks/swe_bench/run_infer.py#L606-L711)

`run_controller` is described in [[OpenHands Overview]]. The fake user response is what keeps the run autonomous: `codeact_user_response` tells the agent to continue, to finish with the finish tool, and never to ask for help. It returns `/exit` when an optional `try_parse` finds an answer in the agent's last action, and after two user messages it reminds the agent that it may give up with the finish tool.

Sources: [evaluation/utils/shared.py:106-154](repo://evaluation/utils/shared.py#L106-L154), [openhands/core/main.py:247-260](repo://openhands/core/main.py#L247-L260)

`get_default_sandbox_config_for_eval` and `get_openhands_config_for_eval` give benchmarks a common base: a 300-second command timeout, host networking off, remote-runtime timeouts and retries, and the runtime from the `RUNTIME` environment variable (default `docker`), defaulting the agent to `CodeActAgent` ([[Runtime and Action Execution Server]]).

Sources: [evaluation/utils/shared.py:692-760](repo://evaluation/utils/shared.py#L692-L760)

## Enterprise server

`saas_server.py` imports the open-source `base_app` and the Socket.IO `sio` and mutates them: it patches the MCP server, adds `/saas` (returning `{"saas": true}`), mounts a metrics app, and includes SaaS routers for readiness, authentication and OAuth, user calls, billing, API keys, Slack, email, feedback, event webhooks from nested runtimes and diagnostic routes. GitHub and GitLab integration routers are included only when the corresponding app client id is set, and Jira, Jira DC and Linear only when their flags are on. It adds CORS for the permitted origins, an auth-cookie middleware and a rate-limit handler, maps `NoCredentialsError` and `ExpiredError` to HTTP 401, serves the frontend build, and wraps it all in `socketio.ASGIApp`.

Sources: [enterprise/saas_server.py:40-130](repo://enterprise/saas_server.py#L40-L130)

The README describes two relations to the open-source code: enterprise stacks on top of it (middleware from both is active) and it overrides it, where only one implementation is present. The override mechanism is the class-name configuration of [[Storage, Settings and Secrets]] and [[Server, Conversations and Sessions]]: `SaaSServerConfig` sets `app_mode` to `SAAS` and names `SaasSettingsStore`, `SaasSecretsStore`, `SaasConversationStore`, `ClusteredConversationManager`, `SaaSMonitoringListener` and `SaasUserAuth` as the implementations.

Sources: [enterprise/README.md:15-28](repo://enterprise/README.md#L15-L28), [enterprise/server/config.py:51-80](repo://enterprise/server/config.py#L51-L80)

The README's table sets out the authentication difference. In the open-source app the user pastes a personal access token and it is stored in settings; in enterprise the user goes through OAuth, tokens are held by a token manager, and a signed cookie carries the user id.

Sources: [enterprise/README.md:30-44](repo://enterprise/README.md#L30-L44)

## Clustered conversation manager

`ClusteredConversationManager` extends `StandaloneConversationManager` so several server processes can share one pool of conversations through Redis. Its docstring lists the job: cross-server message passing over pub/sub, tracking conversations and connections across the cluster, recovery from server failure, limits enforced cluster-wide and cleanup of stale entries. Keys follow `ohcnv:{user_id}:{conversation_id}` (an active conversation) and `ohcnct:{user_id}:{conversation_id}:{connection_id}` (a connection).

Sources: [enterprise/server/clustered_conversation_manager.py:60-82](repo://enterprise/server/clustered_conversation_manager.py#L60-L82)

Starting a loop is made safe by `SET key NX EX 15`: `maybe_start_agent_loop` sets the conversation key in Redis and starts the loop only if the key was newly created, meaning no other worker runs that conversation. Because the key is set before the running count is checked, `__post_init__` raises `max_concurrent_conversations` by one. A background task refreshes the Redis entries every 5 seconds, and entries expire after 15 seconds, so a crashed server's conversations vanish from the registry by themselves.

Sources: [enterprise/server/clustered_conversation_manager.py:36-50](repo://enterprise/server/clustered_conversation_manager.py#L36-L50), [enterprise/server/clustered_conversation_manager.py:83-105](repo://enterprise/server/clustered_conversation_manager.py#L83-L105), [enterprise/server/clustered_conversation_manager.py:389-433](repo://enterprise/server/clustered_conversation_manager.py#L389-L433)

Every manager subscribes to a `session_msg` channel. `_process_message` handles `event` (dispatch the event to the local session if the conversation runs here), `close_session`, `session_closing` (a remote node is shutting down, so local connections to it are handled as a stopped remote conversation) and `llm_completion` (run an extraneous completion on the local session's LLM registry and publish the answer). `_start_agent_loop` calls the parent and additionally subscribes a handler that invokes the registered conversation callbacks whenever an `AgentStateChangedObservation` occurs, so that registered conversation callbacks run.

Sources: [enterprise/server/clustered_conversation_manager.py:107-211](repo://enterprise/server/clustered_conversation_manager.py#L107-L211), [enterprise/server/clustered_conversation_manager.py:749-797](repo://enterprise/server/clustered_conversation_manager.py#L749-L797)
