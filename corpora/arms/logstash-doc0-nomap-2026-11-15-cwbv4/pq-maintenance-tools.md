---
title: "Persistent Queue Maintenance Tools"
---
## Overview

A persisted queue directory is plain files: `page.N` data files, `checkpoint.N` and `checkpoint.head` checkpoints, a lock and a version marker ([[Persistent Queue]]). When a disk fills up, a host crashes mid-write, or someone copies a queue between machines, those files can disagree with each other and the queue refuses to open. Logstash ships three offline tools for this situation, plus one upgrade step that runs automatically at queue open. All of them must run while Logstash is stopped, because the queue holds an exclusive lock on its directory.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/Queue.java:173-198](repo://logstash-core/src/main/java/org/logstash/ackedqueue/Queue.java#L173-L198)

| Tool | Launcher | Changes files | Use it to |
| --- | --- | --- | --- |
| `pqcheck` | `bin/pqcheck [dir]` | No | List every checkpoint and whether its page is fully acknowledged |
| `pqrepair` | `bin/pqrepair dir` | Yes | Bring checkpoints and pages back into agreement so the queue opens |
| `cpdump` | `bin/cpdump checkpoint-file` | No | Print one checkpoint file |
| Queue upgrade | automatic on open | Yes | Convert a V1 queue to the V2 page format |

Sources: [bin/pqcheck:1-35](repo://bin/pqcheck#L1-L35), [bin/pqrepair:1-35](repo://bin/pqrepair#L1-L35), [bin/cpdump:1-11](repo://bin/cpdump#L1-L11), [logstash-core/src/main/java/org/logstash/ackedqueue/Queue.java:200-204](repo://logstash-core/src/main/java/org/logstash/ackedqueue/Queue.java#L200-L204)

## pqcheck

`bin/pqcheck` sources the usual launcher library to find Java, builds a classpath from `logstash-core/lib/jars`, and runs `org.logstash.ackedqueue.PqCheck`. With no argument it checks `data/queue/main` relative to the current directory; `-h` prints usage.

Sources: [bin/pqcheck:20-35](repo://bin/pqcheck#L20-L35), [logstash-core/src/main/java/org/logstash/ackedqueue/PqCheck.java:36-56](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqCheck.java#L36-L56)

It lists the files matching `checkpoint.{[0-9]*,head}`, sorted by page number with `checkpoint.head` last. For each, it requires the exact checkpoint size (34 bytes) and fails with "invalid size" otherwise. A valid checkpoint prints one line with whether it is fully acknowledged and the size of its `page.N` (or `NOT FOUND`), followed by the checkpoint's fields.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/PqCheck.java:58-103](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqCheck.java#L58-L103)

```text
checkpoint.3, fully-acked: NO, page.3 size: 67108864
pageNum=3, firstUnackedPageNum=0, firstUnackedSeqNum=150213, minSeqNum=148990, elementCount=4211, isFullyAcked=no
```

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/PqCheck.java:80-87](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqCheck.java#L80-L87), [logstash-core/src/main/java/org/logstash/ackedqueue/Checkpoint.java:78-80](repo://logstash-core/src/main/java/org/logstash/ackedqueue/Checkpoint.java#L78-L80)

## pqrepair

`bin/pqrepair <dir>` runs `PqRepair.repair`. It throws when no directory is given or the path is not a directory, and logs each action at info level. It runs five steps in a fixed order.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java:43-131](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java#L43-L131), [logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java:191-230](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java#L191-L230)

1. Delete leftover `checkpoint.*.tmp` files from an interrupted checkpoint write.
2. Read `firstUnackedPageNum` from `checkpoint.head` and delete every page and checkpoint numbered below it: they are fully acknowledged.
3. Delete each checkpoint whose page file is missing.
4. Delete each page file smaller than the minimum size that can hold one element, together with its checkpoint.
5. For every page except the newest, recreate a checkpoint that is missing or has the wrong size.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java:43-131](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java#L43-L131), [logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java:191-230](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java#L191-L230)

To recreate a checkpoint, `recreateCheckpoint` checks the page's version byte (1 or 2 are accepted), reads the first element's sequence number, then walks the length fields to count elements. It writes a checkpoint with that page number, the first sequence number as both minimum and first unacknowledged, and the counted elements. The rebuilt checkpoint treats the whole page as unacknowledged, so its events are delivered again when Logstash starts.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java:133-189](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java#L133-L189)

> [!WARNING]
> `pqrepair` deletes files. Pages it removes as too small or as orphans are lost, and recreated checkpoints replay their whole page. Copy the queue directory before running it.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java:191-230](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java#L191-L230)

The newest page is skipped in step 5 because it is the head page, which `checkpoint.head` describes. At the next open, `Queue.openPages` recovers the head page by scanning its elements and checksums, so a damaged head checkpoint is corrected there rather than by the tool.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java:133-147](repo://logstash-core/src/main/java/org/logstash/ackedqueue/PqRepair.java#L133-L147), [logstash-core/src/main/java/org/logstash/ackedqueue/Queue.java:263-284](repo://logstash-core/src/main/java/org/logstash/ackedqueue/Queue.java#L263-L284)

## cpdump

`bin/cpdump` is a Ruby script run with `bin/ruby`. It loads the Logstash environment and settings, opens a `FileCheckpointIO` on the default `path.queue` and prints the checkpoint named by its argument. Because it uses the default settings and does not read `logstash.yml`, the file name is resolved against the default queue path.

Sources: [bin/cpdump:1-11](repo://bin/cpdump#L1-L11)

## Queue format upgrade

Page files carry a format version byte, and the current format is V2. Every time a queue opens, `QueueUpgrade.upgradeQueueDirectoryToV2` runs first and checks for a version marker.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/QueueUpgrade.java:44-132](repo://logstash-core/src/main/java/org/logstash/ackedqueue/QueueUpgrade.java#L44-L132)

- If `.queue-version` exists, it must contain the integer 2, otherwise opening fails with "Unexpected upgrade file contents found".
- If it is missing, every `page.N` is validated as V1: its checkpoint (`checkpoint.N`, or `checkpoint.head` for the head page) gives the element count, and every element must deserialize as an event. Then the first byte of each page is rewritten to 2 and `.queue-version` is written.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/QueueUpgrade.java:44-132](repo://logstash-core/src/main/java/org/logstash/ackedqueue/QueueUpgrade.java#L44-L132)

If any V1 event fails to deserialize, the upgrade stops before changing a page and logs that the queue cannot be upgraded: either downgrade and drain the queue with the older version, or delete the queue directory if its data is not needed.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/QueueUpgrade.java:100-140](repo://logstash-core/src/main/java/org/logstash/ackedqueue/QueueUpgrade.java#L100-L140)
