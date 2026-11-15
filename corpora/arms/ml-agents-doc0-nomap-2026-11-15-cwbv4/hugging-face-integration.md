---
title: "Hugging Face Integration"
---
## Overview

Two commands connect training runs to the Hugging Face Hub. `mlagents-push-to-hf` uploads a run's results folder, with an ONNX model and its configuration, to a model repository and writes a model card for it; `mlagents-load-from-hf` downloads such a repository. Both are `console_scripts` of the `mlagents` package and use the `huggingface_hub` library, which `mlagents` depends on. Authentication follows that library: the user logs in with the Hugging Face CLI or token beforehand.

Sources: [ml-agents/setup.py:55-85](repo://ml-agents/setup.py#L55-L85), [ml-agents/mlagents/utils/push_to_hf.py:1-18](repo://ml-agents/mlagents/utils/push_to_hf.py#L1-L18), [ml-agents/mlagents/utils/load_from_hf.py:1-10](repo://ml-agents/mlagents/utils/load_from_hf.py#L1-L10)

What a results folder contains is described on [[Model Saving and ONNX Export]] and [[mlagents-learn CLI and Run Lifecycle]].

Sources: [ml-agents/mlagents/trainers/learn.py:146-157](repo://ml-agents/mlagents/trainers/learn.py#L146-L157)

## Pushing a run

```bash
mlagents-push-to-hf --run-id=<run-id> --local-dir=./results/<run-id> --repo-id=<user>/<repo> --commit-message="First push"
```

Sources: [ml-agents/mlagents/utils/push_to_hf.py:179-211](repo://ml-agents/mlagents/utils/push_to_hf.py#L179-L211)

| Flag | Default | Meaning |
| --- | --- | --- |
| `--run-id` | none | Name of the run, used in log messages |
| `--local-dir` | `./` | Folder to upload, normally `results/<run-id>` |
| `--repo-id` | none | Hub repository, `<namespace>/<name>` |
| `--commit-message` | `Push to Hub` | Commit message of the upload |
| `--configfile-name` | `configuration.yaml` | YAML configuration inside the folder |

Sources: [ml-agents/mlagents/utils/push_to_hf.py:179-202](repo://ml-agents/mlagents/utils/push_to_hf.py#L179-L202)

`package_to_hub` performs four steps:

Sources: [ml-agents/mlagents/utils/push_to_hf.py:124-176](repo://ml-agents/mlagents/utils/push_to_hf.py#L124-L176)

1. Create the repository with `HfApi().create_repo(repo_id, exist_ok=True)`, so pushing again to an existing repository is allowed.
2. Convert the configuration YAML into a `config.json` in the same folder.
3. Generate a model card and write it as `README.md`, with its metadata in the card header.
4. Upload the whole folder with `upload_folder` and log the repository URL.

Sources: [ml-agents/mlagents/utils/push_to_hf.py:146-176](repo://ml-agents/mlagents/utils/push_to_hf.py#L146-L176), [ml-agents/mlagents/utils/push_to_hf.py:21-32](repo://ml-agents/mlagents/utils/push_to_hf.py#L21-L32)

Because the whole folder is uploaded, the repository receives the checkpoints, the final ONNX model, TensorBoard event files and run logs as well as the generated files.

Sources: [ml-agents/mlagents/utils/push_to_hf.py:169-172](repo://ml-agents/mlagents/utils/push_to_hf.py#L169-L172)

## The model card

The card is built from `config.json`: the first behavior name is taken as the environment id and its `trainer_type` as the model name. The metadata sets `library_name` to `ml-agents` and the tags `<env_id>`, `deep-reinforcement-learning`, `reinforcement-learning` and `ML-Agents-<env_id>`, so the model is listed under the ML-Agents library on the Hub. The card text titles the model "<trainer> Agent playing <env>", links the documentation and Hugging Face tutorials, shows how to resume training with `mlagents-learn ... --resume`, and explains how to watch the agent in the browser for official environments.

Sources: [ml-agents/mlagents/utils/push_to_hf.py:35-121](repo://ml-agents/mlagents/utils/push_to_hf.py#L35-L121)

> [!NOTE]
> Only the first behavior in the configuration names the card. A multi-behavior run is uploaded completely, but its card mentions one behavior.

Sources: [ml-agents/mlagents/utils/push_to_hf.py:64-70](repo://ml-agents/mlagents/utils/push_to_hf.py#L64-L70)

## Loading a model

```bash
mlagents-load-from-hf --repo-id=<user>/<repo> --local-dir=./downloads
```

Sources: [ml-agents/mlagents/utils/load_from_hf.py:28-44](repo://ml-agents/mlagents/utils/load_from_hf.py#L28-L44)

`load_from_hf` downloads a snapshot of the repository with `snapshot_download` into `<local-dir>/<repo-name>` and logs where it went. The downloaded folder has the layout of a results folder, so its ONNX model can be dropped into a Unity project ([[Inference with Sentis]]), and its checkpoint can be used with `--initialize-from` or, after copying into `results/`, with `--resume`.

Sources: [ml-agents/mlagents/utils/load_from_hf.py:13-25](repo://ml-agents/mlagents/utils/load_from_hf.py#L13-L25), [ml-agents/mlagents/trainers/directory_utils.py:48-76](repo://ml-agents/mlagents/trainers/directory_utils.py#L48-L76)
