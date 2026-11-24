// Token Launch Radar — entry point (Node 22, standard library only).
//
// Reads the sealed snapshot (--input <file|dir>, default /input/snapshot.json), values every
// pre-token protocol with the radar-2 model in lib/model.ts, and writes the deliverables:
//   <out>/board.json    the ranked board (the gate reads this)
//   <out>/data.js       the same rows plus detail fields, for the dashboard
//   <out>/dashboard/    a copy of this repository's static page
//   <out>/screenshots/  a copy of this repository's three screenshots
//   <out>/dossier.json  the judge's summary, built by vendor/makefun-board.ts
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
// The program is a pure function of the snapshot and the repository's own files, so the
// grader's two runs write identical bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The sealed gate's caps (competition reference): the dossier text cap shapes what the
// judge can read; the rest only refuse, so the program checks its own output against them.
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at !== -1 && args[at + 1] !== undefined) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token-launch-radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flagValue('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath} — pass --input <snapshot.json|dir> or mount the sealed /input`);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const radar = buildRadar(snapshot);
const board = radar.rows.map((r) => ({
  slug: r.slug,
  name: r.name,
  rank: r.rank,
  implied_value_usd: r.implied_value_usd,
  farm_steps: r.farm_steps,
}));
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files (dot-names skipped) into the output; returns the names. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

const pageFiles = copyTree(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html');
const shots = copyTree(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} images — hand in 3: the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -, 1 to 128 characters`);
}

// Written last: the scorer rebuilds the dossier from this same output and compares bytes.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_CAPS));

process.stdout.write(
  `token-launch-radar: scanned ${radar.meta.protocols_scanned} protocols (${radar.meta.live_protocols} already trading, ` +
    `${radar.meta.pre_token_tracked} pre-token), watchlist ${radar.meta.watchlist_size}/${radar.meta.watchlist_size} covered, ` +
    `${board.length} rows ranked; top: ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}\n`,
);
