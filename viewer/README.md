# Interactive map (Helios Web, 2D)

Source of the page served at `/map/`. 70,636 papers (52,527 management, 18,109 multi-agent AI) at the
t-SNE coordinates of the poster, drawn with [Helios Web](https://heliosweb.io/) (`helios-web` 0.10.9,
`helios-network` 0.10.x, MIT). Built from the Helios Web Builder Skill's analytics template.

- `data-src/`: coordinates and region (`joint_map.csv.gz`, from the poster), titles, years and arXiv ids
  (`joint_map_ids.csv.gz`), region names (`joint_labels.json`).
- `scripts/prepare_data.py`: writes `public/map-data.json` (columnar; git-ignored, copied to `../map/` by the build).
- `src/main.js`: scene, search, colour modes, hover card, click details.

```bash
python3 scripts/prepare_data.py   # needs pandas
npm install                       # see note below
npm run build                     # writes ../map/
```

Note: `helios-web` depends on `github:filipinascimento/d3-force-3d`, whose `prepare` script runs mocha,
and mocha fails on Node 26. We installed with a `yarn` shim on PATH that skips `yarn test` and runs the rest.
The built output in `../map/` is committed, so Pages does not need an install.

`joint_map_ids.csv.gz` was rebuilt on 2026-10-12 from the same filters as
`exps/archive/2026-09-30-abstract-genes/extract_genes_abstract.py` (skojaku/doc2lora-embedding-dev) (management: OpenAlex title and abstract kept,
sorted by `paper_id`; multi-agent: order of `genes_adapted_full.npz`), because `joint_map.parquet` with the
ids was no longer on disk. The row count (52,527 + 18,109) matches, and the title words of each region match its name.
