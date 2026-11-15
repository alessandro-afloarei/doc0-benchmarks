---
title: "Example Environments"
---
## Overview

The `Project` folder is a Unity project whose `Assets/ML-Agents/Examples` folder holds the example environments. Each one is a scene plus a few scripts, and each exists to show one or more toolkit features in a small setting: a continuous-control balance task, a grid world with action masking, cooperative and competitive teams, physics-based walkers, a variable-length observation task. The `config` folder holds the YAML that trains each behavior, grouped by trainer (`ppo`, `sac`, `poca`) plus `imitation` for runs that use demonstrations.

Sources: [config/ppo/3DBall.yaml:1-25](repo://config/ppo/3DBall.yaml#L1-L25), [config/poca/SoccerTwos.yaml:1-30](repo://config/poca/SoccerTwos.yaml#L1-L30), [config/imitation/Hallway.yaml:1-30](repo://config/imitation/Hallway.yaml#L1-L30)

## Environments and the features they show

| Environment | Feature it demonstrates | Training configs |
| --- | --- | --- |
| 3DBall | Continuous actions, vector observations, `EnvironmentParameters` for ball mass and scale | `ppo/3DBall.yaml`, `ppo/3DBall_randomize.yaml`, `sac/3DBall.yaml` |
| 3DBallHard | `[Observable]` fields with stacked observations instead of `CollectObservations` | `ppo/3DBallHard.yaml`, `sac/3DBallHard.yaml` |
| Visual3DBall | Camera observations | `ppo/Visual3DBall.yaml` |
| Basic | An agent driven by a separate `MonoBehaviour`, a custom `SensorComponent` and `ActuatorComponent` | `ppo/Basic.yaml`, `sac/Basic.yaml` |
| GridWorld | Discrete actions with action masking, grid size from environment parameters | `ppo/GridWorld.yaml`, `sac/GridWorld.yaml` |
| Hallway | Recurrent memory (LSTM) for a task that needs remembering a cue | `ppo/Hallway.yaml`, `sac/Hallway.yaml`, `imitation/Hallway.yaml` |
| PushBlock, PushBlockWithInput | Ray perception; the Input System actuator in the second | `ppo/PushBlock.yaml`, `sac/PushBlock.yaml`, `imitation/PushBlock.yaml` |
| Pyramids | Sparse rewards solved with curiosity, RND or GAIL | `ppo/Pyramids.yaml`, `ppo/PyramidsRND.yaml`, `imitation/Pyramids.yaml` |
| WallJump | Several behaviors in one agent swapped with `SetModel`, curriculum on wall height | `ppo/WallJump.yaml`, `ppo/WallJump_curriculum.yaml` |
| FoodCollector | Grid sensor and camera variants | `ppo/FoodCollector.yaml`, `ppo/VisualFoodCollector.yaml` |
| Sorter | Buffer sensor for a variable number of tiles, curriculum on tile count | `ppo/Sorter_curriculum.yaml` |
| Crawler, Walker, Worm | Physics-based locomotion with `JointDriveController` | `ppo/*.yaml`, `sac/*.yaml`, `imitation/Crawler.yaml` |
| Soccer (SoccerTwos, StrikersVsGoalie) | Two `SimpleMultiAgentGroup` teams plus self-play | `poca/SoccerTwos.yaml`, `poca/StrikersVsGoalie.yaml` |
| PushBlockCollab, DungeonEscape | Cooperative groups with group rewards trained by POCA | `poca/PushBlockCollab.yaml`, `poca/DungeonEscape.yaml` |
| Match3 | The Match-3 integration: board, sensor and actuator | `ppo/Match3.yaml` |

Sources: [Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs:83-94](repo://Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs#L83-L94), [Project/Assets/ML-Agents/Examples/GridWorld/Scripts/GridAgent.cs:88-108](repo://Project/Assets/ML-Agents/Examples/GridWorld/Scripts/GridAgent.cs#L88-L108), [Project/Assets/ML-Agents/Examples/WallJump/Scripts/WallJumpAgent.cs:334-366](repo://Project/Assets/ML-Agents/Examples/WallJump/Scripts/WallJumpAgent.cs#L334-L366), [Project/Assets/ML-Agents/Examples/Soccer/Scripts/SoccerEnvController.cs:44-111](repo://Project/Assets/ML-Agents/Examples/Soccer/Scripts/SoccerEnvController.cs#L44-L111), [config/ppo/Pyramids.yaml:1-30](repo://config/ppo/Pyramids.yaml#L1-L30), [config/ppo/PyramidsRND.yaml:1-30](repo://config/ppo/PyramidsRND.yaml#L1-L30), [config/ppo/Hallway.yaml:1-25](repo://config/ppo/Hallway.yaml#L1-L25)

## A worked agent: Ball3DAgent

`Ball3DAgent` balances a ball on a platform and uses each override of the `Agent` class once, which makes it the shortest complete agent in the project. `Initialize` caches the ball's rigidbody and the Academy's `EnvironmentParameters`, then applies them.

Sources: [Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs:7-22](repo://Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs#L7-L22)

`CollectObservations` adds eight floats to the agent's `VectorSensor`: the platform's z and x rotation, the ball's position relative to the platform (three floats) and the ball's velocity (three floats). When `useVecObs` is off, as in the Visual3DBall scene, it adds nothing and the agent relies on its camera sensor.

Sources: [Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs:24-33](repo://Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs#L24-L33)

`OnActionReceived` reads two continuous actions, clamps them to `[-1, 1]` and scales them to a rotation of up to two degrees around z and x, refusing to tilt past 0.25 in either direction. If the ball drops more than 2 units below the platform or strays 3 units sideways, it sets the reward to -1 and ends the episode; otherwise it sets 0.1 for surviving the step.

Sources: [Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs:35-62](repo://Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs#L35-L62)

```csharp
public override void OnActionReceived(ActionBuffers actionBuffers)
{
    var actionZ = 2f * Mathf.Clamp(actionBuffers.ContinuousActions[0], -1f, 1f);
    var actionX = 2f * Mathf.Clamp(actionBuffers.ContinuousActions[1], -1f, 1f);

    if ((gameObject.transform.rotation.z < 0.25f && actionZ > 0f) ||
        (gameObject.transform.rotation.z > -0.25f && actionZ < 0f))
    {
        gameObject.transform.Rotate(new Vector3(0, 0, 1), actionZ);
    }

    if ((gameObject.transform.rotation.x < 0.25f && actionX > 0f) ||
        (gameObject.transform.rotation.x > -0.25f && actionX < 0f))
    {
        gameObject.transform.Rotate(new Vector3(1, 0, 0), actionX);
    }
    if ((ball.transform.position.y - gameObject.transform.position.y) < -2f ||
        Mathf.Abs(ball.transform.position.x - gameObject.transform.position.x) > 3f ||
        Mathf.Abs(ball.transform.position.z - gameObject.transform.position.z) > 3f)
    {
        SetReward(-1f);
        EndEpisode();
    }
    else
    {
        SetReward(0.1f);
    }
}
```

Sources: [Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs:35-62](repo://Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs#L35-L62)

`OnEpisodeBegin` gives the platform a random tilt of up to ten degrees on each axis, zeroes the ball's velocity, drops it from height 4 at a random offset and re-reads the environment parameters, so a curriculum or sampler that changes `mass` or `scale` takes effect from the next episode. `Heuristic` maps the keyboard's horizontal and vertical axes to the two actions, which lets you play the scene with the behavior type set to Heuristic Only.

Sources: [Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs:64-94](repo://Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs#L64-L94)

`config/ppo/3DBall_randomize.yaml` uses the same behavior settings and adds `environment_parameters` that draw `mass` (0.5 to 10) and `scale` (0.75 to 3) from uniform samplers, which `SetBall` reads with `GetWithDefault`. [[Curriculum and Environment Parameters]] explains how those values reach the agent.

Sources: [config/ppo/3DBall_randomize.yaml:26-36](repo://config/ppo/3DBall_randomize.yaml#L26-L36), [Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs:83-89](repo://Project/Assets/ML-Agents/Examples/3DBall/Scripts/Ball3DAgent.cs#L83-L89)

## Agents without an Agent subclass: Basic

The Basic scene shows that game code does not have to subclass `Agent`. `BasicController` is a plain `MonoBehaviour` that holds a reference to an `Agent` component, adds rewards to it and ends its episodes. Its observations come from `BasicSensorComponent` and its actions from `BasicActuatorComponent`, a custom actuator with one discrete branch of three actions.

Sources: [Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicController.cs:7-79](repo://Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicController.cs#L7-L79), [Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicSensorComponent.cs:1-62](repo://Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicSensorComponent.cs#L1-L62), [Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicActuatorComponent.cs:1-99](repo://Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicActuatorComponent.cs#L1-L99)

The controller also decides when to request decisions. In `FixedUpdate` it calls `RequestDecision` every step while a trainer is connected (`Academy.Instance.IsCommunicatorOn`), and only every `timeBetweenDecisionsAtInference` seconds otherwise, so a trained model plays at a watchable speed. Because nothing in the scene subclasses `Agent`, `Awake` registers the gRPC communicator with `CommunicatorFactory` itself on Editor and standalone builds.

Sources: [Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicController.cs:29-40](repo://Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicController.cs#L29-L40), [Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicController.cs:89-117](repo://Project/Assets/ML-Agents/Examples/Basic/Scripts/BasicController.cs#L89-L117)

## Groups and teams: Soccer and DungeonEscape

The multi-agent examples keep the group logic in an environment controller rather than in the agents. `SoccerEnvController` creates one `SimpleMultiAgentGroup` per team, registers each agent with its team's group, and on a goal gives the scoring team a reward that shrinks with elapsed time and the other team -1 before ending both group episodes. `DungeonEscapeEnvController` does the same with one cooperative group.

Sources: [Project/Assets/ML-Agents/Examples/Soccer/Scripts/SoccerEnvController.cs:44-111](repo://Project/Assets/ML-Agents/Examples/Soccer/Scripts/SoccerEnvController.cs#L44-L111), [Project/Assets/ML-Agents/Examples/DungeonEscape/Scripts/DungeonEscapeEnvController.cs:72-143](repo://Project/Assets/ML-Agents/Examples/DungeonEscape/Scripts/DungeonEscapeEnvController.cs#L72-L143)

`config/poca/SoccerTwos.yaml` trains that behavior with the `poca` trainer and adds a `self_play` block: save a snapshot every 50,000 steps, change the learning team every 200,000 steps, swap the opponent every 2,000 steps, and sample opponents from the last 10 snapshots. See [[Multi-Agent Groups]], [[POCA Multi-Agent Trainer]] and [[Self-Play]].

Sources: [config/poca/SoccerTwos.yaml:1-30](repo://config/poca/SoccerTwos.yaml#L1-L30)
