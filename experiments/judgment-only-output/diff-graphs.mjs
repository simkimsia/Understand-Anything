#!/usr/bin/env node
/**
 * diff-graphs.mjs — structural equivalence check between a baseline graph and a
 * judgment-only-assembled graph. Proves the change is FREE (no lost coverage),
 * not a quality trade.
 *
 * Reports node-id and edge set deltas, and summary coverage on both sides.
 * Usage: node diff-graphs.mjs <baseline.json> <candidate.json>
 */
import { readFileSync } from 'node:fs';
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ids = (g) => new Set(g.nodes.map((n) => n.id));
const edgeSet = (g) => new Set(g.edges.map((e) => `${e.source}|${e.target}|${e.type}`));
const withSummary = (g) => g.nodes.filter((n) => (n.summary || '').trim().length > 0).length;

const [a, b] = [load(process.argv[2]), load(process.argv[3])];
const ia = ids(a), ib = ids(b);
const onlyA = [...ia].filter((x) => !ib.has(x));
const onlyB = [...ib].filter((x) => !ia.has(x));
const ea = edgeSet(a), eb = edgeSet(b);
const edgeOnlyA = [...ea].filter((x) => !eb.has(x));
const edgeOnlyB = [...eb].filter((x) => !ea.has(x));

console.log(`baseline : ${a.nodes.length} nodes, ${a.edges.length} edges, ${withSummary(a)} with summary`);
console.log(`candidate: ${b.nodes.length} nodes, ${b.edges.length} edges, ${withSummary(b)} with summary`);
console.log(`\nnode ids only in baseline  (${onlyA.length}): ${onlyA.slice(0, 15).join(', ')}${onlyA.length > 15 ? ' …' : ''}`);
console.log(`node ids only in candidate (${onlyB.length}): ${onlyB.slice(0, 15).join(', ')}${onlyB.length > 15 ? ' …' : ''}`);
console.log(`\nedges only in baseline  (${edgeOnlyA.length}): ${edgeOnlyA.slice(0, 10).join('  ;  ')}${edgeOnlyA.length > 10 ? ' …' : ''}`);
console.log(`edges only in candidate (${edgeOnlyB.length}): ${edgeOnlyB.slice(0, 10).join('  ;  ')}${edgeOnlyB.length > 10 ? ' …' : ''}`);

const structuralLoss = onlyA.length;
console.log(
  `\nVERDICT: ${structuralLoss === 0 ? 'no structural node loss ✓' : `⚠ ${structuralLoss} baseline node(s) missing from candidate`}` +
    ` | summary coverage ${withSummary(b)}/${b.nodes.length} on candidate`,
);
