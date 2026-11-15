---
title: "Input System Integration"
---
## Overview

Many games already route player control through Unity's Input System: an `InputActionAsset` defines actions such as Move or Jump, and gameplay code reads them. The Input System integration lets an agent drive the same actions. `InputActuatorComponent` turns each action of the player's default action map into an actuator; when a policy decides, the actuators write the chosen values into a virtual input device bound to those actions, so the game code receives agent decisions exactly as it would receive player input. In heuristic mode the direction reverses: the actuators read the real player input and report it as actions, which also makes recording demonstrations of a human player straightforward.

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:24-55](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L24-L55), [com.unity.ml-agents/Runtime/Input/InputActionActuator.cs:16-99](repo://com.unity.ml-agents/Runtime/Input/InputActionActuator.cs#L16-L99)

The integration lives in its own assembly, `Unity.ML-Agents.Input`, which references `Unity.InputSystem` and compiles only when `com.unity.inputsystem` 1.3.0 or newer is installed (the `MLA_INPUT_SYSTEM` define). Actuators in general are described on [[Actuators and Actions]].

Sources: [com.unity.ml-agents/Runtime/Input/Unity.ML-Agents.Input.asmdef:1-24](repo://com.unity.ml-agents/Runtime/Input/Unity.ML-Agents.Input.asmdef#L1-L24)

## Setting up

`InputActuatorComponent` requires a `PlayerInput` component and a component implementing `IInputActionAssetProvider` on the same GameObject, plus the agent's `BehaviorParameters`. The provider's `GetInputActionAsset()` returns the action asset and, optionally, the generated `IInputActionCollection2` wrapper, so that game code listening through the generated C# class sees the rebinding too. The PushBlockWithInput example's player controller implements it by returning its generated `PushBlockActions` and their asset.

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:284-306](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L284-L306), [com.unity.ml-agents/Runtime/Input/IInputActionAssetProvider.cs:17-25](repo://com.unity.ml-agents/Runtime/Input/IInputActionAssetProvider.cs#L17-L25), [Project/Assets/ML-Agents/Examples/PushBlockWithInput/Scripts/PushBlockWithInputPlayerController.cs:100-113](repo://Project/Assets/ML-Agents/Examples/PushBlockWithInput/Scripts/PushBlockWithInputPlayerController.cs#L100-L113)

## Mapping actions to actuators

Each input action gets an adaptor chosen by the control type the action expects. The adaptor defines the action spec of the actuator and converts in both directions.

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:39-46](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L39-L46), [com.unity.ml-agents/Runtime/Input/IRLActionInputAdaptor.cs:13-38](repo://com.unity.ml-agents/Runtime/Input/IRLActionInputAdaptor.cs#L13-L38)

| Control type | Adaptor | Action spec |
| --- | --- | --- |
| `Vector2Control` | `Vector2InputActionAdaptor` | 2 continuous |
| `AxisControl` | `FloatInputActionAdaptor` | 1 continuous |
| `DoubleControl` | `DoubleInputActionAdaptor` | 1 continuous |
| `ButtonControl` | `ButtonInputActionAdaptor` | 1 discrete branch of 2 |
| `IntegerControl` | `IntegerInputActionAdaptor` | 1 discrete branch of 2 |

Sources: [com.unity.ml-agents/Runtime/Input/Adaptors/Vector2InputActionAdaptor.cs:13-40](repo://com.unity.ml-agents/Runtime/Input/Adaptors/Vector2InputActionAdaptor.cs#L13-L40), [com.unity.ml-agents/Runtime/Input/Adaptors/ButtonInputActionAdaptor.cs:14-43](repo://com.unity.ml-agents/Runtime/Input/Adaptors/ButtonInputActionAdaptor.cs#L14-L43), [com.unity.ml-agents/Runtime/Input/Adaptors/FloatInputActionAdaptor.cs:1-36](repo://com.unity.ml-agents/Runtime/Input/Adaptors/FloatInputActionAdaptor.cs#L1-L36), [com.unity.ml-agents/Runtime/Input/Adaptors/IntegerInputActionAdaptor.cs:1-37](repo://com.unity.ml-agents/Runtime/Input/Adaptors/IntegerInputActionAdaptor.cs#L1-L37), [com.unity.ml-agents/Runtime/Input/Adaptors/DoubleInputActionAdaptor.cs:1-37](repo://com.unity.ml-agents/Runtime/Input/Adaptors/DoubleInputActionAdaptor.cs#L1-L37)

`controlTypeToAdaptorType` is a public static dictionary, so a project can map further control types to its own `IRLActionInputAdaptor` implementations.

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:39-46](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L39-L46)

## Creating the virtual device

`CreateActuators` runs when the agent initializes:

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:123-142](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L123-L142)

1. It finds the asset, `PlayerInput` and `BehaviorParameters`, subscribes to the behavior's `OnPolicyUpdated`, and names a layout `MLAgentsLayout<BehaviorName>`.
2. It registers a layout builder that creates one control per action of the default action map, each with the action's expected control type.
3. It adds an input device with that layout.
4. For each action, it creates an `InputActionActuator` with its adaptor, and adds a binding from the action to the device control of the same name in the `ml-agents` control scheme group.
5. It sets the bindings according to heuristic mode, re-enables the actions and stores the combined action spec.

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:154-177](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L154-L177), [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:263-306](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L263-L306)

In the Editor outside play mode, the `ActionSpec` property builds throwaway actuators with a dummy context to report the spec, so the Behavior Parameters inspector can validate models against it.

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:58-77](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L58-L77)

## Switching between agent and player

`UpdateDeviceBinding(isInHeuristicMode)` runs at creation and whenever the policy changes. When the agent is not in heuristic mode, it adds an `ml-agents` control scheme that requires only the virtual device and restricts the asset and action map to that binding group and device, so physical devices no longer drive the actions. In heuristic mode, the control scheme also lists the asset's own schemes' device requirements, and the binding mask and device restrictions are cleared so the player's real devices work.

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:187-256](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L187-L256)

## Writing actions as input events

`InputActionActuator.OnActionReceived` does nothing in heuristic mode. Otherwise it asks the shared `InputActuatorEventContext` for the current state event and lets the adaptor write its values into it, for example a `Vector2` built from two continuous actions or a button value from a discrete action.

Sources: [com.unity.ml-agents/Runtime/Input/InputActionActuator.cs:55-66](repo://com.unity.ml-agents/Runtime/Input/InputActionActuator.cs#L55-L66), [com.unity.ml-agents/Runtime/Input/Adaptors/Vector2InputActionAdaptor.cs:23-31](repo://com.unity.ml-agents/Runtime/Input/Adaptors/Vector2InputActionAdaptor.cs#L23-L31)

All actuators of one component share a single input event per step. The context is created with the number of actions as `NumTimesToProcess`. The first actuator of a step creates a new state event for the virtual device; each actuator's `using` block ends with `Dispose`, which counts it; when all actions have written their values, the event is queued with `InputSystem.QueueEvent` and its buffer released. The Input System then delivers one coherent device state, and game code reads it on its next update.

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorEventContext.cs:18-78](repo://com.unity.ml-agents/Runtime/Input/InputActuatorEventContext.cs#L18-L78)

## Heuristic mode

`Heuristic` lets the adaptor read the action's current value (`action.ReadValue`) and write it into the action buffers, for example the two components of a `Vector2`, or a button's value as 0 or 1. With Behavior Type set to Heuristic Only, or with no model and no trainer, the agent therefore plays from the keyboard or gamepad through the same action asset, and a `DemonstrationRecorder` records those actions.

Sources: [com.unity.ml-agents/Runtime/Input/InputActionActuator.cs:87-92](repo://com.unity.ml-agents/Runtime/Input/InputActionActuator.cs#L87-L92), [com.unity.ml-agents/Runtime/Input/Adaptors/Vector2InputActionAdaptor.cs:34-40](repo://com.unity.ml-agents/Runtime/Input/Adaptors/Vector2InputActionAdaptor.cs#L34-L40), [com.unity.ml-agents/Runtime/Policies/BehaviorParameters.cs:269-281](repo://com.unity.ml-agents/Runtime/Policies/BehaviorParameters.cs#L269-L281)

## Cleanup

`OnDisable` removes the layout and the virtual device, removes the `ml-agents` control scheme from the asset, clears the actuators and unsubscribes from policy updates. Input actuators do not mask actions and have no per-episode state.

Sources: [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:79-82](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L79-L82), [com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs:308-336](repo://com.unity.ml-agents/Runtime/Input/InputActuatorComponent.cs#L308-L336), [com.unity.ml-agents/Runtime/Input/InputActionActuator.cs:69-85](repo://com.unity.ml-agents/Runtime/Input/InputActionActuator.cs#L69-L85)
