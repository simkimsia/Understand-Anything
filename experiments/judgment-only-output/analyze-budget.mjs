#!/usr/bin/env node
/**
 * analyze-budget.mjs — measure the output-token budget of a knowledge graph or
 * a directory of file-analyzer batch outputs, and project the savings of the
 * "judgment-only output" change (lever #1).
 *
 * The point: file-analyzers currently emit FULL node/edge JSON, ~⅔ of which is
 * deterministic structure (id/type/name/filePath + imports/contains/exports
 * edges) that tree-sitter + the import map already produced. If the LLM emitted
 * only judgment (summary/tags/complexity + semantic edges) keyed by id and the
 * merge rebuilt structure deterministically, that ⅔ disappears from generation.
 *
 * Usage:
 *   node analyze-budget.mjs <graph.json>                 # one assembled graph
 *   node analyze-budget.mjs <dir-with-batch-*.json>      # raw batch outputs (closer to true output)
 *   node analyze-budget.mjs <a.json> <b.json> ...        # compare several
 *
 * Token estimate: ~4 chars/token. Good enough for ratios; not a billing figure.
 *
 * Honesty notes:
 *  - An assembled graph is the SURVIVING output (merge drops dangling/dup edges,
 *    JSON field overhead is partial). It UNDER-counts raw output. For the truest
 *    number, point this at a preserved `intermediate/` dir of batch-*.json.
 *  - "Deterministically free-able" edges are restricted to imports/contains/exports.
 *    Non-code edges (configures/documents/deploys/...) require LLM judgment about
 *    WHICH target they attach to, so they are counted as judgment, not structure.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const tok = (s) => Math.ceil((s || '').length / 4);
const FREE_EDGE_TYPES = new Set(['imports', 'contains', 'exports']);
const JUDGMENT_FIELDS = ['summary', 'tags', 'languageNotes'];

function collectGraphs(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    const files = readdirSync(p)
      .filter((f) => /^batch-.*\.json$/.test(f) || f === 'knowledge-graph.json')
      .map((f) => join(p, f));
    return files.map((f) => ({ path: f, g: safeRead(f) })).filter((x) => x.g);
  }
  return [{ path: p, g: safeRead(p) }];
}
function safeRead(f) {
  try {
    const g = JSON.parse(readFileSync(f, 'utf8'));
    if (!Array.isArray(g.nodes) && !Array.isArray(g.edges)) return null;
    return { nodes: g.nodes || [], edges: g.edges || [] };
  } catch {
    return null;
  }
}

function analyze(label, graphs) {
  let judgNode = 0; // summary+tags+languageNotes (irreducible LLM judgment)
  let structNode = 0; // id/type/name/filePath/complexity (deterministic)
  let idKeys = 0; // cost to emit just {id} to key the judgment join
  let freeEdge = 0; // imports/contains/exports (deterministic — merge rebuilds)
  let semEdge = 0; // calls/inherits/related/configures/... (LLM-decided)
  let nNodes = 0;
  let nEdges = 0;

  for (const { g } of graphs) {
    for (const n of g.nodes) {
      nNodes++;
      const judgment = JUDGMENT_FIELDS.map((k) => {
        const v = n[k];
        return Array.isArray(v) ? v.join(' ') : v || '';
      }).join(' ');
      judgNode += tok(judgment);
      const struct = { ...n };
      for (const k of JUDGMENT_FIELDS) delete struct[k];
      structNode += tok(JSON.stringify(struct));
      idKeys += tok(n.id) + 6; // {"id":"…"} wrapper overhead
    }
    for (const e of g.edges) {
      nEdges++;
      const t = tok(JSON.stringify(e));
      if (FREE_EDGE_TYPES.has(e.type)) freeEdge += t;
      else semEdge += t;
    }
  }

  const current = judgNode + structNode + freeEdge + semEdge;
  const judgmentOnly = judgNode + idKeys + semEdge; // LLM keeps: judgment + id + semantic edges
  const cut = current - judgmentOnly;
  const pct = (n) => ((100 * n) / current).toFixed(1) + '%';

  console.log(`\n===== ${label} =====`);
  console.log(`sources: ${graphs.length}  nodes: ${nNodes}  edges: ${nEdges}`);
  console.log(`current LLM output (approx): ${current} tok`);
  console.log(`  node judgment  (summary/tags/notes)      ${String(judgNode).padStart(7)}  ${pct(judgNode)}`);
  console.log(`  node structure (id/type/name/path/…)     ${String(structNode).padStart(7)}  ${pct(structNode)}`);
  console.log(`  edges free-able (imports/contains/exports)${String(freeEdge).padStart(7)}  ${pct(freeEdge)}`);
  console.log(`  edges semantic  (calls/inherits/…)        ${String(semEdge).padStart(7)}  ${pct(semEdge)}`);
  console.log(`judgment-only output (judgment+id+semantic): ${judgmentOnly} tok`);
  console.log(`>>> FREE output reduction: ${pct(cut)}  (${cut} tok moves to deterministic merge)`);
  return { label, current, judgmentOnly, cutPct: (100 * cut) / current };
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node analyze-budget.mjs <graph.json | dir> [more…]');
  process.exit(1);
}
const rows = [];
for (const a of args) {
  const graphs = collectGraphs(a);
  if (!graphs.length) {
    console.error(`! no graph/batch JSON found at ${a}`);
    continue;
  }
  rows.push(analyze(a, graphs));
}
if (rows.length > 1) {
  console.log('\n===== SUMMARY =====');
  for (const r of rows) console.log(`${r.cutPct.toFixed(1)}% free cut  ${r.label}`);
}
