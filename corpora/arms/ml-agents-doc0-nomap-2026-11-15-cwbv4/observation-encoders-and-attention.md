---
title: "Observation Encoders and Attention"
---
## Overview

An agent can mix very different observations: a vector of floats, one or more images or grids, a variable-length list of entities, and goal signals. Before the policy's hidden layers can use them, each must become a fixed-size vector. `ObservationEncoder` does this. For each observation it chooses an encoder from the observation's dimension properties (the same flags Unity's sensors declare, see [[Sensors and Observations]]), runs variable-length observations through a self-attention block, and concatenates everything. Goal-signal observations can instead condition the hidden layers through a hypernetwork. The network around the encoder is described on [[Policies and Network Architecture]].

Sources: [ml-agents/mlagents/trainers/torch_entities/networks.py:33-70](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L33-L70), [ml-agents/mlagents/trainers/torch_entities/utils.py:147-227](repo://ml-agents/mlagents/trainers/torch_entities/utils.py#L147-L227)

## Choosing an encoder per observation

`ModelUtils.get_encoder_for_obs` looks only at the tuple of dimension properties.

Sources: [ml-agents/mlagents/trainers/torch_entities/utils.py:147-186](repo://ml-agents/mlagents/trainers/torch_entities/utils.py#L147-L186)

| Dimension properties | Kind | Encoder | Output size |
| --- | --- | --- | --- |
| `(NONE, TRANSLATIONAL_EQUIVARIANCE, TRANSLATIONAL_EQUIVARIANCE)` or three `UNSPECIFIED` | visual | visual encoder chosen by `vis_encode_type` | `hidden_units` |
| `(NONE,)` or `(UNSPECIFIED,)` | vector | `VectorInput` (optional normalizer) | the vector length |
| `(VARIABLE_SIZE, NONE)` | variable length | `EntityEmbedding` | 0 (handled by attention) |
| anything else | | raises `UnityTrainerException` | |

Sources: [ml-agents/mlagents/trainers/torch_entities/utils.py:23-51](repo://ml-agents/mlagents/trainers/torch_entities/utils.py#L23-L51), [ml-agents/mlagents/trainers/torch_entities/utils.py:147-186](repo://ml-agents/mlagents/trainers/torch_entities/utils.py#L147-L186)

`create_input_processors` builds the list of encoders and their output sizes. If there is at least one fixed-size encoding, every `EntityEmbedding` is told to also take that "self" encoding as input, so entities are embedded relative to the agent.

Sources: [ml-agents/mlagents/trainers/torch_entities/utils.py:188-227](repo://ml-agents/mlagents/trainers/torch_entities/utils.py#L188-L227)

## Vector observations and normalization

`VectorInput` passes vectors through unchanged unless `normalize` is set, in which case a `Normalizer` keeps a running mean and variance (as buffers, so they are saved with the model) and outputs `(x - mean) / sqrt(variance / steps)` clamped to `[-5, 5]`. The statistics are updated with every trajectory the trainer processes, using a batched form of Welford's algorithm, and other networks can copy them so critics and Q networks see the same scale as the actor.

Sources: [ml-agents/mlagents/trainers/torch_entities/encoders.py:7-46](repo://ml-agents/mlagents/trainers/torch_entities/encoders.py#L7-L46), [ml-agents/mlagents/trainers/torch_entities/encoders.py:91-110](repo://ml-agents/mlagents/trainers/torch_entities/encoders.py#L91-L110), [ml-agents/mlagents/trainers/torch_entities/networks.py:86-96](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L86-L96)

Because the normalizer is part of the actor, it is exported to ONNX and applied in Unity too ([[Model Saving and ONNX Export]]).

Sources: [ml-agents/mlagents/trainers/torch_entities/model_serialization.py:154-173](repo://ml-agents/mlagents/trainers/torch_entities/model_serialization.py#L154-L173)

## Visual encoders

`vis_encode_type` selects the visual encoder for all image-like observations of a behavior. Each takes `(channels, height, width)` input and ends in a dense layer of `hidden_units` outputs.

Sources: [ml-agents/mlagents/trainers/torch_entities/utils.py:125-133](repo://ml-agents/mlagents/trainers/torch_entities/utils.py#L125-L133)

| `vis_encode_type` | Class | Layers | Minimum side |
| --- | --- | --- | --- |
| `simple` (default) | `SimpleVisualEncoder` | conv 8x8 stride 4 (16), conv 4x4 stride 2 (32), dense | 20 |
| `nature_cnn` | `NatureVisualEncoder` | conv 8x8/4 (32), 4x4/2 (64), 3x3/1 (64), dense | 36 |
| `resnet` | `ResNetVisualEncoder` | three stacks of conv, 3x3 max-pool and two residual blocks (16, 32, 32 channels), Swish, dense | 15 |
| `match3` | `SmallVisualEncoder` | conv 3x3/1 (35), conv 3x3/1 (144), dense; for small boards | 5 |
| `fully_connected` | `FullyConnectedVisualEncoder` | flatten and one dense layer | 1 |

Sources: [ml-agents/mlagents/trainers/torch_entities/encoders.py:112-170](repo://ml-agents/mlagents/trainers/torch_entities/encoders.py#L112-L170), [ml-agents/mlagents/trainers/torch_entities/encoders.py:171-236](repo://ml-agents/mlagents/trainers/torch_entities/encoders.py#L171-L236), [ml-agents/mlagents/trainers/torch_entities/encoders.py:238-286](repo://ml-agents/mlagents/trainers/torch_entities/encoders.py#L238-L286), [ml-agents/mlagents/trainers/torch_entities/utils.py:23-32](repo://ml-agents/mlagents/trainers/torch_entities/utils.py#L23-L32)

A visual observation smaller than the encoder's minimum side raises `UnityTrainerException` naming the resolution and the encoder, which typically happens with a small grid sensor and the default encoder; `match3` or `fully_connected` accept small inputs.

Sources: [ml-agents/mlagents/trainers/torch_entities/utils.py:135-145](repo://ml-agents/mlagents/trainers/torch_entities/utils.py#L135-L145)

## Variable-length observations and attention

### Entity embedding

A buffer sensor observation is a padded `(max_entities, entity_size)` block in which unused rows are zero ([[Built-in Sensors]]). `EntityEmbedding` encodes each row with a one-layer linear encoder, first concatenating the agent's own encoding to every row when a self embedding was added. It needs the maximum entity count to be known for ONNX export, and raises during export otherwise.

Sources: [ml-agents/mlagents/trainers/torch_entities/attention.py:104-171](repo://ml-agents/mlagents/trainers/torch_entities/attention.py#L104-L171)

### Masking

`get_zero_entities_mask` marks a row as padding when the sum of its squares is below 0.01, so the attention ignores empty slots. POCA's multi-agent body builds the same kind of mask from `NaN` padding instead ([[POCA Multi-Agent Trainer]]).

Sources: [ml-agents/mlagents/trainers/torch_entities/attention.py:14-25](repo://ml-agents/mlagents/trainers/torch_entities/attention.py#L14-L25), [ml-agents/mlagents/trainers/torch_entities/networks.py:328-341](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L328-L341)

### Residual self-attention

`ResidualSelfAttention` layer-normalizes the embedded entities, projects them to queries, keys and values, applies multi-head attention (4 heads) with masked keys pushed to a large negative score, adds a residual connection through an output projection, normalizes again and average-pools over the non-masked entities. The result is one vector of the attention embedding size (128 in `ObservationEncoder`) regardless of how many entities were present.

Sources: [ml-agents/mlagents/trainers/torch_entities/attention.py:174-265](repo://ml-agents/mlagents/trainers/torch_entities/attention.py#L174-L265), [ml-agents/mlagents/trainers/torch_entities/networks.py:33-63](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L33-L63)

`MultiHeadAttention` is implemented by hand rather than with PyTorch's module, because Sentis does not support some operators the built-in version uses; it even splits a permutation in two so ONNX does not fuse it into a form Sentis rejects.

Sources: [ml-agents/mlagents/trainers/torch_entities/attention.py:28-101](repo://ml-agents/mlagents/trainers/torch_entities/attention.py#L28-L101)

`create_residual_self_attention` creates the attention block only when there are variable-length inputs, sized for the sum of their maximum entity counts, plus a linear "self" encoder for the fixed-size encodings.

Sources: [ml-agents/mlagents/trainers/torch_entities/utils.py:367-398](repo://ml-agents/mlagents/trainers/torch_entities/utils.py#L367-L398)

## The ObservationEncoder forward pass

`ObservationEncoder.forward` runs every fixed-size encoder and concatenates the results as the self encoding. If there are variable-length inputs, it builds their masks, encodes the self encoding with the self encoder, embeds each entity list relative to it, concatenates all entities, runs the attention block and appends the pooled result. Its total output size is the sum of fixed encodings plus 128 when attention is used. An agent with no usable observation raises an error that asks for at least one sensor.

Sources: [ml-agents/mlagents/trainers/torch_entities/networks.py:98-144](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L98-L144), [ml-agents/mlagents/trainers/torch_entities/networks.py:55-63](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L55-L63)

## Goal conditioning

Observations of type `GOAL_SIGNAL` are recorded by the encoder, and `get_goal_encoding` encodes them separately (variable-length goals are not supported). When a behavior has goal observations and `goal_conditioning_type` is `hyper`, `NetworkBody` uses a `ConditionalEncoder` instead of a plain `LinearEncoder`; with `none`, goals are just another input.

Sources: [ml-agents/mlagents/trainers/torch_entities/networks.py:65-70](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L65-L70), [ml-agents/mlagents/trainers/torch_entities/networks.py:146-170](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L146-L170), [ml-agents/mlagents/trainers/torch_entities/networks.py:199-213](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L199-L213)

`ConditionalEncoder` is a stack of `num_layers` layers with Swish activations in which the last layer's weights are generated by a `HyperNetwork` from the goal encoding. The hypernetwork is a two-layer network, layer-normalized, that outputs a full `input_size x output_size` weight matrix per sample (the bias is a normal parameter), so the goal changes how the observation is processed rather than only adding to it.

Sources: [ml-agents/mlagents/trainers/torch_entities/conditioning.py:13-71](repo://ml-agents/mlagents/trainers/torch_entities/conditioning.py#L13-L71), [ml-agents/mlagents/trainers/torch_entities/conditioning.py:74-133](repo://ml-agents/mlagents/trainers/torch_entities/conditioning.py#L74-L133)

## Layer helpers

| Helper | Purpose |
| --- | --- |
| `linear_layer(in, out, kernel_init, kernel_gain, bias_init)` | `nn.Linear` with a chosen initialization (Xavier, Kaiming, normal, zero) scaled by a gain |
| `LinearEncoder` | `num_layers` linear layers each followed by Swish |
| `Swish` | `x * sigmoid(x)` activation |
| `LayerNorm` | layer normalization without learned scale and shift |
| `LSTM` | single-layer LSTM whose memory vector holds hidden and cell states (`memory_size / 2` each), with transposes during ONNX export |

Sources: [ml-agents/mlagents/trainers/torch_entities/layers.py:8-60](repo://ml-agents/mlagents/trainers/torch_entities/layers.py#L8-L60), [ml-agents/mlagents/trainers/torch_entities/layers.py:119-225](repo://ml-agents/mlagents/trainers/torch_entities/layers.py#L119-L225)
