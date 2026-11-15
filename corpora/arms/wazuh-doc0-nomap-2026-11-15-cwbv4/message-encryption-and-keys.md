---
title: "Message Encryption and Client Keys"
---
## Overview

Agents and the manager share one symmetric key per agent, stored in `etc/client.keys`. Every message between them, in either direction, is wrapped by the same two functions in `os_crypto/shared/msgs.c`: `CreateSecMSG` adds a random prefix, replay counters and an MD5 checksum, compresses with zlib and encrypts; `ReadSecMSG` reverses it and rejects replays. [[Agent Daemon (agentd)]] and [[Remoted: Agent Connections]] call these functions; [[Agent Enrollment (authd)]] is how a key line gets into the file in the first place.

Sources: [src/headers/defs.h:283-289](repo://src/headers/defs.h#L283-L289), [src/os_crypto/shared/msgs.c:289-300](repo://src/os_crypto/shared/msgs.c#L289-L300), [src/os_crypto/shared/msgs.c:537-555](repo://src/os_crypto/shared/msgs.c#L537-L555)

## The key file

### Line format

Each line of `client.keys` is `id name ip key`, separated by single spaces. `OS_ReadKeys` skips lines that start with `#` or a space. A line whose name field starts with `#` or `!` is a removed agent: it still raises the ID counter, so a new agent never reuses the ID, and it is kept in `removed_keys` when the caller asks for it. The `ip` field may be a CIDR network; `OS_AddKey` strips the `/` suffix for the IP index but keeps the network for address checks.

Sources: [src/os_crypto/shared/keys.c:175-260](repo://src/os_crypto/shared/keys.c#L175-L260), [src/os_crypto/shared/keys.c:260-345](repo://src/os_crypto/shared/keys.c#L260-L345), [src/os_crypto/shared/keys.c:80-93](repo://src/os_crypto/shared/keys.c#L80-L93)

### The keystore

The parsed file becomes a `keystore`: an array of `keyentry` plus three red-black trees indexed by ID, by IP, and by TCP socket. The array always has one extra entry at index `keysize` that holds the sender's own counters. Each `keyentry` keeps the agent's raw key, the derived encryption key, its last accepted counters, its socket, its current protocol and crypto method, and a mutex.

Sources: [src/headers/sec.h:26-107](repo://src/headers/sec.h#L26-L107)

The key mode decides what is stored: `W_RAW_KEY` keeps only the key text (what authd needs to write the file back), `W_ENCRYPTION_KEY` only the derived key, and `W_DUAL_KEY` both. `ReadSecMSG` and `CreateSecMSG` refuse a keystore that was not loaded in encryption or dual mode.

Sources: [src/headers/sec.h:30-35](repo://src/headers/sec.h#L30-L35), [src/os_crypto/shared/keys.c:110-140](repo://src/os_crypto/shared/keys.c#L110-L140), [src/os_crypto/shared/msgs.c:289-294](repo://src/os_crypto/shared/msgs.c#L289-L294)

### Key derivation

`OS_AddKey` does not use the key text directly. It hashes the name and ID, hashes their concatenation and keeps 15 characters of it, then prefixes the MD5 of the key text. The result is a 47-character string that both sides compute the same way from the same line, so the name and ID are bound into the encryption key.

Sources: [src/os_crypto/shared/keys.c:110-133](repo://src/os_crypto/shared/keys.c#L110-L133)

```c
OS_MD5_Str(name, -1, filesum1);
OS_MD5_Str(id, -1, filesum2);
snprintf(_finalstr, sizeof(_finalstr), "%s%s", filesum1, filesum2);
OS_MD5_Str(_finalstr, -1, filesum1);
filesum1[15] = '\0';
filesum1[16] = '\0';
OS_MD5_Str(key, -1, filesum2);
snprintf(_finalstr, sizeof(_finalstr), "%s%s", filesum2, filesum1);
```

Sources: [src/os_crypto/shared/keys.c:114-137](repo://src/os_crypto/shared/keys.c#L114-L137)

## Building a message

`CreateSecMSG(keys, msg, length, out, id)` produces the frame sent on the wire.

Sources: [src/os_crypto/shared/msgs.c:537-565](repo://src/os_crypto/shared/msgs.c#L537-L565)

1. Reject messages longer than `OS_MAXSTR - OS_HEADER_SIZE` or empty.
2. Pick the crypto token from the entry's method: `#AES:` for AES, `:` for Blowfish.
3. Reload the sender counter from disk and increment it: the local counter wraps at 9997 and then increments the global counter.
4. Write the plaintext header `%05hu%010u:%04u:` (a random 16-bit number, the global counter, the local counter) followed by the message.
5. Prefix the 32-character MD5 of that header and message.
6. Compress with zlib into a buffer that reserves 8 bytes in front, and pad with `!` to a multiple of 8 bytes.
7. Write the clear prefix: `!<id>!` followed by the token when the agent's IP is not a single host, otherwise just the token.
8. Encrypt the padded block with `OS_AES_Str` or `OS_BF_Str`, and store the sender counter.

Sources: [src/os_crypto/shared/msgs.c:556-670](repo://src/os_crypto/shared/msgs.c#L556-L670)

The resulting frame looks like this.

Sources: [src/os_crypto/shared/msgs.c:651-664](repo://src/os_crypto/shared/msgs.c#L651-L664)

```text
[!<agent id>!]#AES:<encrypted( !!!..padding  zlib( md5 + rand(5) global(10) ":" local(4) ":" message ) )>
```

Sources: [src/os_crypto/shared/msgs.c:598-664](repo://src/os_crypto/shared/msgs.c#L598-L664)

## Reading a message

### Identifying the sender

Before `ReadSecMSG` runs, remoted must know which key to use. A frame starting with `!` carries the agent ID up to the next `!`; remoted looks it up with `OS_IsAllowedDynamicID`, which also checks that the source IP falls inside the agent's registered network. Any other frame is matched by source IP with `OS_IsAllowedIP`. An agent only ever has one key, so it always reads with index 0.

Sources: [src/remoted/secure.c:599-640](repo://src/remoted/secure.c#L599-L640), [src/remoted/secure.c:694-705](repo://src/remoted/secure.c#L694-L705), [src/os_crypto/shared/keys.c:504-523](repo://src/os_crypto/shared/keys.c#L504-L523)

### Decrypting and checking

`ReadSecMSG` reads the `#AES` token to choose the method; on the manager it records the method in the agent's entry, so remoted answers each agent in the method that agent uses. After decrypting, a leading `!` means the current compressed format: it strips the padding, uncompresses, and verifies the MD5 with `CheckSum`. A leading `:` is the legacy uncompressed format, which is still accepted.

Sources: [src/os_crypto/shared/msgs.c:300-372](repo://src/os_crypto/shared/msgs.c#L300-L372), [src/os_crypto/shared/msgs.c:269-287](repo://src/os_crypto/shared/msgs.c#L269-L287)

| Result | Meaning |
| --- | --- |
| `KS_VALID` | Decrypted, checksum matched, counter newer than the last one |
| `KS_RIDS` | Counter not newer: a duplicate or a replay |
| `KS_CORRUPT` | Bad framing, failed decompression or checksum |
| `KS_ENCKEY` | Decryption failed: the key does not match |

Sources: [src/headers/sec.h:102-107](repo://src/headers/sec.h#L102-L107), [src/os_crypto/shared/msgs.c:372-442](repo://src/os_crypto/shared/msgs.c#L372-L442)

## Replay protection

Every message carries a `(global, local)` pair, and the receiver accepts it only when the pair is larger than the last one accepted for that agent. The counters survive restarts in `queue/rids/<agent id>` on the manager and `queue/rids/sender_counter` on the sender side, written as `global:local:`. `OS_StartCounter` opens or creates one file per key at load time. Writes are batched: the receiver stores the counter every `remoted.recv_counter_flush` messages, and reloads it from disk on the same cadence, so a counter edited on disk is picked up.

Sources: [src/os_crypto/shared/msgs.c:76-130](repo://src/os_crypto/shared/msgs.c#L76-L130), [src/os_crypto/shared/msgs.c:140-215](repo://src/os_crypto/shared/msgs.c#L140-L215), [src/headers/sec.h:225-233](repo://src/headers/sec.h#L225-L233)

Setting `remoted.verify_msg_id=0` disables the check: every valid message is accepted and its counter becomes the new baseline. That is the escape hatch when an agent was reinstalled with the same key and starts again from zero.

Sources: [src/os_crypto/shared/msgs.c:393-406](repo://src/os_crypto/shared/msgs.c#L393-L406), [src/os_crypto/shared/msgs.c:155-160](repo://src/os_crypto/shared/msgs.c#L155-L160)

## Reloading keys

`OS_CheckUpdateKeys` reports a change when the modification time or the inode of `client.keys` differs from the one recorded at load time. `OS_UpdateKeys` then duplicates the current keystore, frees it, reads the file again, restarts the counters, and moves the socket, peer address and last-received time of every agent whose ID and IP are unchanged from the old copy to the new one, so those agents stay connected.

Sources: [src/os_crypto/shared/keys.c:423-455](repo://src/os_crypto/shared/keys.c#L423-L455), [src/os_crypto/shared/keys.c:30-48](repo://src/os_crypto/shared/keys.c#L30-L48)

Remoted runs a key reloader thread that calls `check_keyupdate` every `remoted.keyupdate_interval` seconds and takes the keystore write lock for the reload; message handlers hold the read lock while they use an entry. Agents call `OS_UpdateKeys` after a successful enrollment.

Sources: [src/remoted/secure.c:495-505](repo://src/remoted/secure.c#L495-L505), [src/remoted/sendmsg.c:28-56](repo://src/remoted/sendmsg.c#L28-L56), [src/client-agent/start_agent.c:305-317](repo://src/client-agent/start_agent.c#L305-L317)
