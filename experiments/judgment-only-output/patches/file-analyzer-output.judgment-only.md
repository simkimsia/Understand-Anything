# Judgment-only Output Format (drop-in replacement for file-analyzer.md "Output Format")

> For the micro-benchmark (Experiment A): replace the agent's existing **"## Output
> Format"** section with the block below, leave everything before it (the
> structural-extraction script step, significance filter, summary/tag guidance)
> unchanged. The agent still runs `extract-structure.mjs` for context — only what
> it **emits** changes.

---

## Output Format (judgment-only)

You have ALREADY been given (or extracted) the structural skeleton: file paths,
function/class names, and their ids. **Do NOT re-emit structure.** The merge step
rebuilds all node identity (`id`/`type`/`name`/`filePath`) and all `contains` /
`exports` / `imports` edges deterministically from the skeleton + import map.

Emit ONLY your judgment, keyed by the exact node `id`, plus genuinely semantic
edges. Produce a single valid JSON block:

```json
{
  "nodes": [
    {
      "id": "file:src/pricing.py",
      "summary": "Core pricing rules engine computing tiered order discounts.",
      "tags": ["domain", "pricing", "core"],
      "complexity": "complex",
      "languageNotes": "…optional, only when genuinely educational…"
    },
    {
      "id": "function:src/pricing.py:compute_discount",
      "summary": "Computes the discount for an order given customer tier and active rules.",
      "tags": ["pricing", "pure-function"],
      "complexity": "moderate"
    }
  ],
  "edges": [
    { "source": "file:src/pricing.py", "target": "file:src/util/log.py", "type": "calls", "direction": "forward", "weight": 0.8 }
  ]
}
```

### Rules

- **Node objects:** ONLY `id`, `summary`, `tags`, `complexity`, and optional
  `languageNotes`. No `type`, `name`, or `filePath` — those come from the skeleton.
- **Use the exact ids** from the skeleton/significance filter (`file:<path>`,
  `function:<path>:<name>`, `class:<path>:<name>`, `config:<path>`, …). A summary
  on an id the skeleton doesn't have is still kept (parser-miss safety), but
  prefer matching ids so the join lands.
- **Summarize every significant node** the skeleton lists for your files (same
  significance filter as before). A node you skip becomes a coverage-net
  placeholder (empty summary) — acceptable but not the goal.
- **Edges — emit ONLY semantic ones:** `calls`, `inherits`, `implements`,
  `depends_on`, `tested_by`, and the non-code judgment edges (`configures`,
  `documents`, `deploys`, `triggers`, `defines_schema`, `serves`, `provisions`,
  `routes`, `related`). **Do NOT emit `contains`, `exports`, or `imports`** — the
  skeleton/merge own those. Emitting them is wasted output and will be dropped.
- Same JSON-validity discipline as before: closed arrays/objects, quoted strings,
  no trailing commas.
