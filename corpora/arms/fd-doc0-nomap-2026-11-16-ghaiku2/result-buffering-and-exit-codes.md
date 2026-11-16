---
title: "Result Buffering and Exit Codes"
---
## Overview

The receiver is the one thread that consumes the walk's results. It takes batches of `WorkerResult` from the channel and decides when each entry is written. For a short search it holds the entries and prints them sorted; for a long one it prints them as they arrive. The same receiver also ends the run, and it produces the exit code that `main` returns.

Sources: [src/walk.rs:130-148](repo://src/walk.rs#L130-L148), [src/walk.rs:408-438](repo://src/walk.rs#L408-L438)

Without `--exec`, `receive` wraps stdout in a `BufWriter` and runs a `ReceiverBuffer` on the receiver thread. With `--exec`, the same channel is handed to the batch runner or to one job thread for each configured thread instead, and the buffering described here does not apply.

Sources: [src/walk.rs:408-438](repo://src/walk.rs#L408-L438), [src/walk.rs:428-436](repo://src/walk.rs#L428-L436)

## Buffering and sorting

`ReceiverBuffer::new` starts in `Buffering` mode with a deadline of now plus the buffer time, which is 100 ms unless `--max-buffer-time` sets it. While buffering, `recv` waits for a batch only until that deadline, and each entry is pushed to a vector.

Sources: [src/walk.rs:153-172](repo://src/walk.rs#L153-L172), [src/walk.rs:184-194](repo://src/walk.rs#L184-L194), [src/walk.rs:125-127](repo://src/walk.rs#L125-L127)

Buffering ends in one of three ways: the deadline passes, the buffer grows past 1000 entries, or the walk finishes first. A timeout or an overfull buffer calls `stream`. A finished walk calls `stop`, which sorts the buffer by path before streaming it, so the output of a fast search is in path order. The sort uses the `Ord` of `DirEntry`, which compares paths.

Sources: [src/walk.rs:198-216](repo://src/walk.rs#L198-L216), [src/walk.rs:269-276](repo://src/walk.rs#L269-L276), [src/walk.rs:281-291](repo://src/walk.rs#L281-L291)

## Streaming

`stream` switches the mode to `Streaming`, prints the buffered entries in the order they were collected, and flushes. In `Streaming` mode `recv` waits without a deadline, and each entry is printed as it arrives. Output is flushed only when no further batch is waiting in the channel, so a burst of matches is written in one go and a quiet period is still shown promptly.

Sources: [src/walk.rs:269-276](repo://src/walk.rs#L269-L276), [src/walk.rs:186-193](repo://src/walk.rs#L186-L193), [src/walk.rs:218-224](repo://src/walk.rs#L218-L224)

The printing of a single entry goes through `print`. An interrupt flag set by Ctrl-C is checked after each print, and it stops the run with `KilledBySigint`. A broken pipe is not reported as an error, so `fd | head` ends without an error message.

Sources: [src/walk.rs:251-266](repo://src/walk.rs#L251-L266)

## Stopping early

Two options end the search early. `--max-results` counts the entries printed, and when the count reaches the limit the receiver calls `stop`. `--quiet` returns on the first entry with `HasResults(true)`, without printing anything.

Sources: [src/walk.rs:211-226](repo://src/walk.rs#L211-L226), [src/walk.rs:200-206](repo://src/walk.rs#L200-L206)

Filesystem errors from the walk are not fatal. A `WorkerResult::Error` is printed to standard error only when `--show-errors` is given, and it does not change the exit code.

Sources: [src/walk.rs:231-240](repo://src/walk.rs#L231-L240), [src/config.rs:116-117](repo://src/config.rs#L116-L117), [src/main.rs:386](repo://src/main.rs#L386)

## Exit codes

`ExitCode` has four values. `Success` and `HasResults` are the two non-error outcomes: a normal run exits 0 whether or not it found anything, and `--quiet` exits 0 only when there was a match, and 1 otherwise. `GeneralError` exits 1, and `KilledBySigint` exits 130.

Sources: [src/exit_codes.rs:6-24](repo://src/exit_codes.rs#L6-L24), [src/walk.rs:281-291](repo://src/walk.rs#L281-L291)

`merge_exitcodes` combines several codes, such as the results of several `--exec` jobs. It returns `GeneralError` if any code is an error, and `Success` otherwise. `KilledBySigint` counts as an error. When the process exits with `KilledBySigint`, `exit` resets the SIGINT handler to its default and raises SIGINT again, so that the shell sees the real signal.

Sources: [src/exit_codes.rs:46-50](repo://src/exit_codes.rs#L46-L50), [src/exit_codes.rs:26-47](repo://src/exit_codes.rs#L26-L47)
