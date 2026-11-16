---
title: "Quickstart"
---
## Overview

This page installs fd and runs the searches most people need on day one. For what each flag does inside fd, see [[Command-Line Options]].

Sources: [README.md:34-38](repo://README.md#L34-L38)

## Install

### From a package manager

Most systems package fd. A few common ones:

Sources: [README.md:538-546](repo://README.md#L538-L546)

```bash
brew install fd          # macOS (Homebrew)
apt install fd-find      # Ubuntu 19.04+ and Debian Buster+
dnf install fd-find      # Fedora 28+
pacman -S fd             # Arch Linux
scoop install fd         # Windows (Scoop)
winget install sharkdp.fd
```

Sources: [README.md:542-598](repo://README.md#L542-L598), [README.md:646-675](repo://README.md#L646-L675)

> [!NOTE]
> On Debian and Ubuntu the binary is called `fdfind`, because another package already uses the name `fd`. Link it with `ln -s $(which fdfind) ~/.local/bin/fd` and make sure `~/.local/bin` is on your `PATH`.

Sources: [README.md:550-553](repo://README.md#L550-L553)

### From source

Install with cargo. Rust 1.90.0 or later is required.

Sources: [README.md:720-728](repo://README.md#L720-L728)

```bash
cargo install fd-find
```

Sources: [README.md:722-725](repo://README.md#L722-L725), [Cargo.toml:19-20](repo://Cargo.toml#L19-L20)

To work on a clone, build and test with cargo, or use `make install` to build the release binary and install it along with completions and the man page under `/usr/local`.

Sources: [Makefile:1-52](repo://Makefile#L1-L52)

```bash
git clone https://github.com/sharkdp/fd
cd fd
cargo build
cargo test
cargo install --path .
```

Sources: [README.md:734-747](repo://README.md#L734-L747)

## First searches

1. Search the current directory recursively for entries whose name contains a pattern: `fd netfl`.
2. Use a regular expression: `fd '^x.*rc$'`.
3. Search another directory by giving it as the second argument: `fd passwd /etc`.
4. List everything below a directory with a match-all pattern: `fd . some/dir`.
5. Filter by extension: `fd -e md`, or combine with a pattern: `fd -e rs mod`.
6. Match an exact file name with a glob: `fd -g libc.so /usr`.
7. Include hidden files with `-H`, ignored files with `-I`, or both with `-u`.
8. Match against the full path instead of the name: `fd -p '.*/lesson-\d+/[a-z]+.(jpg|png)'`.

Sources: [README.md:40-152](repo://README.md#L40-L152)

> [!TIP]
> A pattern that contains `/` is refused unless `--full-path` is set, because fd matches names, not paths. To list a directory, write `fd . 'that/dir'`.

Sources: [src/main.rs:169-216](repo://src/main.rs#L169-L216)

## Run commands on results

`-x` runs a command once per result, in parallel; `-X` runs it once with all results as arguments. Placeholders such as `{}` and `{.}` stand for the path; see [[Placeholder Templates]].

Sources: [README.md:154-160](repo://README.md#L154-L160), [README.md:227-236](repo://README.md#L227-L236)

```bash
fd -e zip -x unzip                     # one unzip per archive
fd -e jpg -x convert {} {.}.png        # convert each JPEG to PNG
fd -g 'test_*.py' -X vim               # open all matches in one vim
fd -H '^\.DS_Store$' -tf -X rm         # delete matching files
```

Sources: [README.md:154-217](repo://README.md#L154-L217), [README.md:281-293](repo://README.md#L281-L293)

Put `-x` or `-X` last: every argument after it belongs to the command, unless you end the command with `\;`. [[Command Execution]] explains how the commands are run.

Sources: [README.md:179-183](repo://README.md#L179-L183), [README.md:219-236](repo://README.md#L219-L236)

## Exclude entries

`-E` takes a glob and drops matching entries: `fd -H -E .git`. To make an exclusion permanent, put it in a `.fdignore` file, which works like `.gitignore`, or in the global ignore file at `~/.config/fd/ignore` (`%APPDATA%\fd\ignore` on Windows).

Sources: [README.md:243-279](repo://README.md#L243-L279)

## Shell completions

Release archives ship completions in their `autocomplete` directory. fd can also generate them:

Sources: [README.md:749-764](repo://README.md#L749-L764)

```bash
fd --gen-completions bash > ~/.local/share/bash-completion/completions/fd
fd --gen-completions zsh > ~/.zfunc/_fd
fd --gen-completions fish > ~/.config/fish/completions/fd.fish
```

Sources: [README.md:766-778](repo://README.md#L766-L778)
