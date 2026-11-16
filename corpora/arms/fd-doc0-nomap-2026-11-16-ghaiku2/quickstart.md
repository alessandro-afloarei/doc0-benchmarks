---
title: "Quickstart"
---
## Overview

*fd* takes a pattern and an optional directory, and prints the entries under that directory whose names match. Without a pattern it lists everything below the directory. Each option below maps to a field of the configuration described in [[Command-Line Options and Config]].

Sources: [README.md:40-50](repo://README.md#L40-L50), [src/cli.rs:639-640](repo://src/cli.rs#L639-L640)

## Find by name

The pattern is a regular expression matched against each file name. A single positional argument searches the current directory recursively, and a second argument names the root directory:

Sources: [README.md:40-50](repo://README.md#L40-L50), [README.md:65-73](repo://README.md#L65-L73)

```bash
fd netfl
fd passwd /etc
```

Sources: [README.md:40-50](repo://README.md#L40-L50), [README.md:65-73](repo://README.md#L65-L73)

With no pattern, a catch-all such as `.` lists every entry, so the same pattern lists a whole directory's content.

Sources: [README.md:75-94](repo://README.md#L75-L94)

## Filter by extension and type

`-e` (`--extension`) keeps only entries with the given extension, and it combines with a pattern. `-g` (`--glob`) turns the pattern into a glob that must match the whole name:

Sources: [README.md:96-122](repo://README.md#L96-L122), [src/cli.rs:390-394](repo://src/cli.rs#L390-L394), [src/cli.rs:159-161](repo://src/cli.rs#L159-L161)

```bash
fd -e md
fd -e rs mod
fd -g 'libc.so' /usr
```

Sources: [README.md:96-122](repo://README.md#L96-L122), [src/cli.rs:390-394](repo://src/cli.rs#L390-L394), [src/cli.rs:159-161](repo://src/cli.rs#L159-L161)

The entry type is selected with `--type`, and the [[Filters]] page describes the types and the other metadata predicates.

Sources: [src/cli.rs:376-378](repo://src/cli.rs#L376-L378)

## Include hidden and ignored entries

By default, hidden entries and entries matched by `.gitignore` or `.fdignore` are skipped. `-H` (`--hidden`) searches hidden entries, `-I` (`--no-ignore`) turns off the ignore files, and `-u` (`--unrestricted`) combines both:

Sources: [README.md:124-143](repo://README.md#L124-L143), [src/cli.rs:40-46](repo://src/cli.rs#L40-L46), [src/cli.rs:56-60](repo://src/cli.rs#L56-L60), [src/cli.rs:122-124](repo://src/cli.rs#L122-L124)

```bash
fd -H pre-commit
fd -I num_cpu
fd -u -g '**/.git/config'
```

Sources: [README.md:124-143](repo://README.md#L124-L143), [src/cli.rs:40-46](repo://src/cli.rs#L40-L46), [src/cli.rs:56-60](repo://src/cli.rs#L56-L60), [src/cli.rs:122-124](repo://src/cli.rs#L122-L124)

## Match the full path

`-p` (`--full-path`) matches the pattern against the absolute path rather than the file name, so a pattern can contain directory parts:

Sources: [README.md:145-152](repo://README.md#L145-L152), [src/cli.rs:262-264](repo://src/cli.rs#L262-L264)

```bash
fd -p '.*/lesson-\d+/[a-z]+.(jpg|png)'
```

Sources: [README.md:145-152](repo://README.md#L145-L152), [src/cli.rs:262-264](repo://src/cli.rs#L262-L264)

## Run a command on each result

`--exec` (`-x`) runs a command for each result, and `--exec-batch` (`-X`) runs it once with all results. `--list-details` (`-l`) prints the long listing. The three options form one group, so only one may be given.

Sources: [src/cli.rs:27-31](repo://src/cli.rs#L27-L31), [src/cli.rs:884-890](repo://src/cli.rs#L884-L890), [src/cli.rs:922-930](repo://src/cli.rs#L922-L930), [src/cli.rs:233-234](repo://src/cli.rs#L233-L234)

The placeholders in the command are described in [[Exec Templates]], and the way the commands run is described in [[Running Commands]].

Sources: [README.md:154-160](repo://README.md#L154-L160)
