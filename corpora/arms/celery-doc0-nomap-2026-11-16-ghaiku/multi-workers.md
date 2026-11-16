---
title: "Multi Workers"
---
## Overview

`celery multi` starts, stops, restarts and inspects several worker processes from one command line. It does not run any task itself. It turns each node name and its options into a `celery worker` command line, starts those commands as child processes, and keeps track of their pid and log files. The command is `MultiTool` in `celery/bin/multi.py`, the node and cluster logic is in `celery/apps/multi.py`, and each started child is an ordinary worker as described in [[Worker Startup and Bootsteps]].

Sources: [celery/bin/multi.py:226-262](repo://celery/bin/multi.py#L226-L262), [celery/apps/multi.py:122-135](repo://celery/apps/multi.py#L122-L135)

## Node names

`build_nodename` returns the short name, the full node name and the host for a name such as `w1` or `w1@host`. A name with an `@` keeps its host. Otherwise the prefix is added to the short name and the suffix is used as the host, and the host format is expanded in either case.

Sources: [celery/apps/multi.py:28-40](repo://celery/apps/multi.py#L28-L40)

`build_expander` returns the function that replaces the placeholders in the command template with the parts of the node name, so one template can be used for every node.

Sources: [celery/apps/multi.py:42-53](repo://celery/apps/multi.py#L42-L53)

## Options per node

`NamespacedOptionParser` parses the arguments after the node name. An option written with a namespace prefix applies only to the nodes in that namespace, and the parser merges the namespaced options over the shared ones.

Sources: [celery/apps/multi.py:70-121](repo://celery/apps/multi.py#L70-L121)

`MultiParser.parse` turns the parsed options into a `Node` for each name. Ranges such as `w[1-3]` expand to several names before any node is created, so a single argument can start a group of workers.

Sources: [celery/apps/multi.py:285-366](repo://celery/apps/multi.py#L285-L366)

## Building the command line

`Node` builds its argv in `_prepare_argv`. It finds `celery` in the command template, moves the connection options from the node's options to the front of the command, and then appends the other options as `--name value` pairs and the extra arguments.

Sources: [celery/apps/multi.py:161-190](repo://celery/apps/multi.py#L161-L190)

```python
cmd = self.expander(self.cmd).split(' ')
i = cmd.index('celery') + 1
```

Sources: [celery/apps/multi.py:161-164](repo://celery/apps/multi.py#L161-L164), [celery/apps/multi.py:165-190](repo://celery/apps/multi.py#L165-L190)

The connection options that `_prepare_argv` moves are `-A`, `-b`, `--result-backend`, `--loader`, `--config`, `--workdir`, `--no-color` and `--quiet`. They go before the subcommand, because the top-level `celery` group reads them, and the worker reads the rest.

Sources: [celery/apps/multi.py:166-180](repo://celery/apps/multi.py#L166-L180), [celery/bin/celery.py:57-106](repo://celery/bin/celery.py#L57-L106)

## Starting and waiting

`Node.start` runs the argv with `_waitexec`, which spawns the child and waits for it. `Cluster.start` starts each node in turn through `start_node`, and it calls the `on_node_start` and `on_node_status` callbacks around each start.

Sources: [celery/apps/multi.py:208-222](repo://celery/apps/multi.py#L208-L222), [celery/apps/multi.py:406-422](repo://celery/apps/multi.py#L406-L422)

`Cluster` is the group of nodes. `send_all` sends a signal to every node, `stop` and `stopwait` stop them with a retry count, and `restart` stops each node and starts it again. `find` looks a node up by its name, and `getpids` returns the pids of the nodes that are still running.

Sources: [celery/apps/multi.py:367-405](repo://celery/apps/multi.py#L367-L405), [celery/apps/multi.py:423-505](repo://celery/apps/multi.py#L423-L505)

## The subcommands

`multi` is a click command with a `MultiTool` method for each action. `start`, `stop`, `stopwait`, `restart`, `names`, `get`, `show`, `kill`, `expand` and `help` each take the cluster built from the arguments and act on it.

Sources: [celery/bin/multi.py:463-480](repo://celery/bin/multi.py#L463-L480), [celery/bin/multi.py:290-341](repo://celery/bin/multi.py#L290-L341)

The signal to send is taken from the arguments by `_find_sig_argument`, which defaults to TERM. The arguments are parsed into nodes by `_nodes_from_argv`.

Sources: [celery/bin/multi.py:344-372](repo://celery/bin/multi.py#L344-L372)
