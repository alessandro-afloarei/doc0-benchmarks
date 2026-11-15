---
title: "Grid Sensors"
---
## Overview

A grid sensor observes the area around an agent as a top-down 2D grid of cells. Each step it checks every cell for colliders with one of a list of tags and writes a small vector per cell, producing an image-like `(channels, height, width)` observation that the trainer can process with a convolutional encoder. It sits between ray perception (cheap but sparse) and a camera (dense but expensive to render): the grid gives full coverage of the area using physics queries only, and encodes object types exactly instead of as pixel colors.

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:27-82](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L27-L82)

Three types share the work. `GridSensorComponent` is the component you configure; `BoxOverlapChecker` performs the physics queries (perception); one or more `GridSensorBase` subclasses turn detected objects into per-cell data (encoding). The general sensor contract is on [[Sensors and Observations]].

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs:201-259](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs#L201-L259), [com.unity.ml-agents/Runtime/Sensors/IGridPerception.cs:9-61](repo://com.unity.ml-agents/Runtime/Sensors/IGridPerception.cs#L9-L61)

## Configuration

| Property | Default | Meaning |
| --- | --- | --- |
| `SensorName` | `"GridSensor"` | Prefix for the created sensors' names |
| `CellScale` | `(1, 0.01, 1)` | Size of one cell; y is the height of each overlap box |
| `GridSize` | `(16, 1, 16)` | Cells in x and z; y is forced to 1 |
| `RotateWithAgent` | `true` | Rotate the grid with the GameObject, or keep it world-aligned |
| `AgentGameObject` | none | Object whose own colliders are ignored |
| `DetectableTags` | none | Tags to detect, in priority order |
| `ColliderMask` | none | Layers to query |
| `InitialColliderBufferSize`, `MaxColliderBufferSize` | 4, 500 | Size limits of the overlap result buffer |
| `CompressionType` | `PNG` | Compress observations as PNG when the data is normalized |
| `ObservationStacks` | 1 | Stack previous frames (1 to 50) |
| `ShowGizmos`, `DebugColors`, `GizmoYOffset` | off | Draw detected cells in the Scene view |

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs:10-114](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs#L10-L114), [com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs:115-198](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs#L115-L198)

## Building the sensors

`CreateSensors` wires the pieces together:

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs:201-246](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs#L201-L246)

1. It creates a `BoxOverlapChecker` centered on the component's GameObject with the configured cell scale, grid size, rotation, mask, tags and buffer sizes.
2. It creates a hidden `DebugGridSensor` (uncompressed, since it stores tag indices above 1) and registers it for gizmo drawing.
3. It calls the virtual `GetGridSensors()`. The default returns one `OneHotGridSensor` named `<SensorName>-OneHot`; returning no sensors throws `UnityAgentsException`.
4. It gives only the first sensor a reference to the checker, so the physics queries run once per step however many sensors share the grid, and registers every sensor with the checker.
5. It wraps each sensor in a `StackingSensor` when `ObservationStacks` is not 1.

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs:201-259](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs#L201-L259)

## Perception: BoxOverlapChecker

Cells are laid out around the center object: cell `i` sits at x index `i / gridSize.z` and z index `i % gridSize.z`, offset so the grid is centered, and scaled by the cell size. With `RotateWithAgent` the local positions go through the center object's transform; otherwise they are added to its world position and the boxes stay axis-aligned.

Sources: [com.unity.ml-agents/Runtime/Sensors/BoxOverlapChecker.cs:80-112](repo://com.unity.ml-agents/Runtime/Sensors/BoxOverlapChecker.cs#L80-L112)

`Perceive` runs `Physics.OverlapBoxNonAlloc` for every cell, with half-extents of half the cell in x and z and the full cell height in y. When the result buffer comes back full, the checker doubles it (up to `MaxColliderBufferSize`) and queries again, so cells crowded with colliders are not silently truncated until the maximum is reached. All of this is compiled only when the physics module is present.

Sources: [com.unity.ml-agents/Runtime/Sensors/BoxOverlapChecker.cs:114-175](repo://com.unity.ml-agents/Runtime/Sensors/BoxOverlapChecker.cs#L114-L175)

The checker then reports what it found through two events, and each sensor subscribes to one of them according to its `ProcessCollidersMethod`. `ProcessAllColliders` reports every collider in the cell except the agent's own. `ProcessClosestColliders` reports only the collider with a detectable tag whose bounds are closest to the grid center.

Sources: [com.unity.ml-agents/Runtime/Sensors/BoxOverlapChecker.cs:180-262](repo://com.unity.ml-agents/Runtime/Sensors/BoxOverlapChecker.cs#L180-L262)

## Encoding: GridSensorBase

`GridSensorBase` requires `gridSize.y == 1` and declares `ObservationSpec.Visual(cellObservationSize, gridSize.x, gridSize.z)`. It keeps a flat perception buffer of `cells * cellObservationSize` floats. In `Update` it clears the buffer and, if it owns the checker, calls `Perceive`.

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:57-82](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L57-L82), [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:121-134](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L121-L134), [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:299-309](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L299-L309)

`ProcessDetectedObject` handles each reported object. It finds the first detectable tag the object has, then prepares a cell buffer: a copy of the cell's current data when processing all colliders (so values accumulate), or zeros when processing the closest one. It calls `GetObjectData(detectedObject, tagIndex, buffer)`, validates the values and copies the buffer back into the cell.

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:273-296](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L273-L296)

`Write` outputs the buffer as `writer[channel, h, w]`, walking z from the far edge down so the grid matches the image orientation used for visual observations. `GetCompressedObservation` packs the channels three at a time into RGB textures and concatenates their PNG encodings.

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:155-185](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L155-L185), [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:318-336](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L318-L336)

## Normalization and compression

PNG stores values between 0 and 1 only. Setting `CompressionType` to PNG on a sensor whose `IsDataNormalized()` is false logs a warning and leaves compression off. When PNG is on, `ValidateValues` throws `UnityAgentsException` for any cell value outside `[0, 1]`, naming the object that produced it.

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:87-100](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L87-L100), [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:255-269](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L255-L269)

## Built-in encodings

| Sensor | Channels | Colliders processed | Cell value | Normalized |
| --- | --- | --- | --- | --- |
| `GridSensorBase` (default) | 1 | closest | tag index + 1 | no |
| `OneHotGridSensor` | one per tag | closest | 1 in the channel of the closest object's tag | yes |
| `CountingGridSensor` | one per tag | all | number of objects with each tag | no (compression forced off) |

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:217-250](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L217-L250), [com.unity.ml-agents/Runtime/Sensors/OneHotGridSensor.cs:8-58](repo://com.unity.ml-agents/Runtime/Sensors/OneHotGridSensor.cs#L8-L58), [com.unity.ml-agents/Runtime/Sensors/CountingGridSensor.cs:9-60](repo://com.unity.ml-agents/Runtime/Sensors/CountingGridSensor.cs#L9-L60)

## Writing a custom grid sensor

To encode something other than tags, subclass `GridSensorBase` and override four methods, then subclass `GridSensorComponent` and override `GetGridSensors()` to return your sensor (alongside or instead of the one-hot sensor).

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs:253-259](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs#L253-L259)

| Override | Purpose |
| --- | --- |
| `GetCellObservationSize()` | Number of floats per cell |
| `GetObjectData(detectedObject, tagIndex, dataBuffer)` | Fill the cell's values from the detected object |
| `IsDataNormalized()` | Return true only if every value is in `[0, 1]`, to allow PNG compression |
| `GetProcessCollidersMethod()` | Closest object only, or all objects (accumulating) |

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:186-250](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L186-L250)

The documentation comment on `GetObjectData` gives this example of a sensor that records the velocity of rigidbodies, which needs a cell observation size of 3 and is not normalized:

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:186-216](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L186-L216)

```csharp
protected override void GetObjectData(GameObject detectedObject, int tagIndex, float[] dataBuffer)
{
    if (tagIndex == Array.IndexOf(DetectableTags, "RigidBodyObject"))
    {
        Rigidbody rigidbody = detectedObject.GetComponent<Rigidbody>();
        dataBuffer[0] = rigidbody.velocity.x;
        dataBuffer[1] = rigidbody.velocity.y;
        dataBuffer[2] = rigidbody.velocity.z;
    }
}
```

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs:203-214](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorBase.cs#L203-L214)

## Debug gizmos

With `ShowGizmos` on, `OnDrawGizmos` clears the debug sensor, runs a closest-collider pass over the grid and draws a half-transparent cube per cell, colored by `DebugColors[tagIndex]` for detected objects and white otherwise, raised by `GizmoYOffset`. This runs its own queries in the Editor and does not affect the observations.

Sources: [com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs:277-310](repo://com.unity.ml-agents/Runtime/Sensors/GridSensorComponent.cs#L277-L310), [com.unity.ml-agents/Runtime/Sensors/BoxOverlapChecker.cs:134-145](repo://com.unity.ml-agents/Runtime/Sensors/BoxOverlapChecker.cs#L134-L145)
