# Experiment: judgment-only file-analyzer output ("lever #1")

**Hypothesis:** `/understand --full` is **generation-bound**, and the majority of
what the LLM generates in Phase 2 is **deterministic structure it was already
handed** (node `id`/`type`/`name`/`filePath` + `imports`/`contains`/`exports`
edges). If the file-analyzer emitted **only judgment** (`summary`/`tags`/
`complexity` + semantic edges) keyed by `id`, and the merge rebuilt structure
deterministically, we remove ~⅔ of output generation **for free** — no loss of
nodes, edges, or summaries.

## Why we think this (measured, not modelled)

Run `analyze-budget.mjs` on the two existing eval graphs:

| Graph | nodes | current LLM output | **free reduction** | edges share |
|---|---|---|---|---|
| stockanalyzer (700 files / Sonnet, ~50 min) | 1042 | ~174k tok | **59.4%** | 43% of output |
| agenticseek (68 files / Opus, ~30 min) | 182 | ~27k tok | 49.2% | 33% of output |

The single biggest waste is **edges**: 1,946 deterministic `imports`/`contains`/
`exports` edges = 43% of all output on stockanalyzer. `imports` are *already*
re-derived by `merge-batch-graphs.py` from the scan importMap, yet the LLM still
spends tokens emitting them.

Time math: stockanalyzer ~174k tok / ~70 tok·s⁻¹ ≈ **41 of the 50 min is
generation (~82%)**. A 59% output cut → generation ~41→~17 min → run **~50 →
~25 min, free.** (Estimate; the micro-benchmark below converts it to a fact.)

This beats the tiering/importance-routing idea, which targets only the *summary*
bucket (≤ the judgment portion), trades quality, and is the harder build.

## What's in this folder (all verified offline)

| File | What it does | Verified |
|---|---|---|
| `analyze-budget.mjs` | Token budget + structure/judgment split + free-cut projection, on any graph or `intermediate/` dir | ✓ on both real graphs |
| `build-skeleton.mjs` | **Deterministic** skeleton nodes + `contains`/`exports` edges from `extract-structure` output (same significance filter as file-analyzer Step 2) | ✓ on fixture |
| `join-judgment.mjs` | Outer-join judgment-only batch outputs onto the skeleton by `id` (coverage-net for misses) | ✓ on fixture |
| `diff-graphs.mjs` | Structural equivalence check baseline vs candidate (proves no lost coverage) | ✓ |
| `fixtures/` | Tiny sample exercising significance filter, coverage-net, edge dedup | — |

```bash
node analyze-budget.mjs <graph.json | intermediate-dir>
node build-skeleton.mjs central-structure.json skeleton.json
node join-judgment.mjs skeleton.json intermediate/ > assembled.json
node diff-graphs.mjs baseline.json assembled.json
```

---

## Experiment A — micro-benchmark (DO THIS FIRST; cheap; proves generation-bound)

Don't re-run the whole 50-min pipeline to test the hypothesis. Isolate the one
variable — the file-analyzer **output contract** — on a single fixed batch.

1. Run a normal `/understand --full` on the target repo once; **preserve the
   intermediates** (comment out the `rm -rf …/intermediate` cleanup in SKILL.md
   Phase 3d/Phase 7, or copy the dir out mid-run). Keep `batches.json` and one
   representative `batch-<i>.json`.
2. Pick one mid-size code batch. Dispatch the `file-analyzer` agent on it **twice,
   same model (Sonnet), same input**:
   - **(A) baseline contract** — current `file-analyzer.md` output format.
   - **(B) judgment-only contract** — replace the "Output Format" section with
     `patches/file-analyzer-output.judgment-only.md` (below). The agent still runs
     `extract-structure.mjs` for context; only what it *emits* changes.
3. For each, record **wall-clock** and run `analyze-budget.mjs` on the emitted
   batch file.

**Pass criteria:** (B) emits ~55–60% fewer tokens **and** finishes
proportionally faster. If tokens drop but time doesn't → the run is *not*
generation-bound and lever #1 won't help wall-clock (pivot to adaptive
concurrency + prompt caching instead). Either way you learn the truth for ~5 min
of compute instead of 100.

## Experiment B — full offline assembly + equivalence

Once A passes, prove the assembled graph loses nothing:

1. Generate the central structure once (the "pre-pass"):
   ```bash
   # aggregate extract-structure over ALL files into one results array
   node skills/understand/extract-structure.mjs   # see README note below
   ```
   It must produce `{ "results": [ <per-file extract-structure result> ] }`.
2. `node build-skeleton.mjs central-structure.json skeleton.json`
3. Run file-analyzers in judgment-only mode → judgment `batch-*.json`.
4. `node join-judgment.mjs skeleton.json intermediate/ > assembled.json`
5. `node diff-graphs.mjs <baseline knowledge-graph.json> assembled.json`
   → **expect 0 baseline nodes missing**, same edge set (modulo `imports`
   recovered by the real merge), summaries present on all non-coverage-net nodes.

> Note: `extract-structure.mjs` today takes a single batch (`{projectRoot,
> batchFiles, batchImportData}`) and writes one result set. For the central
> pre-pass, call it once per batch from `batches.json` and concatenate the
> `results` arrays, **or** call it with all files as one batch. Either yields the
> `central-structure.json` shape `build-skeleton.mjs` expects.

---

## Production integration (after A + B confirm) — specified, not yet applied

> Not applied here because branch `docs/understand-pipeline` has uncommitted WIP
> on `file-analyzer.md`, `SKILL.md`, and `compute-batches.mjs`. Coordinate before
> editing those.

1. **SKILL.md — new Phase 1.6 "STRUCTURE" (central pre-pass).** After Phase 1.5
   BATCH, run `extract-structure.mjs` over all files once → `central-structure.json`,
   then `build-skeleton.mjs` → `skeleton.json`. Double win: also kills the
   per-batch tree-sitter WASM cold-start.
2. **file-analyzer.md — judgment-only "Output Format"** (see
   `patches/file-analyzer-output.judgment-only.md`): emit `{id, summary, tags,
   complexity, languageNotes?}` per node + semantic edges only. Stop creating
   structural file/function/class node fields and stop emitting `contains`/
   `exports` (the skeleton owns them). Keep the existing "don't transcribe
   imports" rule. Inject the per-file symbol list (from the skeleton) into the
   dispatch context so the agent knows which ids to summarize.
3. **merge-batch-graphs.py — skeleton-first assembly.** Seed nodes/edges from
   `skeleton.json`, then join batch judgment by `id` (outer-join as in
   `join-judgment.mjs`), then run the existing importMap recovery + test-linking
   + normalization unchanged.

## Caveats (honest)

- The 59.4% is from the **surviving** graph; raw output (retries, dropped dups)
  is larger, so the real free-cut is likely **≥** this. The micro-benchmark on a
  real batch file measures the true figure.
- Token estimate is ~4 chars/token — fine for ratios, not a billing number.
- `complexity` is kept as judgment (one token); the skeleton sets a deterministic
  placeholder that judgment overwrites.
- Only `imports`/`contains`/`exports` are treated as deterministic. Non-code
  edges (`configures`/`documents`/`deploys`/…) need LLM judgment about their
  target and stay in the LLM's output.

## Which repo / model

- **Iterate on agenticseek** (faster loop).
- **⚠ Use the same model for baseline and candidate** — the existing baselines
  used different models (agenticseek=Opus, stockanalyzer=Sonnet). Use **Sonnet**
  for both sides of the A/B.
- **Report the headline on stockanalyzer/Sonnet** — it's the pain case, most
  generation-bound (~82%), and has the biggest cut (59%). agenticseek
  under-sells it (49%, only ~half generation-bound).
