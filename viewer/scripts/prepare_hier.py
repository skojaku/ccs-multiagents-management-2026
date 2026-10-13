"""Build public/hier-data.json for the hierarchical map from data-src/m2ma_*.

m2ma_map.csv.gz         paper / node rows with 2D and 3D t-SNE coordinates (management moved onto multi-agent AI by one
                        translation; a bisecting k-means tree of depth up to 7 per field, 506 nodes)
m2ma_membership_d7.csv.gz  the deepest tree node of every paper
m2ma_tree_d7.json          per node: size, decoded name and description (management also after the move), nearest
                        multi-agent nodes at depth 4

Rows are aligned with map-data.json (joint_map_ids order); the 60 multi-agent papers without an abstract have no
coordinates (null) and no node (-1). A node's position is the median of its members' coordinates and its radius the
root-mean-square distance of the members from that position, so labels sit on the cluster and zoom thresholds follow
its extent.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent.parent
ids = pd.read_csv(HERE / "data-src/joint_map_ids.csv.gz", low_memory=False)
mp = pd.read_csv(HERE / "data-src/m2ma_map.csv.gz", low_memory=False)
mem = pd.read_csv(HERE / "data-src/m2ma_membership_d7.csv.gz")
tree = json.loads((HERE / "data-src/m2ma_tree_d7.json").read_text())["nodes"]

papers = mp[mp.kind == "paper"].copy()
papers["paper_id"] = papers.paper_id.astype(int)
assert len(papers) == len(mem) == 70576
pos = {k: i for i, k in enumerate(zip(papers.corpus, papers.paper_id))}
mem_pos = {k: i for i, k in enumerate(zip(mem.corpus, mem.paper_id.astype(int)))}

order = sorted(tree, key=lambda n: (n["corpus"] != "management", n["depth"], n["id"]))
index = {n["id"]: i for i, n in enumerate(order)}

rows = [pos.get(k, -1) for k in zip(ids.corpus, ids.paper_id.astype(int))]
mrows = [mem_pos.get(k, -1) for k in zip(ids.corpus, ids.paper_id.astype(int))]
assert sum(r >= 0 for r in rows) == len(papers)
leaf_of = mem.leaf.tolist()
node = np.array([index[leaf_of[r]] if r >= 0 else -1 for r in mrows])


def column(col, nd=2):
    v = papers[col].round(nd).tolist()
    return [v[r] if r >= 0 else None for r in rows]


coords = {c: np.array([np.nan if r < 0 else papers[c].iloc[r] for r in rows]) for c in ["x2d", "y2d", "x3d", "y3d", "z3d"]}
children = {}
for n in order:
    if n["parent"]:
        children.setdefault(n["parent"], []).append(n["id"])


def members(node_id):
    """Paper rows whose deepest node is node_id or one of its descendants."""
    ids_ = [node_id]
    out = []
    while ids_:
        i = ids_.pop()
        out.append(index[i])
        ids_.extend(children.get(i, []))
    return np.isin(node, out)


nodes = []
for n in order:
    m = members(n["id"])
    assert m.sum() == n["n"], (n["id"], m.sum(), n["n"])
    c2 = [float(np.nanmedian(coords[c][m])) for c in ("x2d", "y2d")]
    c3 = [float(np.nanmedian(coords[c][m])) for c in ("x3d", "y3d", "z3d")]
    r2 = float(np.sqrt(np.nanmean(sum((coords[c][m] - v) ** 2 for c, v in zip(("x2d", "y2d"), c2)))))
    r3 = float(np.sqrt(np.nanmean(sum((coords[c][m] - v) ** 2 for c, v in zip(("x3d", "y3d", "z3d"), c3)))))
    nodes.append({
        "id": n["id"],
        "parent": index[n["parent"]] if n["parent"] else -1,
        "depth": n["depth"],
        "corpus": 0 if n["corpus"] == "management" else 1,
        "n": n["n"],
        "name": n["decode"]["name"].strip(),
        "desc": n["decode"]["desc"].strip(),
        "moved": (n.get("decode_moved") or {}).get("name", "").strip(),
        "movedDesc": (n.get("decode_moved") or {}).get("desc", "").strip(),
        "near": [{"node": index[x["id"]], "cos": x["cos"]} for x in n.get("nearest_ma_d4_nodes", [])],
        "c2": [round(v, 2) for v in c2], "c3": [round(v, 2) for v in c3],
        "r2": round(r2, 2), "r3": round(r3, 2),
    })

out = {
    "node": node.tolist(),
    "x2": column("x2d"), "y2": column("y2d"),
    "x3": column("x3d"), "y3": column("y3d"), "z3": column("z3d"),
    "nodes": nodes,
}
(HERE / "public/hier-data.json").write_text(json.dumps(out, separators=(",", ":")))
print(len(nodes), "nodes;", (HERE / "public/hier-data.json").stat().st_size // 1024, "KB")
