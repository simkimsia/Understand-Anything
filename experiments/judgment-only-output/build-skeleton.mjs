#!/usr/bin/env node
/**
 * build-skeleton.mjs — deterministic structural skeleton.
 *
 * Turns the aggregated output of extract-structure.mjs (run ONCE over all files,
 * see README "central structure pre-pass") into knowledge-graph nodes + the
 * deterministic edges (`contains`, `exports`) WITHOUT any LLM. `imports` edges
 * are intentionally left to the existing merge-batch-graphs.py importMap recovery.
 *
 * The file-analyzer, in judgment-only mode, then emits only {id, summary, tags,
 * complexity} keyed by these ids; join-judgment.mjs merges them in.
 *
 * Significance filter mirrors file-analyzer Step 2 exactly, so the skeleton
 * produces the SAME symbol nodes the baseline would (only the summaries differ).
 *
 * Input  (arg1): central-structure.json  = { results: [ <extract-structure result> ] }
 * Output (arg2): skeleton.json           = { nodes: [...], edges: [...] }
 */
import { readFileSync, writeFileSync } from 'node:fs';

// fileCategory -> node type (mirror of file-analyzer's default mapping; LLM
// overrides like data->table/schema are NOT applied here — they need judgment).
const CATEGORY_TYPE = {
  code: 'file',
  config: 'config',
  docs: 'document',
  infra: 'service',
  data: 'file',
  script: 'file',
  markup: 'document',
};
const PREFIX = {
  file: 'file',
  config: 'config',
  document: 'document',
  service: 'service',
};

const basename = (p) => p.split('/').pop();
const lineCount = (s, e) => (typeof s === 'number' && typeof e === 'number' ? e - s + 1 : 0);

function isFnSignificant(fn, exportedNames) {
  return lineCount(fn.startLine, fn.endLine) >= 10 || exportedNames.has(fn.name);
}
function isClassSignificant(cls, exportedNames) {
  const methods = Array.isArray(cls.methods) ? cls.methods.length : 0;
  return methods >= 2 || lineCount(cls.startLine, cls.endLine) >= 20 || exportedNames.has(cls.name);
}

// Coarse deterministic complexity from structural counts (the LLM may overwrite
// this via judgment; it's only a placeholder so the skeleton is self-sufficient).
function coarseComplexity(r) {
  const fns = (r.functions || []).length;
  const cls = (r.classes || []).length;
  const loc = r.totalLines || 0;
  const score = fns + cls * 2 + loc / 120;
  if (score >= 14) return 'complex';
  if (score >= 5) return 'moderate';
  return 'simple';
}

export function buildSkeleton(central) {
  const nodes = [];
  const edges = [];
  const results = central.results || [];

  for (const r of results) {
    const type = CATEGORY_TYPE[r.fileCategory] || 'file';
    const prefix = PREFIX[type] || 'file';
    const fileId = `${prefix}:${r.path}`;
    nodes.push({
      id: fileId,
      type,
      name: basename(r.path),
      filePath: r.path,
      complexity: coarseComplexity(r),
      _skeleton: true,
    });

    if (r.fileCategory !== 'code') continue; // symbols only for code files
    const exportedNames = new Set((r.exports || []).map((e) => e.name));

    for (const fn of r.functions || []) {
      if (!isFnSignificant(fn, exportedNames)) continue;
      const id = `function:${r.path}:${fn.name}`;
      nodes.push({ id, type: 'function', name: fn.name, filePath: r.path, complexity: 'simple', _skeleton: true });
      edges.push({ source: fileId, target: id, type: 'contains', direction: 'forward', weight: 1.0 });
      if (exportedNames.has(fn.name))
        edges.push({ source: fileId, target: id, type: 'exports', direction: 'forward', weight: 0.8 });
    }
    for (const cls of r.classes || []) {
      if (!isClassSignificant(cls, exportedNames)) continue;
      const id = `class:${r.path}:${cls.name}`;
      nodes.push({ id, type: 'class', name: cls.name, filePath: r.path, complexity: 'moderate', _skeleton: true });
      edges.push({ source: fileId, target: id, type: 'contains', direction: 'forward', weight: 1.0 });
      if (exportedNames.has(cls.name))
        edges.push({ source: fileId, target: id, type: 'exports', direction: 'forward', weight: 0.8 });
    }
  }
  return { nodes, edges };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error('usage: node build-skeleton.mjs <central-structure.json> <skeleton.json>');
    process.exit(1);
  }
  const central = JSON.parse(readFileSync(inPath, 'utf8'));
  const skel = buildSkeleton(central);
  writeFileSync(outPath, JSON.stringify(skel, null, 2));
  const sym = skel.nodes.filter((n) => /^(function|class):/.test(n.id)).length;
  console.error(
    `skeleton: ${skel.nodes.length} nodes (${sym} symbols), ${skel.edges.length} edges (contains/exports) → ${outPath}`,
  );
}
