---
title: "Communication Protocol"
---
## Overview

Unity and Python run as separate processes and exchange protobuf messages over gRPC. The message definitions live once, in `protobuf-definitions/proto/mlagents_envs/communicator_objects`, and are compiled into C# (`com.unity.ml-agents/Runtime/Grpc/CommunicatorObjects`) and Python (`mlagents_envs/communicator_objects`) bindings. The protocol is deliberately small: one RPC, one envelope message, and a strict request-reply rhythm in which Unity asks and Python answers, one environment step per round trip.

Sources: [protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_to_external.proto:1-12](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_to_external.proto#L1-L12), [protobuf-definitions/README.md:41-74](repo://protobuf-definitions/README.md#L41-L74)

The roles are inverted from what one might expect: Python is the gRPC server and Unity the client. Python opens the port first, then launches the executable (or waits for the Editor), and the Academy connects to it. This page covers the messages, the handshake, the per-step exchange and the conversion code on both sides; side channel payloads are on [[Side Channels]] and the Python API built on top on [[Low-Level Python API (UnityEnvironment)]].

Sources: [ml-agents-envs/mlagents_envs/rpc_communicator.py:34-75](repo://ml-agents-envs/mlagents_envs/rpc_communicator.py#L34-L75), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:229-247](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L229-L247)

## Messages

The service has a single method, `Exchange(UnityMessageProto) returns (UnityMessageProto)`. A `UnityMessageProto` holds a `HeaderProto` (an integer `status` and a `message`), a `UnityOutputProto` (what Unity sends) and a `UnityInputProto` (what Python sends). Status 200 means normal; Python sends 400 to shut Unity down.

Sources: [protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_to_external.proto:1-12](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_to_external.proto#L1-L12), [protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_message.proto:1-15](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_message.proto#L1-L15), [protobuf-definitions/proto/mlagents_envs/communicator_objects/header.proto:1-9](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/header.proto#L1-L9)

| Message | Direction | Contents |
| --- | --- | --- |
| `UnityRLInitializationInputProto` | Python to Unity, once | `seed`, `communication_version`, `package_version`, trainer `capabilities`, `num_areas` |
| `UnityRLInitializationOutputProto` | Unity to Python | `name`, `communication_version`, `package_version`, C# `capabilities`, and `brain_parameters` for newly seen behaviors |
| `UnityRLInputProto` | Python to Unity, each step | `agent_actions` (map from behavior name to a list of `AgentActionProto`), `command` (`STEP`, `RESET`, `QUIT`), `side_channel` bytes |
| `UnityRLOutputProto` | Unity to Python, each step | `agentInfos` (map from behavior name to a list of `AgentInfoProto`), `side_channel` bytes |
| `AgentInfoProto` | in output | `reward`, `done`, `max_step_reached`, `id`, `action_mask`, `observations`, `group_id`, `group_reward` |
| `ObservationProto` | in agent info | `shape`, `compression_type`, `compressed_data` or `float_data`, `compressed_channel_mapping`, `dimension_properties`, `observation_type`, `name` |
| `AgentActionProto` | in input | `continuous_actions`, `discrete_actions` (plus the deprecated flat `vector_actions_deprecated`) |
| `BrainParametersProto` | in init output | `brain_name`, `is_training`, `action_spec` (continuous count, discrete branch sizes) |

Sources: [protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_initialization_input.proto:1-22](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_initialization_input.proto#L1-L22), [protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_initialization_output.proto:1-27](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_initialization_output.proto#L1-L27), [protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_input.proto:1-18](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_input.proto#L1-L18), [protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_output.proto:1-16](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_output.proto#L1-L16), [protobuf-definitions/proto/mlagents_envs/communicator_objects/agent_info.proto:8-24](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/agent_info.proto#L8-L24), [protobuf-definitions/proto/mlagents_envs/communicator_objects/observation.proto:6-36](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/observation.proto#L6-L36), [protobuf-definitions/proto/mlagents_envs/communicator_objects/agent_action.proto:6-14](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/agent_action.proto#L6-L14), [protobuf-definitions/proto/mlagents_envs/communicator_objects/brain_parameters.proto:8-25](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/brain_parameters.proto#L8-L25)

Removed fields are kept as `reserved` numbers rather than reused, so an older peer never misreads a new field as an old one.

Sources: [protobuf-definitions/proto/mlagents_envs/communicator_objects/agent_info.proto:8-24](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/agent_info.proto#L8-L24)

## Versions and capabilities

Two mechanisms keep mismatched releases from silently misbehaving. The communication API version (`1.5.0`) is compared on both sides: a different major version (or, for 0.x versions, a different minor) is incompatible. Python raises `UnityEnvironmentException` with both versions; Unity logs a warning naming them.

Sources: [ml-agents-envs/mlagents_envs/environment.py:55-110](repo://ml-agents-envs/mlagents_envs/environment.py#L55-L110), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:73-97](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L73-L97), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:156-190](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L156-L190)

Within a major version, features are announced as capability flags in `UnityRLCapabilitiesProto`, which each side sends to the other. The Python trainer sets them all. Unity checks them where a feature is used and degrades or fails at that point, as listed below.

Sources: [protobuf-definitions/proto/mlagents_envs/communicator_objects/capabilities.proto:6-31](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/capabilities.proto#L6-L31), [ml-agents-envs/mlagents_envs/environment.py:119-129](repo://ml-agents-envs/mlagents_envs/environment.py#L119-L129)

| Capability | Unity behavior when the trainer lacks it |
| --- | --- |
| `concatenatedPngObservations` | Sends observations with more than 3 channels as floats instead of PNGs |
| `compressedChannelMapping` | Sends observations with a non-trivial mapping as floats |
| `variableLengthObservation` | Throws `UnityAgentsException` for a variable-length observation |
| `multiAgentGroups` | Warns once that group rewards will be ignored |
| `trainingAnalytics` | Python does not send training analytics |

Sources: [com.unity.ml-agents/Runtime/Communicator/GrpcExtensions.cs:62-80](repo://com.unity.ml-agents/Runtime/Communicator/GrpcExtensions.cs#L62-L80), [com.unity.ml-agents/Runtime/Communicator/GrpcExtensions.cs:341-445](repo://com.unity.ml-agents/Runtime/Communicator/GrpcExtensions.cs#L341-L445)

## The handshake

```mermaid
sequenceDiagram
    participant PY as "Python RpcCommunicator (server)"
    participant UN as "Unity RpcCommunicator (client)"
    PY->>PY: check_port, start gRPC server on base_port + worker_id
    UN->>PY: Exchange(status 200, RlInitializationOutput: versions, capabilities)
    PY-->>UN: reply: RlInitializationInput (seed, versions, capabilities, num_areas)
    UN->>PY: Exchange(empty output)
    Note over PY: initialize() returns; UnityEnvironment checks versions
    PY-->>UN: reply: RlInput with RESET and side channel data
    UN->>UN: process side channels, raise reset, start stepping
    UN->>PY: Exchange(RlOutput: agent infos, new brain parameters)
```

Sources: [ml-agents-envs/mlagents_envs/rpc_communicator.py:123-146](repo://ml-agents-envs/mlagents_envs/rpc_communicator.py#L123-L146), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:106-200](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L106-L200), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:229-247](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L229-L247), [ml-agents-envs/mlagents_envs/environment.py:228-263](repo://ml-agents-envs/mlagents_envs/environment.py#L228-L263)

On the Python side, `create_server` first checks that the port is free by binding a socket to it (with `SO_REUSEADDR` on Linux, so a port held in `TIME_WAIT` by a previous run counts as free), then starts a gRPC server listening on all addresses so that a Unity process in a Docker container can connect. A failure in either step raises `UnityWorkerInUseException`. The servicer does not handle requests itself: each incoming `Exchange` is pushed through a multiprocessing `Pipe` and the reply is whatever the main thread sends back.

Sources: [ml-agents-envs/mlagents_envs/rpc_communicator.py:21-91](repo://ml-agents-envs/mlagents_envs/rpc_communicator.py#L21-L91)

On the Unity side, `Initialize` opens an insecure channel to `localhost:<port>` and makes two exchanges: the first sends the Academy's parameters and receives Python's initialization input, the second sends nothing and receives the first RL input. A non-200 status on either shuts the channel down. An `RpcException` with status `Unavailable` (no trainer listening) is the normal outcome when nobody is training, and makes the Academy fall back to inference. On success the Unity side applies the first input and registers a shutdown on `Application.quitting`.

Sources: [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:106-200](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L106-L200), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:229-247](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L229-L247), [com.unity.ml-agents/Runtime/Academy.cs:445-486](repo://com.unity.ml-agents/Runtime/Academy.cs#L445-L486)

## The step exchange

### Round trip

From then on each round trip is one environment step. Python's `exchange` sends its input as the reply to Unity's pending request, then waits for Unity's next request, which carries the observations produced by acting on that input.

Sources: [ml-agents-envs/mlagents_envs/rpc_communicator.py:135-146](repo://ml-agents-envs/mlagents_envs/rpc_communicator.py#L135-L146)

### Unity side

`RemotePolicy.RequestDecision` calls `PutObservations(behaviorName, info, sensors)`, which converts the `AgentInfo` with `ToAgentInfoProto`, converts each sensor with `GetObservationProto` and appends the result to the behavior's list in the pending `UnityRLOutputProto`. It records the agent id in the order agents requested decisions (done agents excluded, since they get no action) and marks that this step needs communication.

Sources: [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:337-380](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L337-L380)

`DecideBatch`, called from the first `RemotePolicy.DecideAction` of the step, sends at most one message. `SendBatchedMessageHelper` attaches the brain parameters of any behavior not yet announced (only once it has agent infos, so Python always gets a first observation with a new spec), attaches the queued side channel bytes and calls `Exchange`. From the reply it processes side channel data and the command, then assigns the i-th action in each behavior's list to the i-th agent that requested a decision. `GetActions` returns those actions, or empty buffers for agents with none.

Sources: [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:320-329](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L320-L329), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:386-458](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L386-L458), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:536-586](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L536-L586)

### Python side

`UnityEnvironment.step` fills in empty actions for behaviors whose actions were not set, builds a `UnityRLInputProto` with one `AgentActionProto` per agent (in the order of the last `DecisionSteps`), the `STEP` command and outgoing side channel bytes, and calls `exchange`. It then registers any new behavior specs from the reply, converts each behavior's agent infos into `DecisionSteps` and `TerminalSteps`, and hands incoming side channel bytes to the side channel manager. `reset` sends `RESET` instead of actions.

Sources: [ml-agents-envs/mlagents_envs/environment.py:287-354](repo://ml-agents-envs/mlagents_envs/environment.py#L287-L354), [ml-agents-envs/mlagents_envs/environment.py:451-485](repo://ml-agents-envs/mlagents_envs/environment.py#L451-L485)

## Converting observations and steps

### Specs and steps

`behavior_spec_from_proto` builds a `BehaviorSpec` from a `BrainParametersProto` and the first agent's observations, taking each observation's shape, type, name and dimension properties. Older peers that do not fill `action_spec` fall back to the deprecated action fields.

Sources: [ml-agents-envs/mlagents_envs/rpc_utils.py:27-70](repo://ml-agents-envs/mlagents_envs/rpc_utils.py#L27-L70)

`steps_from_proto` splits agent infos into decision steps (not done) and terminal steps (done). For each observation index it stacks all agents' observations into one array: rank-3 observations may be compressed and are decoded, other ranks are reshaped from float data. Rewards, agent ids, `max_step_reached` (as the terminal `interrupted` flag), group ids and group rewards become arrays, and NaN or infinite rewards raise an error. Action masks are converted from Unity's "true means masked" to per-branch arrays.

Sources: [ml-agents-envs/mlagents_envs/rpc_utils.py:317-424](repo://ml-agents-envs/mlagents_envs/rpc_utils.py#L317-L424)

### PNG decoding

`process_pixels` reads one PNG after another from the compressed bytes, finding each next image by searching for the PNG header, and scales pixels to `[0, 1]` in channel-first order. With a channel mapping it concatenates all decoded channels, validates the mapping, averages channels mapped to the same index and drops channels mapped to -1. Without one it averages to grayscale for one expected channel, or concatenates and truncates to the expected count. The decoded shape must equal the declared shape or `UnityObservationException` is raised.

Sources: [ml-agents-envs/mlagents_envs/rpc_utils.py:106-192](repo://ml-agents-envs/mlagents_envs/rpc_utils.py#L106-L192), [ml-agents-envs/mlagents_envs/rpc_utils.py:216-246](repo://ml-agents-envs/mlagents_envs/rpc_utils.py#L216-L246)

## Timeouts and shutdown

Python never blocks forever on Unity. `poll_for_timeout` polls the pipe in slices of a tenth of `timeout_wait`, calling a callback between slices that raises if the Unity process has exited; when the deadline passes it raises `UnityTimeOutException` with a checklist of common causes. `close` sends a status 400 message and stops the server.

Sources: [ml-agents-envs/mlagents_envs/rpc_communicator.py:93-158](repo://ml-agents-envs/mlagents_envs/rpc_communicator.py#L93-L158), [ml-agents-envs/mlagents_envs/environment.py:408-418](repo://ml-agents-envs/mlagents_envs/environment.py#L408-L418)

In Unity, any non-200 reply, a `QUIT` command or a gRPC failure triggers `NotifyQuitAndShutDownChannel`, which raises `QuitCommandReceived` (the Academy then quits the application) and shuts the channel down. `ResourceExhausted`, meaning a message too large for gRPC, is logged as an error that suggests fewer agents or smaller observations. Leaving play mode or disposing the communicator sends a status 400 message to Python.

Sources: [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:249-286](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L249-L286), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:465-518](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L465-L518)

## Regenerating the bindings

After changing a `.proto` file, the generated C# and Python code must be rebuilt. The README pins protobuf 3.19.6, grpcio-tools and Grpc.Tools 1.14.1 and describes running `make.sh` (or `make_for_win.bat`) from `protobuf-definitions`, checking that the generated `UnityToExternalGrpc.cs` is wrapped in `#if UNITY_EDITOR || UNITY_STANDALONE` so non-desktop platforms never reference gRPC, and reinstalling both Python packages. The Unity side applies the same guard to its own communicator, which compiles to a stub returning null on other platforms.

Sources: [protobuf-definitions/README.md:5-74](repo://protobuf-definitions/README.md#L5-L74), [protobuf-definitions/make.sh:1-53](repo://protobuf-definitions/make.sh#L1-L53), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:1-69](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L1-L69)
