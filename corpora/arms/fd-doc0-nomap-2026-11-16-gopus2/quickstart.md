---
title: "Quickstart"
---
## Overview

This page builds `fd` from this repository, installs it with its shell completions and man page, and runs a few first searches. fd is a Rust 2024-edition crate that needs Rust 1.90.0 or later; what each option means is explained in [[Command-Line Parsing and Configuration]].

Sources: [Cargo.toml:15-21](repo://Cargo.toml#L15-L21), [README.md:720-728](repo://README.md#L720-L728)

## Build and test

Cargo builds the single `fd` binary declared in `Cargo.toml`; `cargo test` runs the unit tests inside the modules and the integration tests in `tests/` (see [[Testing and CI]]).

Sources: [Cargo.toml:29-31](repo://Cargo.toml#L29-L31), [README.md:742-744](repo://README.md#L742-L744)

```bash
cargo build
cargo test
cargo install --path .
```

Sources: [README.md:734-747](repo://README.md#L734-L747), [Cargo.toml:29-31](repo://Cargo.toml#L29-L31)

The release profile turns on link-time optimisation, strips the binary and uses a single codegen unit. A `debugging` profile inherits from `dev` with full debug info, for when the default line-tables-only debug info is not enough.

Sources: [Cargo.toml:85-98](repo://Cargo.toml#L85-L98)

On Windows MSVC targets, `.cargo/config.toml` links the C runtime statically so that `fd.exe` does not depend on the vcruntime DLL.

Sources: [.cargo/config.toml:1-9](repo://.cargo/config.toml#L1-L9)

## Cargo features

| Feature | Enables | Default |
| --- | --- | --- |
| `completions` | the `clap_complete` dependency and the hidden `--gen-completions` flag | yes |
| `use-jemalloc` | the `tikv-jemallocator` global allocator, on the targets that support it | no |
| `base` | `use-jemalloc` | no |

Sources: [Cargo.toml:100-104](repo://Cargo.toml#L100-L104), [src/main.rs:42-54](repo://src/main.rs#L42-L54)

## Install with make

The `Makefile` builds with `cargo build --profile release --locked`, then `make install` copies the binary to `$(prefix)/bin` (default `/usr/local`), the bash, fish and zsh completions to their usual `share` folders, and `doc/fd.1` as the man page. `DESTDIR` is prepended to every destination, for packaging.

Sources: [Makefile:1-9](repo://Makefile#L1-L9), [Makefile:44-52](repo://Makefile#L44-L52)

```bash
make
sudo make install
```

Sources: [Makefile:44-52](repo://Makefile#L44-L52)

`make completions` writes the generated `fd.bash`, `fd.fish` and `_fd.ps1` into `autocomplete/` by running the built binary with `--gen-completions`, and copies the hand-written zsh completion `_fd` and the `fdfind` variants from `contrib/completion/`.

Sources: [Makefile:11-42](repo://Makefile#L11-L42)

## Generate completions

`--gen-completions` takes a shell name, or reads it from the environment when none is given, and is `exclusive`, so it cannot be combined with other arguments. `run` checks it before anything else and prints the script; the program name in the script is the file stem of the binary that was run, so a binary installed as `fdfind` gets completions for `fdfind`.

Sources: [src/cli.rs:690-692](repo://src/cli.rs#L690-L692), [src/cli.rs:775-785](repo://src/cli.rs#L775-L785), [src/main.rs:75-129](repo://src/main.rs#L75-L129)

```bash
fd --gen-completions bash > ~/.local/share/bash-completion/completions/fd
fd --gen-completions zsh > ~/.zfunc/_fd
fd --gen-completions fish > ~/.config/fish/completions/fd.fish
```

Sources: [README.md:762-778](repo://README.md#L762-L778)

## First searches

With one argument, fd searches the current directory recursively for entries whose name contains a match of the pattern. A second argument names the directory to search, and no argument lists everything.

Sources: [README.md:40-95](repo://README.md#L40-L95)

```bash
fd netfl              # names matching the regex "netfl"
fd '^x.*rc$' /etc     # anchored regex, searched under /etc
fd -e md              # all Markdown files
fd -g libc.so /usr    # glob instead of regex
fd -H pre-commit      # include hidden files
fd -u num_cpu         # include hidden and ignored files
```

Sources: [README.md:40-123](repo://README.md#L40-L123), [README.md:124-143](repo://README.md#L124-L143)

> [!TIP]
> If fd seems not to find a file, it is usually hidden or ignored by a `.gitignore`: `-u` searches everything. A pattern holding `/` matches nothing without `--full-path`, so fd stops with an error that suggests `fd . 'dir'` or `fd --full-path` instead ([[Pattern Matching]]).

Sources: [README.md:394-407](repo://README.md#L394-L407), [src/main.rs:185-216](repo://src/main.rs#L185-L216)

## Next steps

Follow a search through the code starting at [[Command-Line Parsing and Configuration]], or jump to [[Command Execution]] for `-x` and `-X`, and to [[Printing Results]] for colors and `--format`.

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112)
