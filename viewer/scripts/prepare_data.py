"""Build public/map-data.json (columnar) from data-src/.

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
names = [labels["management"][str(r)] for r in range(6)] + [labels["multiagent"][str(r)] for r in range(6)]
region = m.region.astype(int) + 6 * corpus  # 0-5 management, 6-11 multi-agent
out = {
    "x": m.xt.round(3).tolist(), "y": m.yt.round(3).tolist(),
    "corpus": corpus.tolist(), "region": region.tolist(),
    "year": ids.year.fillna(0).astype(int).tolist(),
    "title": ids.title.fillna("").astype(str).str.strip().tolist(),
    "arxiv": ids.arxiv_id.fillna("").astype(str).tolist(),
    "regionNames": names,
}
(HERE / "public/map-data.json").write_text(json.dumps(out, separators=(",", ":")))
print(len(m), "papers ->", (HERE / "public/map-data.json").stat().st_size // 1024, "KB")
