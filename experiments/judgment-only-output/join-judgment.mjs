#!/usr/bin/env node
/**
 * join-judgment.mjs — assemble a knowledge graph from a deterministic skeleton
 * + judgment-only file-analyzer batch outputs.
 *
 * This is the offline counterpart to the merge-batch-graphs.py change. It lets
 * you assemble + diff a judgment-only run WITHOUT modifying the live Python merge,
 * so the experiment stays self-contained.
 *
 * Join rule (outer, robust to id mismatch):
 *   - skeleton node + matching judgment  -> structural fields from skeleton,
 *                                           summary/tags/complexity/languageNotes from judgment
 *   - skeleton node, no judgment          -> kept with summary:"" (deepen-on-demand / coverage net)
 *   - judgment id with no skeleton node   -> kept as-is (LLM saw something the parser missed)
 *   Edges: skeleton (contains/exports) + judgment semantic edges, deduped by
 *          source|target|type. `imports` recovery is left to the real merge.
 *
 * Usage: node join-judgment.mjs <skeleton.json> <batchDirOrFile...> > assembled.json
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STRUCT_FIELDS = ['id', 'type', 'name', 'filePath'];
const JUDG_FIELDS = ['summary', 'tags', 'complexity', 'languageNotes'];

function readJudgmentSources(paths) {
  const out = [];
  for (const p of paths) {
    const st = statSync(p);
    const files = st.isDirectory()
      ? readdirSync(p).filter((f) => /^batch-.*\.json$/.test(f)).map((f) => join(p, f))
      : [p];
    for (const f of files) {
      try {
        out.push(JSON.parse(readFileSync(f, 'utf8')));
      } catch (e) {
        console.error(`! skip unparseable ${f}: ${e.message}`);
      }
    }
  }
  return out;
}

const skeleton = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const judgmentBatches = readJudgmentSources(process.argv.slice(3));

// index judgment by id
const judgmentById = new Map();
for (const b of judgmentBatches) for (const n of b.nodes || []) judgmentById.set(n.id, n);

const nodes = [];
const seen = new Set();
let joined = 0;
let coverageNet = 0;

for (const s of skeleton.nodes) {
  const j = judgmentById.get(s.id);
  const node = {};
  for (const k of STRUCT_FIELDS) if (s[k] !== undefined) node[k] = s[k];
  if (j) {
    joined++;
    for (const k of JUDG_FIELDS) if (j[k] !== undefined) node[k] = j[k];
  } else {
    coverageNet++;
    node.summary = ''; // shallow placeholder — deepen on demand
    node.tags = [];
    node.complexity = s.complexity || 'moderate';
  }
  if (node.complexity === undefined) node.complexity = s.complexity || 'moderate';
  nodes.push(node);
  seen.add(s.id);
}

// judgment ids the parser never produced (parser miss / LLM-only nodes)
let llmOnly = 0;
for (const [id, j] of judgmentById) {
  if (seen.has(id)) continue;
  llmOnly++;
  nodes.push(j);
}

// edges: skeleton structural + judgment semantic, deduped
const edges = [];
const edgeKey = (e) => `${e.source}|${e.target}|${e.type}`;
const edgeSeen = new Set();
for (const e of skeleton.edges) {
  if (edgeSeen.has(edgeKey(e))) continue;
  edgeSeen.add(edgeKey(e));
  edges.push(e);
}
for (const b of judgmentBatches) {
  for (const e of b.edges || []) {
    if (e.type === 'contains' || e.type === 'exports') continue; // skeleton owns these
    if (edgeSeen.has(edgeKey(e))) continue;
    edgeSeen.add(edgeKey(e));
    edges.push(e);
  }
}

console.error(
  `join: ${nodes.length} nodes (${joined} joined, ${coverageNet} coverage-net placeholders, ${llmOnly} llm-only), ${edges.length} edges`,
);
process.stdout.write(JSON.stringify({ nodes, edges }, null, 2));
