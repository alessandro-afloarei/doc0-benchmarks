---
title: "Built-in Sensors"
---
## Overview

The package ships sensors for the observations most agents need, each paired with a `SensorComponent` you add in the Inspector. All of them implement the `ISensor` contract described in [[Sensors and Observations]]; this page says what each one observes, the shape it produces, and when to pick it. Grid-based sensors have their own page, [[Grid Sensors]], and the Match-3 board sensor is on [[Match-3 Integration]].

Sources: [com.unity.ml-agents/Runtime/Sensors/IBuiltInSensor.cs:9-55](repo://com.unity.ml-agents/Runtime/Sensors/IBuiltInSensor.cs#L9-L55)

## Choosing a sensor

| Sensor | Component | Observation | Choose it when |
| --- | --- | --- | --- |
| `VectorSensor` | (the agent itself) | `(N)` floats | you can compute the features yourself in `CollectObservations` |
| `CameraSensor` | `CameraSensorComponent` | `(1 or 3, height, width)` image, PNG by default | the agent must see the scene through a camera |
| `RenderTextureSensor` | `RenderTextureSensorComponent` | `(1 or 3, height, width)` image, PNG by default | something else already renders into a `RenderTexture` |
| `RayPerceptionSensor` | `RayPerceptionSensorComponent3D` / `2D` | `(rays * (tags + 2))` floats | the agent needs cheap distance and type information around it |
| `BufferSensor` | `BufferSensorComponent` | `(maxNum, size)` with variable count | the number of relevant entities changes over time |
| `PhysicsBodySensor` | `RigidBodySensorComponent`, `ArticulationBodySensorComponent` | `(N)` floats of poses, velocities and joint data | the agent is a ragdoll or articulated body |
| Reflection sensors | `[Observable]` on fields and properties | `(N)` floats per member | you want to observe existing fields without writing `CollectObservations` |

Sources: [com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs:49-61](repo://com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs#L49-L61), [com.unity.ml-agents/Runtime/Sensors/RenderTextureSensor.cs:37-48](repo://com.unity.ml-agents/Runtime/Sensors/RenderTextureSensor.cs#L37-L48), [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs:86-89](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs#L86-L89), [com.unity.ml-agents/Runtime/Sensors/BufferSensor.cs:24-32](repo://com.unity.ml-agents/Runtime/Sensors/BufferSensor.cs#L24-L32), [com.unity.ml-agents/Runtime/Sensors/PhysicsBodySensor.cs:27-48](repo://com.unity.ml-agents/Runtime/Sensors/PhysicsBodySensor.cs#L27-L48), [com.unity.ml-agents/Runtime/Sensors/Reflection/ObservableAttribute.cs:62-72](repo://com.unity.ml-agents/Runtime/Sensors/Reflection/ObservableAttribute.cs#L62-L72)

## Visual sensors

### CameraSensor

`CameraSensor` renders a `Camera` into an offscreen texture of the configured size and observes the pixels. Its spec is `ObservationSpec.Visual` with one channel in grayscale or three in color. `Update` does the rendering: `ObservationToTexture` temporarily sets the camera's viewport to full, renders into a temporary `RenderTexture` with a 24-bit depth buffer, reads the pixels into an RGB24 `Texture2D` and restores the camera's previous target and rect. It logs an error first if there is no graphics device, which is the case under `--no-graphics`.

Sources: [com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs:10-61](repo://com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs#L10-L61), [com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs:113-165](repo://com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs#L113-L165)

`Write` converts that texture through `WriteTexture`; `GetCompressedObservation` encodes it with `EncodeToPNG`. Since both read the texture produced in `Update`, they can run several times per step without rendering again. The sensor implements `IDisposable` and destroys its texture.

Sources: [com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs:88-125](repo://com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs#L88-L125), [com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs:176-183](repo://com.unity.ml-agents/Runtime/Sensors/CameraSensor.cs#L176-L183)

`CameraSensorComponent` exposes the camera, sensor name (default `"CameraSensor"`), width and height (default 84 by 84), grayscale, observation type, compression (default PNG) and observation stacks (1 to 50, wrapping the sensor in a `StackingSensor` above 1). `RuntimeCameraEnable` controls whether the camera also renders normally at run time; it defaults to off, so the camera renders only when the sensor asks.

Sources: [com.unity.ml-agents/Runtime/Sensors/CameraSensorComponent.cs:10-112](repo://com.unity.ml-agents/Runtime/Sensors/CameraSensorComponent.cs#L10-L112), [com.unity.ml-agents/Runtime/Sensors/CameraSensorComponent.cs:142-165](repo://com.unity.ml-agents/Runtime/Sensors/CameraSensorComponent.cs#L142-L165)

### RenderTextureSensor

`RenderTextureSensor` observes a `RenderTexture` that something else fills, such as a minimap camera or a custom render pass. Its size comes from the render texture. Unlike the camera sensor, it copies the render texture into its `Texture2D` inside `Write` and `GetCompressedObservation` themselves, and its `Update` is empty. `RenderTextureSensorComponent` offers the same grayscale, compression and stacking options as the camera component.

Sources: [com.unity.ml-agents/Runtime/Sensors/RenderTextureSensor.cs:9-117](repo://com.unity.ml-agents/Runtime/Sensors/RenderTextureSensor.cs#L9-L117), [com.unity.ml-agents/Runtime/Sensors/RenderTextureSensorComponent.cs:10-95](repo://com.unity.ml-agents/Runtime/Sensors/RenderTextureSensorComponent.cs#L10-L95)

## Ray perception

### What a ray observes

`RayPerceptionSensor` casts a fan of rays (or spheres, with a cast radius) from the agent and reports, per ray, which detectable tag it hit and how far along the ray. The cast is described by a `RayPerceptionInput`: ray length, detectable tags, angles in degrees, start and end vertical offsets, cast radius, the transform to cast from, `Cast2D` or `Cast3D`, a layer mask and whether to batch.

Sources: [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs:12-89](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs#L12-L89)

### Encoding

Each ray produces `tags + 2` floats: a one-hot slot for the tag of the hit object (all zeros if it hit nothing or an untagged object), a slot that is 1 when the ray hit nothing, and the hit fraction (distance over ray length, 1 when nothing was hit). The total size is `(tags + 2) * rays`. Tags are compared in list order and the first match wins; empty or invalid tags are ignored.

Sources: [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs:143-240](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs#L143-L240), [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs:637-667](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs#L637-L667)

### Casting

The casts happen in `Update`; `Write` only encodes the stored results. Each ray's start and end are transformed to world space, so a scaled agent gets a scaled ray length and cast radius, and the hit fraction is computed against the scaled length. 3D rays use `Physics.Raycast` or `Physics.SphereCast`, 2D rays `Physics2D.Raycast` or `Physics2D.CircleCast`, each compiled in only when the matching physics module is present. With `UseBatchedRaycasts` on and a 3D cast, all rays go into one `RaycastCommand` or `SpherecastCommand` batch job instead.

Sources: [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs:321-365](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs#L321-L365), [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs:430-548](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs#L430-L548), [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs:557-623](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs#L557-L623)

### Components

`RayPerceptionSensorComponent3D` and `2D` share `RayPerceptionSensorComponentBase`. You set rays per direction (default 3), the maximum angle from straight ahead (default 70 degrees), ray length (default 20), tags, layer mask, stacks and batching. With `RaysPerDirection = n` the sensor casts `2n + 1` rays evenly spaced by `MaxRayDegrees / n` around 90 degrees (forward); with `AlternatingRayOrder` on (the default) they are ordered from the center outward, alternating sides (`90, 90 - delta, 90 + delta, ...`), and otherwise from one edge to the other. Changing the number of rays or tags at run time is logged as unsupported, since it changes the observation size.

Sources: [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensorComponentBase.cs:43-97](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensorComponentBase.cs#L43-L97), [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensorComponentBase.cs:118-164](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensorComponentBase.cs#L118-L164), [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensorComponentBase.cs:250-312](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensorComponentBase.cs#L250-L312), [com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs:298-313](repo://com.unity.ml-agents/Runtime/Sensors/RayPerceptionSensor.cs#L298-L313)

## Variable-length entities: BufferSensor

`BufferSensor` observes a set of entities whose number changes, such as the tiles left in the Sorter example. It is created with a maximum count and a per-entity size, and its spec is `VariableLength` with a `VariableSize` first dimension. Game code calls `AppendObservation(float[])` once per entity during the step; an array of the wrong size throws, and entities beyond the maximum are silently dropped. `Write` writes the whole `(maxNum, size)` buffer, with unused rows left at zero, and `Update` and `Reset` both clear it, so entities must be appended every step.

Sources: [com.unity.ml-agents/Runtime/Sensors/BufferSensor.cs:8-122](repo://com.unity.ml-agents/Runtime/Sensors/BufferSensor.cs#L8-L122), [com.unity.ml-agents/Runtime/Sensors/BufferSensorComponent.cs:8-67](repo://com.unity.ml-agents/Runtime/Sensors/BufferSensorComponent.cs#L8-L67)

The trainer processes this observation with attention over the rows, treating all-zero rows as padding; see [[Observation Encoders and Attention]].

Sources: [ml-agents/mlagents/trainers/torch_entities/attention.py:14-35](repo://ml-agents/mlagents/trainers/torch_entities/attention.py#L14-L35)

## Physics bodies

`PhysicsBodySensor` observes a hierarchy of rigidbodies or articulation bodies, as used by walkers and crawlers. A pose extractor walks the hierarchy from a root body; each enabled body contributes pose observations, and each also gets a joint extractor that adds joint data. The total size is computed once in the constructor from `PhysicsSensorSettings`.

Sources: [com.unity.ml-agents/Runtime/Sensors/PhysicsBodySensor.cs:12-71](repo://com.unity.ml-agents/Runtime/Sensors/PhysicsBodySensor.cs#L12-L71)

| Setting | Floats per body |
| --- | --- |
| `UseModelSpaceTranslations` (default on) | 3 position, relative to the root |
| `UseModelSpaceRotations` (default on) | 4 quaternion, relative to the root |
| `UseModelSpaceLinearVelocity` | 3 |
| `UseLocalSpaceTranslations`, `UseLocalSpaceRotations`, `UseLocalSpaceLinearVelocity` | 3, 4, 3, relative to the parent body |
| `UseJointPositionsAndAngles`, `UseJointForces` | written by the joint extractors |

Sources: [com.unity.ml-agents/Runtime/Sensors/PhysicsSensorSettings.cs:10-80](repo://com.unity.ml-agents/Runtime/Sensors/PhysicsSensorSettings.cs#L10-L80), [com.unity.ml-agents/Runtime/Sensors/PhysicsSensorSettings.cs:92-149](repo://com.unity.ml-agents/Runtime/Sensors/PhysicsSensorSettings.cs#L92-L149)

`Update` recomputes model-space or local-space poses only when some setting needs them, and `Write` writes the poses and then each joint extractor's data. `RigidBodySensorComponent` takes a `RootBody`, an optional `VirtualRoot` GameObject to measure from, the settings and a name (default `PhysicsBodySensor:<root>`); it remembers which bodies you disabled when it rebuilds its pose extractor. `ArticulationBodySensorComponent` does the same for an `ArticulationBody` root.

Sources: [com.unity.ml-agents/Runtime/Sensors/PhysicsBodySensor.cs:80-110](repo://com.unity.ml-agents/Runtime/Sensors/PhysicsBodySensor.cs#L80-L110), [com.unity.ml-agents/Runtime/Sensors/RigidBodySensorComponent.cs:10-110](repo://com.unity.ml-agents/Runtime/Sensors/RigidBodySensorComponent.cs#L10-L110), [com.unity.ml-agents/Runtime/Sensors/ArticulationBodySensorComponent.cs:7-24](repo://com.unity.ml-agents/Runtime/Sensors/ArticulationBodySensorComponent.cs#L7-L24)

## Observable attributes

Marking a field or property of an agent with `[Observable]` creates a sensor for it, without any code in `CollectObservations`. This is off by default: `BehaviorParameters.ObservableAttributeHandling` must be `ExcludeInherited` (only members declared on the agent's own class) or `ExamineAll`. `CreateObservableSensors` reflects over public and non-public instance fields and readable properties.

Sources: [com.unity.ml-agents/Runtime/Sensors/Reflection/ObservableAttribute.cs:48-160](repo://com.unity.ml-agents/Runtime/Sensors/Reflection/ObservableAttribute.cs#L48-L160), [com.unity.ml-agents/Runtime/Agent.cs:990-999](repo://com.unity.ml-agents/Runtime/Agent.cs#L990-L999)

| Member type | Floats |
| --- | --- |
| `int`, `float`, `bool` | 1 |
| `Vector2` | 2 |
| `Vector3` | 3 |
| `Vector4`, `Quaternion` | 4 |
| any `enum` | one per enum value: one-hot, or one bit per value for `[Flags]` enums |

Sources: [com.unity.ml-agents/Runtime/Sensors/Reflection/ObservableAttribute.cs:62-72](repo://com.unity.ml-agents/Runtime/Sensors/Reflection/ObservableAttribute.cs#L62-L72), [com.unity.ml-agents/Runtime/Sensors/Reflection/EnumReflectionSensor.cs:5-59](repo://com.unity.ml-agents/Runtime/Sensors/Reflection/EnumReflectionSensor.cs#L5-L59)

Members of other types are skipped at run time and reported by `GetTotalObservationSize` as errors, which the Behavior Parameters inspector shows as warnings; so are write-only properties. Each sensor is named `ObservableAttribute:<Type>.<member>` unless the attribute gives a name, and `numStackedObservations` above 1 wraps it in a `StackingSensor`. Every read goes through reflection (`FieldInfo.GetValue` or the property getter) on each `Write`.

Sources: [com.unity.ml-agents/Runtime/Sensors/Reflection/ObservableAttribute.cs:172-284](repo://com.unity.ml-agents/Runtime/Sensors/Reflection/ObservableAttribute.cs#L172-L284), [com.unity.ml-agents/Runtime/Sensors/Reflection/ReflectionSensorBase.cs:27-109](repo://com.unity.ml-agents/Runtime/Sensors/Reflection/ReflectionSensorBase.cs#L27-L109)

`Ball3DHardAgent` observes its platform rotation and the ball's offset this way, each stacked over nine steps:

Sources: [Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DHardAgent.cs:20-36](repo://Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DHardAgent.cs#L20-L36)

```csharp
    [Observable(numStackedObservations: 9)]
    Vector2 Rotation
    {
        get
        {
            return new Vector2(gameObject.transform.rotation.z, gameObject.transform.rotation.x);
        }
    }

    [Observable(numStackedObservations: 9)]
    Vector3 PositionDelta
    {
        get
        {
            return ball.transform.position - gameObject.transform.position;
        }
    }
```

Sources: [Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DHardAgent.cs:20-36](repo://Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DHardAgent.cs#L20-L36)
