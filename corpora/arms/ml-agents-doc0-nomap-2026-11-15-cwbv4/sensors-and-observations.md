---
title: "Sensors and Observations"
---
## Overview

Everything an agent observes comes from an `ISensor`. A sensor declares the shape of its observation once, then writes the current values each time the agent sends state, either as floats through an `ObservationWriter` or as compressed bytes. The same sensor code serves training (observations go into protobuf messages), inference (observations go straight into input tensors) and demonstration recording, because the writer, not the sensor, knows where the data ends up.

Sources: [com.unity.ml-agents/Runtime/Sensors/ISensor.cs:51-104](repo://com.unity.ml-agents/Runtime/Sensors/ISensor.cs#L51-L104), [com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs:34-79](repo://com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs#L34-L79)

This page covers the contract and the general-purpose sensors. The ready-made sensors (cameras, rays, buffers, physics) are on [[Built-in Sensors]] and grid sensors on [[Grid Sensors]]. How the agent collects its sensors at start-up is on [[Agents and Episodes]].

Sources: [com.unity.ml-agents/Runtime/Agent.cs:984-1048](repo://com.unity.ml-agents/Runtime/Agent.cs#L984-L1048)

## The ISensor contract

| Member | Called | Contract |
| --- | --- | --- |
| `GetObservationSpec()` | at set-up and validation | Shape, per-dimension properties and observation type; must not change |
| `Write(ObservationWriter writer)` | when sending state, possibly several times a step | Write the observation and return the number of floats written; must not mutate state |
| `GetCompressedObservation()` | instead of `Write` when compression is on | Return the compressed bytes; must not mutate state |
| `Update()` | once per agent step, before observations are read | Advance internal state |
| `Reset()` | at the end of each episode | Clear internal state; most sensors leave it empty |
| `GetCompressionSpec()` | when encoding | `CompressionSpec.Default()` for no compression |
| `GetName()` | at set-up | A name that is stable across agents, used for sorting |

Sources: [com.unity.ml-agents/Runtime/Sensors/ISensor.cs:54-104](repo://com.unity.ml-agents/Runtime/Sensors/ISensor.cs#L54-L104)

Because `Write` may run more than once per step (for the trainer and a demonstration recorder, for example), any state change belongs in `Update`. The agent calls `Update` on every sensor before `CollectObservations`, and `Reset` after its final observation of an episode.

Sources: [com.unity.ml-agents/Runtime/Agent.cs:1150-1164](repo://com.unity.ml-agents/Runtime/Agent.cs#L1150-L1164), [com.unity.ml-agents/Runtime/Sensors/ISensor.cs:63-89](repo://com.unity.ml-agents/Runtime/Sensors/ISensor.cs#L63-L89)

The agent sorts its sensors with `SensorUtils.SortSensors`, an invariant-culture string comparison on `GetName()`, so observation order is the same on every machine and every agent of a behavior. `SensorExtensions.ObservationSize()` returns the product of a sensor's shape.

Sources: [com.unity.ml-agents/Runtime/Sensors/ISensor.cs:107-138](repo://com.unity.ml-agents/Runtime/Sensors/ISensor.cs#L107-L138)

## Observation specs

`ObservationSpec` holds three things: a `Shape`, one `DimensionProperty` per dimension, and an `ObservationType`. The constructor throws `UnityAgentsException` when the shape and the dimension properties differ in length. Use the factory methods rather than building specs by hand, since not every combination of properties is supported by the trainer.

Sources: [com.unity.ml-agents/Runtime/Sensors/ObservationSpec.cs:8-54](repo://com.unity.ml-agents/Runtime/Sensors/ObservationSpec.cs#L8-L54), [com.unity.ml-agents/Runtime/Sensors/ObservationSpec.cs:123-136](repo://com.unity.ml-agents/Runtime/Sensors/ObservationSpec.cs#L123-L136)

| Factory | Shape | Dimension properties | Used for |
| --- | --- | --- | --- |
| `Vector(length, obsType)` | `(length)` | `None` | flat feature vectors |
| `Visual(channels, height, width, obsType)` | `(channels, height, width)` | `None, TranslationalEquivariance, TranslationalEquivariance` | images, grids |
| `VariableLength(obsSize, maxNumObs)` | `(obsSize, maxNumObs)` as passed | `VariableSize, None` | an unordered set of entities |

Sources: [com.unity.ml-agents/Runtime/Sensors/ObservationSpec.cs:62-110](repo://com.unity.ml-agents/Runtime/Sensors/ObservationSpec.cs#L62-L110)

`DimensionProperty` is a flags enum. `None` means the dimension can go through a fully connected layer, `TranslationalEquivariance` that a convolution makes sense along it, and `VariableSize` that it holds a variable number of unordered items. The trainer uses these flags to pick an encoder ([[Observation Encoders and Attention]]). `ObservationType` is `Default` or `GoalSignal`; a goal signal conditions the network instead of being a plain input.

Sources: [com.unity.ml-agents/Runtime/Sensors/ISensor.cs:6-49](repo://com.unity.ml-agents/Runtime/Sensors/ISensor.cs#L6-L49)

## Writing observations

`ObservationWriter` is a target-agnostic writer. Internally it is pointed either at an `IList<float>` with an offset (protobuf float lists, demonstration buffers, stacking buffers) or at a `TensorProxy` with a batch index and channel offset (inference input tensors). Sensors write through its indexers and helpers and never see which.

Sources: [com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs:13-79](repo://com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs#L13-L79)

| API | Writes |
| --- | --- |
| `writer[index]` | one value of a 1-D observation |
| `writer[ch, w]` | one value of a 2-D observation |
| `writer[ch, h, w]` | one value of a 3-D observation, bounds-checked when writing to a list |
| `AddList(data, writeOffset)` | a list of floats |
| `Add(Vector3)`, `Add(Vector4)`, `Add(Quaternion)` | 3 or 4 consecutive floats |
| `WriteTexture(texture, grayScale)` | a `Texture2D` as 1 or 3 channels in `[0, 1]`, flipped vertically |

Sources: [com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs:85-188](repo://com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs#L85-L188), [com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs:195-261](repo://com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs#L195-L261), [com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs:267-362](repo://com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs#L267-L362)

`WriteTexture` flips the image because training receives textures as PNGs, which come out upside down relative to `GetPixels32`; flipping at inference keeps the two inputs identical. RGB24 textures take a faster path that reads raw bytes.

Sources: [com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs:283-361](repo://com.unity.ml-agents/Runtime/Sensors/ObservationWriter.cs#L283-L361)

## Compression

`CompressionSpec` tells the encoder whether a sensor's data can be sent as PNG instead of floats. `SensorCompressionType` is `None` or `PNG`. A compressed sensor with more than three channels is sent as several PNGs concatenated, and `CompressedChannelMapping` says which output channel each decoded PNG channel goes to: equal indices are averaged, negative indices dropped. A grayscale camera stacked twice, for example, maps `[0, 0, 0, 1, 1, 1]`. `IsTrivialMapping` reports a null, all-zero (grayscale) or identity mapping, which needs no mapping on the wire.

Sources: [com.unity.ml-agents/Runtime/Sensors/CompressionSpec.cs:7-111](repo://com.unity.ml-agents/Runtime/Sensors/CompressionSpec.cs#L7-L111)

When building the observation message, `GetObservationProto` checks what the trainer said it can handle. If a multi-PNG observation meets a trainer without `ConcatenatedPngObservations`, or a non-trivial mapping meets one without `CompressedChannelMapping`, it logs one warning and falls back to floats. A sensor that declares compression but returns null from `GetCompressedObservation` throws. See [[Communication Protocol]].

Sources: [com.unity.ml-agents/Runtime/Communicator/GrpcExtensions.cs:341-416](repo://com.unity.ml-agents/Runtime/Communicator/GrpcExtensions.cs#L341-L416)

## VectorSensor

`VectorSensor` is the sensor behind `Agent.CollectObservations` and the simplest way to observe anything. It keeps a list of floats; `AddObservation` overloads accept `float`, `int`, `bool` (as 0 or 1), `Vector2`, `Vector3`, `Quaternion` and `IList<float>`, and `AddOneHotObservation(observation, range)` appends a one-hot vector. Each value goes through `Utilities.DebugCheckNanAndInfinity`. Its default name is `VectorSensor_size<N>`, with the observation type appended when it is not `Default`.

Sources: [com.unity.ml-agents/Runtime/Sensors/VectorSensor.cs:10-38](repo://com.unity.ml-agents/Runtime/Sensors/VectorSensor.cs#L10-L38), [com.unity.ml-agents/Runtime/Sensors/VectorSensor.cs:125-216](repo://com.unity.ml-agents/Runtime/Sensors/VectorSensor.cs#L125-L216)

`Write` forgives size mistakes: more values than the declared size are truncated and fewer are padded with zeros, each with a warning, so a wrong `VectorObservationSize` shows up in the console rather than as a crash. `Update` and `Reset` both clear the list, which is why `CollectObservations` must add every value each step.

Sources: [com.unity.ml-agents/Runtime/Sensors/VectorSensor.cs:41-88](repo://com.unity.ml-agents/Runtime/Sensors/VectorSensor.cs#L41-L88)

## StackingSensor

`StackingSensor` wraps another sensor and returns its last N observations together, giving a network without memory a short history. It multiplies the last dimension of a 1-D or 2-D shape, or the channel dimension of a 3-D shape, by N. The agent wraps its `CollectObservations` sensor in one when `NumStackedVectorObservations` is above one; camera, render texture, ray and grid sensor components offer a stacking option that uses it too.

Sources: [com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs:19-75](repo://com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs#L19-L75), [com.unity.ml-agents/Runtime/Agent.cs:1018-1033](repo://com.unity.ml-agents/Runtime/Agent.cs#L1018-L1033)

It keeps a ring buffer of N float arrays. `Update` advances the ring index; `Write` first lets the wrapped sensor write the current observation into the current slot through a private writer, then writes all slots oldest first. For 3-D observations it re-lays the channels so each stacked frame becomes another block of channels. `Reset` zeroes every slot, so the start of an episode sees zeros rather than the previous episode.

Sources: [com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs:119-183](repo://com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs#L119-L183)

For a compressed wrapped sensor it also keeps N PNGs, initialised to an empty black PNG. `GetCompressedObservation` stores the newest PNG and concatenates all of them oldest first, and `GetCompressionSpec` returns a stacked channel mapping: the wrapped mapping (or `[0, 0, 0]` for one channel, identity otherwise) padded to a multiple of three with -1 and repeated with each copy offset by the wrapped channel count. The float buffers are kept too, in case the trainer cannot take compressed data.

Sources: [com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs:76-93](repo://com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs#L76-L93), [com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs:198-294](repo://com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs#L198-L294)

## Sensor components

Sensors are plain C# objects; `SensorComponent` is the `MonoBehaviour` you attach to a GameObject to create them. Its single abstract method, `CreateSensors()`, is called by the agent during initialization and returns any number of sensors. A custom observation source is therefore a class implementing `ISensor` plus a small component returning it, as `BasicSensorComponent` does in the Basic example.

Sources: [com.unity.ml-agents/Runtime/Sensors/SensorComponent.cs:1-17](repo://com.unity.ml-agents/Runtime/Sensors/SensorComponent.cs#L1-L17), [Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicSensorComponent.cs:1-62](repo://Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicSensorComponent.cs#L1-L62)

Built-in sensors also implement the internal `IBuiltInSensor`, which returns a `BuiltInSensorType` used only for analytics; `StackingSensor` reports the type of the sensor it wraps.

Sources: [com.unity.ml-agents/Runtime/Sensors/IBuiltInSensor.cs:1-69](repo://com.unity.ml-agents/Runtime/Sensors/IBuiltInSensor.cs#L1-L69), [com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs:297-301](repo://com.unity.ml-agents/Runtime/Sensors/StackingSensor.cs#L297-L301)

## Shape validation

All agents of one behavior must produce observations of the same shapes, since they feed one network. `SensorShapeValidator` remembers the specs of the first sensor list it sees and, for every later list, asserts that the number of sensors and each shape match. `RpcCommunicator` keeps one validator per behavior name and `ModelRunner` one per runner, so a mismatch appears as a failed assertion in the console.

Sources: [com.unity.ml-agents/Runtime/Sensors/SensorShapeValidator.cs:9-57](repo://com.unity.ml-agents/Runtime/Sensors/SensorShapeValidator.cs#L9-L57), [com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs:336-345](repo://com.unity.ml-agents/Runtime/Communicator/RpcCommunicator.cs#L336-L345), [com.unity.ml-agents/Runtime/Inference/ModelRunner.cs:170-178](repo://com.unity.ml-agents/Runtime/Inference/ModelRunner.cs#L170-L178)
