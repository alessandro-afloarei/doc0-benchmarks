---
title: "Match-3 Integration"
---
## Overview

Match-3 games (swap two adjacent pieces to line up three or more of a kind) have a regular structure that maps well onto a standard observation and action design: the board is a grid of cell types, and every possible move is a swap of two neighbouring cells. The Match-3 integration provides that design so a game only has to describe its board. A game subclasses `AbstractBoard`; a `Match3SensorComponent` turns the board into one-hot observations and a `Match3ActuatorComponent` turns a single discrete action into a swap, masking moves the game says are invalid. The Match3 example scene uses all three ([[Example Environments]]).

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs:73-134](repo://com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs#L73-L134), [com.unity.ml-agents/Runtime/Integrations/Match3/Match3SensorComponent.cs:11-58](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3SensorComponent.cs#L11-L58), [com.unity.ml-agents/Runtime/Integrations/Match3/Match3ActuatorComponent.cs:11-77](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3ActuatorComponent.cs#L11-L77)

## Describing the board

### BoardSize

`BoardSize` holds `Rows`, `Columns`, `NumCellTypes` and `NumSpecialTypes` (special pieces such as bombs; 0 when the game has none), with component-wise `<=` and `>=` comparisons.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs:12-67](repo://com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs#L12-L67)

### AbstractBoard

| Member | Implemented by | Meaning |
| --- | --- | --- |
| `GetMaxBoardSize()` | game (abstract) | Largest board the game will use; fixes the observation and action sizes |
| `GetCurrentBoardSize()` | game (optional) | Board in use now; defaults to the maximum |
| `GetCellType(row, col)` | game (abstract) | Cell type at a position, `0 .. NumCellTypes - 1` |
| `GetSpecialType(row, col)` | game (abstract) | Special type at a position, `0 .. NumSpecialTypes` |
| `IsMoveValid(move)` | game (abstract) | Whether the game allows this swap |
| `MakeMove(move)` | game (abstract) | Perform the swap |
| `OnNoValidMovesAction` | game (optional) | Callback when no move is valid |
| `NumMoves()`, `AllMoves()`, `ValidMoves()` | provided | Move count and move enumeration for the current board |
| `SimpleIsMoveValid(move)` | provided | Ready-made validity check |

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs:73-190](repo://com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs#L73-L190)

Separating maximum and current size lets one trained model handle boards of several sizes: everything is laid out for the maximum, and cells or moves outside the current board are zeroed or masked. Debug builds warn if the current size ever exceeds the maximum seen at start-up.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs:298-310](repo://com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs#L298-L310)

`SimpleIsMoveValid` rejects swapping two cells of the same type, then checks whether either swapped cell would complete a line of three: it counts matching cells left and right, and up and down, of the destination, skipping the direction the piece came from. Games with special rules implement their own `IsMoveValid`.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs:198-291](repo://com.unity.ml-agents/Runtime/Integrations/Match3/AbstractBoard.cs#L198-L291)

## Encoding moves

A `Move` is a cell (`Row`, `Column`), a `Direction` (`Up`, `Down`, `Left`, `Right`) and a `MoveIndex`. Every swap can be expressed as a move to the right or up from one of the two cells, so the integration numbers only those: first all rightward moves, `(Columns - 1) * Rows` of them, indexed by `col + row * (Columns - 1)`, then all upward moves, indexed from there by `col + row * Columns`. The total is `Rows * (Columns - 1) + (Rows - 1) * Columns`.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/Move.cs:40-101](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Move.cs#L40-L101), [com.unity.ml-agents/Runtime/Integrations/Match3/Move.cs:272-274](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Move.cs#L272-L274)

`FromMoveIndex` decodes an index, and `FromPositionAndDirection` encodes any cell and direction, normalizing left and down moves to the equivalent right or up move from the neighbour and throwing for moves off the board. `Next` steps to the following index without recomputing divisions, which the enumerations use. `OtherCell` gives the swapped neighbour and `InRangeForBoard` checks that both cells lie inside a (current) board size.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/Move.cs:108-205](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Move.cs#L108-L205), [com.unity.ml-agents/Runtime/Integrations/Match3/Move.cs:213-266](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Move.cs#L213-L266)

## Match3Actuator

### Action space

The actuator's action spec is a single discrete branch with one action per potential move of the maximum board. `OnActionReceived` decodes the chosen index and calls `MakeMove`; with `ForceHeuristic`, it first replaces the action with the heuristic one, which is meant for testing.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/Match3Actuator.cs:11-58](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3Actuator.cs#L11-L58)

### Masking invalid moves

`WriteDiscreteActionMask` walks every move index and masks each one that is out of range for the current board or rejected by `IsMoveValid`, so the policy only ever chooses legal swaps ([[Actuators and Actions]]). If no move is valid, masking all of them would trip the mask's assertion, so instead it calls `OnNoValidMovesAction` (or logs a warning) and unmasks the last move; the game then receives an invalid move and should handle it, for example by reshuffling.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/Match3Actuator.cs:61-108](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3Actuator.cs#L61-L108)

### Heuristic

`Heuristic` writes `GreedyMove()`: among valid moves it keeps the one with the highest `EvalMovePoints(move)`, choosing uniformly among ties by reservoir sampling with the actuator's seeded random generator. The base `EvalMovePoints` returns 1, so the default heuristic picks a random valid move; the example's `Match3ExampleActuator` overrides it to score moves, giving a stronger baseline player and demonstrations.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/Match3Actuator.cs:124-186](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3Actuator.cs#L124-L186), [Project/Assets/ML-Agents/Examples/Match3/Scripts/Match3ExampleActuator.cs:21-60](repo://Project/Assets/ML-Agents/Examples/Match3/Scripts/Match3ExampleActuator.cs#L21-L60)

`Match3ActuatorComponent` finds the `AbstractBoard` on its GameObject (returning no actuators without one), seeds the actuator from `RandomSeed` or, at -1, from the GameObject's instance id, and reports the action spec from the board's maximum size.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/Match3ActuatorComponent.cs:11-77](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3ActuatorComponent.cs#L11-L77)

## Match3Sensor

`Match3SensorComponent` creates up to two sensors for the board: one for cell types and, when the board has special types, one for special types (with `NumSpecialTypes + 1` channels, so "no special" is its own value). Each is a `Match3Sensor` reading values through a `GridValueProvider` delegate, `GetCellType` or `GetSpecialType`.

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/Match3SensorComponent.cs:42-75](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3SensorComponent.cs#L42-L75), [com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs:94-117](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs#L94-L117)

| `Match3ObservationType` | Spec | Data |
| --- | --- | --- |
| `Vector` (default) | `Vector(rows * columns * oneHotSize)` | one-hot per cell, flattened |
| `UncompressedVisual` | `Visual(oneHotSize, rows, columns)` | one-hot channels per cell |
| `CompressedVisual` | `Visual(oneHotSize, rows, columns)` | the same channels sent as PNGs |

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs:20-84](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs#L20-L84), [com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs:219-230](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs#L219-L230)

`Write` writes a one-hot vector for every cell of the current board and zeros for cells outside it, so the observation size stays that of the maximum board. For the compressed form, `GetCompressedObservation` encodes the one-hot channels three at a time into RGB textures (red, green, blue for the three values of each group), flipped vertically to match PNG orientation, and concatenates the PNGs; the trainer decodes them back into channels ([[Communication Protocol]]). The visual forms suit the `match3` visual encoder, which accepts boards as small as 5 by 5 ([[Observation Encoders and Attention]]).

Sources: [com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs:126-207](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs#L126-L207), [com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs:263-349](repo://com.unity.ml-agents/Runtime/Integrations/Match3/Match3Sensor.cs#L263-L349)
