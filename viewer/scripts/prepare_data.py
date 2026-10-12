"""Build public/map-data.json (columnar) from data-src/.

Layers: poster (t-SNE of the poster: multi-agent from PDF text, management from title+abstract),
abstract (both from title+abstract, no alignment), translate (abstract + each corpus mean-aligned).
The 60 multi-agent papers without a usable abstract have no coordinates in the two abstract layers.

joint_map.csv.gz      corpus, xt, yt, region   (t-SNE of the joint Doc2LoRA map, poster Fig.)
joint_map_ids.csv.gz  paper_id, corpus, title, arxiv_id, year   (same row order)
joint_labels.json     region names

The ids file was rebuilt on 2026-10-12 from the same filters as extract_genes_abstract.py
(management: OpenAlex title + abstract kept, sorted by paper_id; multi-agent: genes order), because
the original joint_map.parquet was no longer on disk. Row counts and region/title coherence were checked.
"""
import json
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent.parent
m = pd.read_csv(HERE / "data-src/joint_map.csv.gz")
ids = pd.read_csv(HERE / "data-src/joint_map_ids.csv.gz", low_memory=False)
labels = json.loads((HERE / "data-src/joint_labels.json").read_text())
assert len(m) == len(ids) and (m.corpus.values == ids.corpus.values).all()

corpus = (m.corpus == "multiagent").astype(int)  # 0 management, 1 multi-agent
poster_names = [labels["management"][str(r)] for r in range(6)] + [labels["multiagent"][str(r)] for r in range(6)]
poster_region = (m.region.astype(int) + 6 * corpus).tolist()

new = pd.read_csv(HERE / "data-src/abstract_map.csv.gz")
regions = json.loads((HERE / "data-src/abstract_map_regions.json").read_text())["regions"]
abstract_names = [regions[str(r)]["name"] for r in range(12)]
key = list(zip(ids.corpus, ids.paper_id.astype(int)))
idx = {k: i for i, k in enumerate(zip(new.corpus, new.paper_id.astype(int)))}
rows = [idx.get(k, -1) for k in key]
assert sum(r >= 0 for r in rows) == len(new)


def pick(col):
    v = new[col].round(3).tolist()
    return [v[r] if r >= 0 else None for r in rows]


reg_new = new.region.astype(int).tolist()
region_new = [reg_new[r] if r >= 0 else -1 for r in rows]
out = {
    "corpus": corpus.tolist(),
    "year": ids.year.fillna(0).astype(int).tolist(),
    "title": ids.title.fillna("").astype(str).str.strip().tolist(),
    "arxiv": ids.arxiv_id.fillna("").astype(str).tolist(),
    "layers": {
        "poster": {"x": m.xt.round(3).tolist(), "y": m.yt.round(3).tolist(), "region": poster_region, "regionNames": poster_names},
        "abstract": {"x": pick("x_none"), "y": pick("y_none"), "region": region_new, "regionNames": abstract_names},
        "translate": {"x": pick("x_translate"), "y": pick("y_translate"), "region": region_new, "regionNames": abstract_names},
    },
}
(HERE / "public/map-data.json").write_text(json.dumps(out, separators=(",", ":")))
print(len(m), "papers ->", (HERE / "public/map-data.json").stat().st_size // 1024, "KB")
