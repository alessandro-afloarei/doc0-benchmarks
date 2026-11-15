---
title: "Usage Analytics"
---
## Overview

The Unity package reports anonymous usage events through Unity's Editor analytics, so the maintainers can see which sensors, actuators, trainers and settings are used. Four events exist: one when a model is used for inference, one when a behavior is first controlled by a trainer, and two describing the Python training session and each trained behavior, which the trainer sends to Unity over a dedicated side channel. Everything is sent from the Editor only, subject to the Editor's analytics setting, and names that could identify a project are hashed before they leave the machine.

Sources: [com.unity.ml-agents/Runtime/Analytics/Events.cs:9-24](repo://com.unity.ml-agents/Runtime/Analytics/Events.cs#L9-L24), [com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs:24-79](repo://com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs#L24-L79)

## When anything is sent

Every send path is compiled only when the `MLA_UNITY_ANALYTICS_MODULE` define is present: the public entry points carry `[Conditional("MLA_UNITY_ANALYTICS_MODULE")]`, and their bodies also require `UNITY_EDITOR` and `ENABLE_CLOUD_SERVICES_ANALYTICS`. At run time each path checks `EditorAnalytics.enabled` first. Player builds never send; outside the Editor `IsAnalyticsEnabled` returns false.

Sources: [com.unity.ml-agents/Runtime/Analytics/InferenceAnalytics.cs:23-106](repo://com.unity.ml-agents/Runtime/Analytics/InferenceAnalytics.cs#L23-L106), [com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs:43-79](repo://com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs#L43-L79)

`AnalyticsUtils.s_SendEditorAnalytics` gates the final `EditorAnalytics.SendAnalytic` call, and `DisableAnalyticsSending` is a disposable that turns it off temporarily; the package's tests use it to build events without sending them.

Sources: [com.unity.ml-agents/Runtime/Analytics/AnalyticsUtils.cs:44-63](repo://com.unity.ml-agents/Runtime/Analytics/AnalyticsUtils.cs#L44-L63)

## Events

| Event name | Sent by | Sent once per | Contents |
| --- | --- | --- | --- |
| `ml_agents_inferencemodelset` | `SentisPolicy` on first decision | model asset | hashed behavior name, model version, producer, memory size, inference device, Sentis package version, observation specs, action spec, actuators, weight size, model hash |
| `ml_agents_remote_policy_initialized` | `RemotePolicy` on first decision | behavior name (without team) | hashed behavior name, session GUID, observation specs, action spec, actuators, trainer package and communication versions |
| `ml_agents_training_environment_initialized` | Python, via side channel | Editor session | Python, ml-agents, ml-agents-envs and PyTorch versions, torch device type, number of environments and environment parameters, sanitized run options |
| `ml_agents_training_behavior_initialized` | Python, via side channel | behavior | hashed behavior name, trainer type, which reward signals, BC, memory, self-play and curriculum are used, visual encoder, layers, hidden units, threading, sanitized trainer settings |

Sources: [com.unity.ml-agents/Runtime/Analytics/Events.cs:25-53](repo://com.unity.ml-agents/Runtime/Analytics/Events.cs#L25-L53), [com.unity.ml-agents/Runtime/Analytics/Events.cs:154-244](repo://com.unity.ml-agents/Runtime/Analytics/Events.cs#L154-L244)

Observation specs record, per sensor, its name, compression type, built-in sensor type (from `IBuiltInSensor`), observation type and each dimension's size and property flags. Actuator infos and action specs are summarized the same way.

Sources: [com.unity.ml-agents/Runtime/Analytics/Events.cs:58-152](repo://com.unity.ml-agents/Runtime/Analytics/Events.cs#L58-L152)

## Inference analytics

`SentisPolicy` calls `InferenceAnalytics.InferenceModelSet` on its first `RequestDecision`. The method returns early if analytics are off or if this model asset was already reported in the session (a `HashSet` of models). `GetEventForModel` loads the model to read its metadata, hashes the behavior name with HMAC-SHA256 keyed by `unity.ml-agents`, adds the Sentis package version, the total size of the model's constants and a hash of the constants. Legacy `.nn` models get placeholder source and producer values.

Sources: [com.unity.ml-agents/Runtime/Policies/SentisPolicy.cs:101-123](repo://com.unity.ml-agents/Runtime/Policies/SentisPolicy.cs#L101-L123), [com.unity.ml-agents/Runtime/Analytics/InferenceAnalytics.cs:72-170](repo://com.unity.ml-agents/Runtime/Analytics/InferenceAnalytics.cs#L72-L170), [com.unity.ml-agents/Runtime/Analytics/InferenceAnalytics.cs:180-246](repo://com.unity.ml-agents/Runtime/Analytics/InferenceAnalytics.cs#L180-L246)

## Training analytics in Unity

When the communicator connects, it stores the Python package and communication versions with `SetTrainerInformation`. `RemotePolicy` then calls `RemotePolicyInitialized` on its first decision; the behavior name is stripped of its `?team=` suffix so each behavior is reported once, hashed, and sent with a per-session GUID that ties it to the other training events.

Sources: [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:156-158](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L156-L158), [com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs:111-158](repo://com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs#L111-L158), [com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs:206-234](repo://com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs#L206-L234)

## The training analytics side channel

### Python side

Python reports its side over a side channel with UUID `b664a4a9-d86f-5a5f-95cb-e8353a7e8356`. Every `UnityEnvironment` registers a `DefaultTrainingAnalyticsSideChannel` unless one with that id is already given; it sends only an environment message with the Python and ml-agents-envs versions and `Custom` as the ml-agents version, so custom Python training loops are counted separately from `mlagents-learn`.

Sources: [ml-agents-envs/mlagents_envs/side_channel/default_training_analytics_side_channel.py:13-49](repo://ml-agents-envs/mlagents_envs/side_channel/default_training_analytics_side_channel.py#L13-L49), [ml-agents-envs/mlagents_envs/environment.py:191-201](repo://ml-agents-envs/mlagents_envs/environment.py#L191-L201)

`mlagents-learn` uses the richer `TrainingAnalyticsSideChannel`, which has the same UUID, in environment worker 0 only, and only if Unity announced the `trainingAnalytics` capability. `environment_initialized(run_options)` sends a `TrainingEnvironmentInitialized` message; `training_started(behavior, settings)` sends a `TrainingBehaviorInitialized` message when the trainer controller creates a trainer. Each message is a protobuf wrapped in `google.protobuf.Any` and sent as raw bytes. Python raises if Unity ever sends on this channel.

Sources: [ml-agents/mlagents/trainers/training_analytics_side_channel.py:26-51](repo://ml-agents/mlagents/trainers/training_analytics_side_channel.py#L26-L51), [ml-agents/mlagents/trainers/training_analytics_side_channel.py:110-188](repo://ml-agents/mlagents/trainers/training_analytics_side_channel.py#L110-L188), [ml-agents/mlagents/trainers/subprocess_env_manager.py:140-172](repo://ml-agents/mlagents/trainers/subprocess_env_manager.py#L140-L172)

### Sanitizing

Before sending, the trainer hashes anything that might identify a project with HMAC-SHA256 keyed by `unity.ml-agents`: behavior names (as keys of `behaviors` and in completion criteria), `init_path` and `demo_path`, environment parameter and lesson names, and `initialize_from`; `results_dir` is replaced by Python's `hash`. Behavior names are hashed in Python with the same key the C# side uses, so both sides report matching identifiers.

Sources: [ml-agents/mlagents/trainers/training_analytics_side_channel.py:40-108](repo://ml-agents/mlagents/trainers/training_analytics_side_channel.py#L40-L108), [ml-agents/mlagents/trainers/training_analytics_side_channel.py:135-144](repo://ml-agents/mlagents/trainers/training_analytics_side_channel.py#L135-L144), [com.unity.ml-agents/Runtime/Analytics/AnalyticsUtils.cs:32-42](repo://com.unity.ml-agents/Runtime/Analytics/AnalyticsUtils.cs#L32-L42)

### Unity side

The C# `TrainingAnalyticsSideChannel`, registered by the Academy at start-up, parses each message as an `Any`, ignores malformed or unknown messages, and forwards the two known types to `TrainingAnalytics`. The environment event is sent once per session. The behavior event is sent once per behavior; if it comes from an older trainer that did not include the config or did not hash the name (the name is not 64 hexadecimal characters), Unity hashes the name itself.

Sources: [com.unity.ml-agents/Runtime/SideChannels/TrainingAnalyticsSideChannel.cs:10-51](repo://com.unity.ml-agents/Runtime/SideChannels/TrainingAnalyticsSideChannel.cs#L10-L51), [com.unity.ml-agents/Runtime/Academy.cs:428-429](repo://com.unity.ml-agents/Runtime/Academy.cs#L428-L429), [com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs:81-109](repo://com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs#L81-L109), [com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs:160-204](repo://com.unity.ml-agents/Runtime/Analytics/TrainingAnalytics.cs#L160-L204)

The side channel mechanism itself is described on [[Side Channels]].

Sources: [com.unity.ml-agents/Runtime/SideChannels/SideChannel.cs:19-67](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannel.cs#L19-L67)
