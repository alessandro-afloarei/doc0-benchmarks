# Applies RULES.md to the model grid: per model, per size class, the map decision, parity, and second-run candidates.
#   python3 analyze.py > analysis.json   (also prints a readable summary to stderr)
import json, math, os, sys

A = "/work/artifacts/wt-bench-arms/results"
CWB = "/work/artifacts/codewikibench-2026-11-15/runs"
MODELS = {"gopus": "Opus 5.5", "gsonnet": "Sonnet 5.5", "ghaiku": "Haiku 5.5", "gsol": "Sol 6.1", "gastra": "Astra"}
SIZE = {"fd": "small", "hono": "medium", "celery": "medium", "OpenHands": "big", "electron": "big"}
ARMS = ["doc0-map", "doc0-nomap", "openwiki"]
DIMS = ["depth", "coherence", "breadth"]

def cwb(repo, tag, arm):
    p = f"{CWB}/{repo}/grid-{tag}-{arm}/summary.json"
    if not os.path.exists(p): return None
    m = json.load(open(p))["models"].get("deepseek-v4.1-flash")
    return None if not m or m.get("errors") else m["score"]

cells = []
for tag in MODELS:
    for phase in ["p1", "p2"]:
        f = f"{A}/arms-2026-11-16-{tag}-{phase}.json"
        if not os.path.exists(f): continue
        for r in json.load(open(f))["repos"]:
            arms = {}
            for a in ARMS:
                c = r["arms"][a]; j = c.get("judged") or {}
                arms[a] = {"status": c["status"], "pages": c["pageCount"], "tokens": c["totalTokens"], "grounded": j.get("groundedRate"),
                           "per1k": j.get("groundedPer1000Words"), "failures": j.get("judgeFailures"), "cwb": cwb(r["repo"], tag, a) if SIZE[r["repo"]] == "big" else None}
            comp = {p: {d: {"verdict": v[d]["verdict"], "margin": v[d]["margin"]} for d in DIMS} for p, v in r["comparative"].items()}
            cells.append({"model": tag, "repo": r["repo"], "size": SIZE[r["repo"]], "arms": arms, "comparative": comp})

# Rule 4: a re-run arm's grounded rate, per-1k and coverage are the mean of its two runs; blind cells stay the first run's,
# the second run's are kept beside them (comparative2) and reported.
for c in cells:
    f = f"{A}/arms-2026-11-16-{c['model']}2-s2.json"
    if not os.path.exists(f): continue
    second = next((r for r in json.load(open(f))["repos"] if r["repo"] == c["repo"]), None)
    if second is None: continue
    for a in ARMS:
        s2 = second["arms"].get(a); j = (s2 or {}).get("judged") or {}
        if not s2 or s2["status"] != "complete" or j.get("groundedRate") is None: continue
        arm = c["arms"][a]
        arm["runs"] = 2
        for key, val in (("grounded", j["groundedRate"]), ("per1k", j["groundedPer1000Words"])):
            if arm[key] is not None and val is not None: arm[key] = (arm[key] + val) / 2
        if c["size"] == "big":
            cov2 = cwb(c["repo"], c["model"] + "2", a)
            if arm["cwb"] is not None and cov2 is not None: arm["cwb"] = (arm["cwb"] + cov2) / 2
    c["comparative2"] = {p: {d: {"verdict": v[d]["verdict"], "margin": v[d]["margin"]} for d in DIMS} for p, v in second["comparative"].items()}

def complete(c): return all(c["arms"][a]["status"] == "complete" and c["arms"][a]["grounded"] is not None for a in ["doc0-map", "doc0-nomap"])

def map_helps(group):
    group = [c for c in group if complete(c)]
    n = len(group)
    if n == 0: return {"n": 0, "helps": None}
    diff = sum(c["arms"]["doc0-map"]["grounded"] - c["arms"]["doc0-nomap"]["grounded"] for c in group) / n
    wins = sum(1 for c in group if all(c["comparative"].get("doc0-map~doc0-nomap", {}).get(d, {}).get("verdict") == "better" for d in ["depth", "breadth"]))
    need = math.ceil(2 * n / 3)
    tok_map = sum(c["arms"]["doc0-map"]["tokens"] or 0 for c in group); tok_nomap = sum(c["arms"]["doc0-nomap"]["tokens"] or 0 for c in group)
    ratio = tok_map / tok_nomap if tok_nomap else None
    big = [c for c in group if c["size"] == "big"]
    cov = [(c["arms"]["doc0-map"]["cwb"], c["arms"]["doc0-nomap"]["cwb"]) for c in big]
    cov_win = len(big) == 2 and all(m is not None and nm is not None and m - nm >= 0.03 - 1e-9 for m, nm in cov)
    better = diff >= 0.02 - 1e-9 or wins >= need or cov_win
    return {"n": n, "grounded_diff_points": round(100 * diff, 1), "blind_wins": wins, "wins_needed": need, "coverage_win_both_big": cov_win,
            "coverage_pairs": [[round(m, 3) if m is not None else None, round(nm, 3) if nm is not None else None] for m, nm in cov],
            "token_ratio": round(ratio, 3) if ratio else None, "helps": bool(better and ratio is not None and ratio <= 1.25)}

per_model = {t: map_helps([c for c in cells if c["model"] == t]) for t in MODELS}
per_size = {s: map_helps([c for c in cells if c["size"] == s]) for s in ["small", "medium", "big"]}
helped_models = [t for t, v in per_model.items() if v.get("helps")]
helped_sizes = [s for s, v in per_size.items() if v.get("helps")]
if not helped_models and not helped_sizes: outcome = "remove"
elif len(helped_models) == len(MODELS): outcome = "keep on by default"
else: outcome = "keep, off by default, on where it helped"

parity = {}
for t in MODELS:
    worse = [(c["repo"], d) for c in cells if c["model"] == t for d in DIMS if c["comparative"].get("doc0-nomap~openwiki", {}).get(d, {}).get("verdict") == "worse"]
    total = sum(1 for c in cells if c["model"] == t and "doc0-nomap~openwiki" in c["comparative"]) * 3
    worse2 = [(c["repo"], d) for c in cells if c["model"] == t for d in DIMS if c.get("comparative2", {}).get("doc0-nomap~openwiki", {}).get(d, {}).get("verdict") == "worse"]
    both = [w for w in worse if w in worse2]
    parity[t] = {"worse_cells": len(worse), "of": total, "where": worse, "second_run_worse": worse2, "worse_in_both_runs": both}

second = []
for c in cells:
    if not complete(c): continue
    g = abs(c["arms"]["doc0-map"]["grounded"] - c["arms"]["doc0-nomap"]["grounded"])
    mm = c["comparative"].get("doc0-map~doc0-nomap", {})
    if g < 0.02 and all(abs(mm.get(d, {}).get("margin", 0)) <= 0.5 for d in DIMS): second.append({"model": c["model"], "repo": c["repo"], "pair": "doc0-map~doc0-nomap"})
for c in cells:
    if any(c["comparative"].get("doc0-nomap~openwiki", {}).get(d, {}).get("verdict") == "worse" for d in DIMS):
        second.append({"model": c["model"], "repo": c["repo"], "pair": "doc0-nomap~openwiki"})

out = {"cells": cells, "per_model": per_model, "per_size": per_size, "helped_models": helped_models, "helped_sizes": helped_sizes,
       "outcome": outcome, "parity": parity, "second_run_candidates": second}
json.dump(out, sys.stdout, indent=1)
w = sys.stderr.write
w(f"cells judged: {len(cells)} (complete pairs: {sum(complete(c) for c in cells)})\n")
for t, v in per_model.items(): w(f"{MODELS[t]:11} {v}\n")
for s, v in per_size.items(): w(f"{s:11} {v}\n")
w(f"outcome: {outcome}; helped models {helped_models}; helped sizes {helped_sizes}\n")
for t, v in parity.items(): w(f"parity {MODELS[t]:11} first run worse {v['worse_cells']}/{v['of']}; second run worse {v['second_run_worse']}; worse in both {v['worse_in_both_runs']}\n")
w(f"second-run candidates: {len(second)}\n")
