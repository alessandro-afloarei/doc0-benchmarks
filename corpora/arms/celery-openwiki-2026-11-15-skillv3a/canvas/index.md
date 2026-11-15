# Files

- [Canvas: Signatures, Chains, Groups and Chords](workflows.md) - How celery/canvas.py represents task invocations as serializable Signature dicts and composes them into chains, groups, chords, chunks and map/starmap; how chains travel in the message, how chords are joined (chord_unlock polling, counter-based incr, Redis native join), stamping, and how errors propagate.
