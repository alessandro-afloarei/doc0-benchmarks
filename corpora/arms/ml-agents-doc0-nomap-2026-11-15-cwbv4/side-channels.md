---
title: "Side Channels"
---
## Overview

Side channels carry data that is not part of the reinforcement-learning loop: engine settings such as time scale, environment parameters for curricula, custom statistics, analytics, or anything a user wants to pass between a Python script and a scene. Rather than adding protobuf fields for each, every RL message has one opaque `side_channel` byte field in each direction, and the side channel managers on both sides pack and unpack many small messages into it, each addressed to a channel by UUID.

Sources: [protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_input.proto:1-18](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_input.proto#L1-L18), [protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_output.proto:1-16](repo://protobuf-definitions/proto/mlagents_envs/communicator_objects/unity_rl_output.proto#L1-L16)

A channel is a pair of classes with the same UUID: a Python `SideChannel` passed to `UnityEnvironment`, and a C# `SideChannel` registered with `SideChannelManager`. Messages queued on one side are delivered on the other at the next exchange, so they travel at the rhythm of environment steps described in [[Communication Protocol]].

Sources: [ml-agents-envs/mlagents_envs/side_channel/side_channel.py:11-46](repo://ml-agents-envs/mlagents_envs/side_channel/side_channel.py#L11-L46), [com.unity.ml-agents/Runtime/SideChannels/SideChannel.cs:19-67](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannel.cs#L19-L67)

## Wire format

The side channel field is a concatenation of frames. Each frame is the channel's 16-byte UUID, a 4-byte little-endian message length, then the message bytes. Python writes the UUID with `bytes_le` and C# with `Guid.ToByteArray()`, which use the same mixed-endian layout, so the same UUID string identifies the same channel on both sides.

Sources: [ml-agents-envs/mlagents_envs/side_channel/side_channel_manager.py:13-62](repo://ml-agents-envs/mlagents_envs/side_channel/side_channel_manager.py#L13-L62), [com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs:121-148](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs#L121-L148)

Inside a message, `OutgoingMessage` and `IncomingMessage` write and read typed values in little-endian order: booleans, 32-bit ints, 32-bit floats, float lists (length then values) and ASCII strings (byte length then bytes). Values must be read in the order they were written. Every read takes a default returned when the message is exhausted, which lets a newer sender append fields that an older reader simply ignores.

Sources: [ml-agents-envs/mlagents_envs/side_channel/outgoing_message.py:9-66](repo://ml-agents-envs/mlagents_envs/side_channel/outgoing_message.py#L9-L66), [ml-agents-envs/mlagents_envs/side_channel/incoming_message.py:5-93](repo://ml-agents-envs/mlagents_envs/side_channel/incoming_message.py#L5-L93), [com.unity.ml-agents/Runtime/SideChannels/IncomingMessage.cs:22-111](repo://com.unity.ml-agents/Runtime/SideChannels/IncomingMessage.cs#L22-L111), [com.unity.ml-agents/Runtime/SideChannels/OutgoingMessage.cs:19-95](repo://com.unity.ml-agents/Runtime/SideChannels/OutgoingMessage.cs#L19-L95)

## Python side

`SideChannel` holds a `channel_id` and a `message_queue`. `queue_message_to_send(msg)` appends a message's buffer to the queue, and subclasses implement `on_message_received(msg)`, which may run several times per step.

Sources: [ml-agents-envs/mlagents_envs/side_channel/side_channel.py:11-46](repo://ml-agents-envs/mlagents_envs/side_channel/side_channel.py#L11-L46)

`SideChannelManager` is built from the list given to `UnityEnvironment` and raises `UnityEnvironmentException` when two channels share a UUID. `generate_side_channel_messages` frames and drains every channel's queue; `UnityEnvironment` calls it for every step and reset message. `process_side_channel_message` parses incoming frames and calls the matching channel. A truncated frame raises an exception suggesting a version mismatch, and a frame for an unknown UUID is logged as a warning and skipped. `UnityEnvironment` always adds a `DefaultTrainingAnalyticsSideChannel` unless one with that id was given.

Sources: [ml-agents-envs/mlagents_envs/side_channel/side_channel_manager.py:9-81](repo://ml-agents-envs/mlagents_envs/side_channel/side_channel_manager.py#L9-L81), [ml-agents-envs/mlagents_envs/environment.py:191-201](repo://ml-agents-envs/mlagents_envs/environment.py#L191-L201), [ml-agents-envs/mlagents_envs/environment.py:299-314](repo://ml-agents-envs/mlagents_envs/environment.py#L299-L314)

## Unity side

The C# `SideChannel` sets its `ChannelId` in the constructor, overrides `OnMessageReceived(IncomingMessage)` and calls `QueueMessageToSend(OutgoingMessage)`. `ProcessMessage` wraps the handler in a try/catch that logs the error and skips the message, so one faulty channel cannot break communication.

Sources: [com.unity.ml-agents/Runtime/SideChannels/SideChannel.cs:19-67](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannel.cs#L19-L67)

`SideChannelManager` is a static registry. `RegisterSideChannel` throws for a duplicate UUID; `UnregisterSideChannel` removes one. `GetSideChannelMessage` returns an empty array without allocating when no channel has queued messages, which is the common case. The communicator attaches its result to every outgoing message and passes incoming bytes to `ProcessSideChannelData`; when no trainer is connected the Academy still drains the queues each step and discards them.

Sources: [com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs:12-86](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs#L12-L86), [com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs:110-167](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs#L110-L167), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:223-227](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L223-L227), [com.unity.ml-agents/Runtime/Academy.cs:593-597](repo://com.unity.ml-agents/Runtime/Academy.cs#L593-L597)

Unity handles unknown UUIDs differently from Python: instead of dropping the message, `ProcessSideChannelData` caches it. Cached messages are delivered when a channel with that UUID registers, or retried on the next incoming data. This matters because Python sends its first messages (engine settings, environment parameters) with the reset that starts the run, possibly before game code has registered its own channels.

Sources: [com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs:32-57](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs#L32-L57), [com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs:173-240](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs#L173-L240)

## Built-in channels

### Channel list

| Channel | UUID | Direction | Purpose |
| --- | --- | --- | --- |
| `EngineConfigurationChannel` | `e951342c-4f7e-11ea-b238-784f4387d1f7` | Python to Unity | Screen resolution, quality level, time scale, target and capture frame rate |
| `EnvironmentParametersChannel` | `534c891e-810f-11ea-a9d0-822485860400` | Python to Unity | Float parameters and samplers read through `Academy.EnvironmentParameters` |
| `StatsSideChannel` | `a1d8f7b7-cec8-50f9-b78b-d3e165a78520` | Unity to Python | Custom metrics from `StatsRecorder` |
| `FloatPropertiesChannel` | `60ccf7d0-4f7e-11ea-b238-784f4387d1f7` by default | both | A shared string-to-float dictionary |
| `RawBytesChannel` | chosen by the user | both | Arbitrary byte messages |
| Training analytics | see [[Usage Analytics]] | Python to Unity | Trainer and environment settings for analytics |

Sources: [ml-agents-envs/mlagents_envs/side_channel/engine_configuration_channel.py:24-44](repo://ml-agents-envs/mlagents_envs/side_channel/engine_configuration_channel.py#L24-L44), [ml-agents-envs/mlagents_envs/side_channel/environment_parameters_channel.py:8-26](repo://ml-agents-envs/mlagents_envs/side_channel/environment_parameters_channel.py#L8-L26), [ml-agents-envs/mlagents_envs/side_channel/stats_side_channel.py:28-39](repo://ml-agents-envs/mlagents_envs/side_channel/stats_side_channel.py#L28-L39), [ml-agents-envs/mlagents_envs/side_channel/float_properties_channel.py:6-17](repo://ml-agents-envs/mlagents_envs/side_channel/float_properties_channel.py#L6-L17), [ml-agents-envs/mlagents_envs/side_channel/raw_bytes_channel.py:6-39](repo://ml-agents-envs/mlagents_envs/side_channel/raw_bytes_channel.py#L6-L39)

### Engine configuration

`set_configuration_parameters` queues one message per setting given, each starting with a `ConfigurationType` int; width and height must be set together or it raises `UnitySideChannelException`. `set_configuration(EngineConfig)` sets them all; `EngineConfig.default_config()` is 80 by 80, quality 1, time scale 20, target frame rate -1, capture frame rate 60. In Unity the handler applies `Screen.SetResolution`, `QualitySettings.SetQualityLevel`, `Time.timeScale`, `Application.targetFrameRate` and `Time.captureFramerate`; time scale is clamped to at least 1, and to at most 100 in the Editor. Python raises if Unity ever sends on this channel.

Sources: [ml-agents-envs/mlagents_envs/side_channel/engine_configuration_channel.py:11-127](repo://ml-agents-envs/mlagents_envs/side_channel/engine_configuration_channel.py#L11-L127), [com.unity.ml-agents/Runtime/SideChannels/EngineConfigurationChannel.cs:9-72](repo://com.unity.ml-agents/Runtime/SideChannels/EngineConfigurationChannel.cs#L9-L72)

`mlagents-learn` builds an `EngineConfig` from its engine flags (`--width`, `--height`, `--quality-level`, `--time-scale`, `--target-frame-rate`, `--capture-frame-rate`) and queues it in every environment worker before the first reset.

Sources: [ml-agents/mlagents/trainers/subprocess_env_manager.py:127-163](repo://ml-agents/mlagents/trainers/subprocess_env_manager.py#L127-L163)

### Environment parameters

Each message carries a key, a data type and a payload. `set_float_parameter` sends a fixed value. The sampler setters send a seed, a sampler type and its arguments: `UNIFORM` (min, max), `GAUSSIAN` (mean, standard deviation) or `MULTIRANGEUNIFORM` (a flattened list of intervals).

Sources: [ml-agents-envs/mlagents_envs/side_channel/environment_parameters_channel.py:15-100](repo://ml-agents-envs/mlagents_envs/side_channel/environment_parameters_channel.py#L15-L100)

The Unity channel stores a function per key: a constant for floats, a seeded sampler from `SamplerFactory` for samplers. `GetWithDefault` calls that function, so for a sampler each read draws a new value. Float messages also invoke the callback registered for the key with `RegisterCallback`. How the trainer decides what to send is on [[Curriculum and Environment Parameters]].

Sources: [com.unity.ml-agents/Runtime/SideChannels/EnvironmentParametersChannel.cs:41-140](repo://com.unity.ml-agents/Runtime/SideChannels/EnvironmentParametersChannel.cs#L41-L140), [com.unity.ml-agents/Runtime/EnvironmentParameters.cs:15-69](repo://com.unity.ml-agents/Runtime/EnvironmentParameters.cs#L15-L69)

### Stats

The Unity `StatsSideChannel.AddStat(key, value, aggregationMethod)` sends a string, a float and an int; it throws if it ever receives a message. The Python channel appends `(value, StatsAggregationMethod)` to a list per key, and `get_and_reset_stats` hands the lists over and starts new ones. The aggregation methods are `AVERAGE`, `MOST_RECENT`, `SUM` and `HISTOGRAM`. See [[Stats and TensorBoard]].

Sources: [com.unity.ml-agents/Runtime/SideChannels/StatsSideChannel.cs:7-41](repo://com.unity.ml-agents/Runtime/SideChannels/StatsSideChannel.cs#L7-L41), [ml-agents-envs/mlagents_envs/side_channel/stats_side_channel.py:9-62](repo://ml-agents-envs/mlagents_envs/side_channel/stats_side_channel.py#L9-L62)

### Float properties and raw bytes

`FloatPropertiesChannel` keeps a local dictionary on each side: `set_property` updates it and sends the key and value, and incoming messages update it, so both sides converge on the same values. `RawBytesChannel` sends a byte array as the whole message and collects received messages for `get_and_clear_received_messages`; the Python class describes itself as an example for research use.

Sources: [ml-agents-envs/mlagents_envs/side_channel/float_properties_channel.py:6-62](repo://ml-agents-envs/mlagents_envs/side_channel/float_properties_channel.py#L6-L62), [ml-agents-envs/mlagents_envs/side_channel/raw_bytes_channel.py:6-39](repo://ml-agents-envs/mlagents_envs/side_channel/raw_bytes_channel.py#L6-L39), [com.unity.ml-agents/Runtime/SideChannels/FloatPropertiesChannel.cs:19-95](repo://com.unity.ml-agents/Runtime/SideChannels/FloatPropertiesChannel.cs#L19-L95)

## Writing a custom channel

1. Pick a new UUID and use it on both sides.
2. In Python, subclass `SideChannel`, call `super().__init__(uuid.UUID(...))`, implement `on_message_received` by reading fields in order from the `IncomingMessage`, and send by filling an `OutgoingMessage` and calling `queue_message_to_send`.
3. Pass an instance in `side_channels=[...]` when constructing `UnityEnvironment`.
4. In C#, subclass `SideChannel`, set `ChannelId` in the constructor, override `OnMessageReceived`, and send with `QueueMessageToSend`.
5. Call `SideChannelManager.RegisterSideChannel` before use (for example in `Awake`) and `UnregisterSideChannel` when the owning object is destroyed. The Academy unregisters all channels when it shuts down.

Sources: [ml-agents-envs/mlagents_envs/side_channel/side_channel.py:11-46](repo://ml-agents-envs/mlagents_envs/side_channel/side_channel.py#L11-L46), [com.unity.ml-agents/Runtime/SideChannels/SideChannel.cs:19-67](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannel.cs#L19-L67), [com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs:32-85](repo://com.unity.ml-agents/Runtime/SideChannels/SideChannelManager.cs#L32-L85), [ml-agents-envs/mlagents_envs/environment.py:145-158](repo://ml-agents-envs/mlagents_envs/environment.py#L145-L158)

> [!NOTE]
> Strings are encoded as ASCII on both sides. Non-ASCII characters will not survive the trip; send them as raw bytes instead.

Sources: [ml-agents-envs/mlagents_envs/side_channel/outgoing_message.py:47-54](repo://ml-agents-envs/mlagents_envs/side_channel/outgoing_message.py#L47-L54), [com.unity.ml-agents/Runtime/SideChannels/OutgoingMessage.cs:65-70](repo://com.unity.ml-agents/Runtime/SideChannels/OutgoingMessage.cs#L65-L70)
