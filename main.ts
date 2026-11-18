// Token Radar: turn a frozen DefiLlama snapshot into a ranked board.
//
// The program reads the sealed snapshot (protocols plus the watchlist),
// scores every protocol with the model in lib/model.ts, and writes the
// entry's artifacts: the ranked board, the dashboard's data file, the
// dashboard itself, its three screenshots, and the dossier the judge
// reads. It writes the same bytes on every run.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** Where this file lives: the repository root, used to find dashboard/ and screenshots/. */
const repoRoot = fileURLToPath(new URL('./', import.meta.url));

/** Caps the scorer enforces on the dossier and the screenshots. */
const LIMITS = {
  dossierTextBytes: 65_536,
  screenshots: { max: 4, maxBytes: 524_288 },
  dashboard: { maxFiles: 400, maxBytes: 4_194_304 },
};

/** Screenshot file names: letters, digits and . _ -, 1 to 128 characters. */
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Print a message to stderr and stop with the given status. */
function die(message: string, status: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(status);
}

/** The value of --name <value> on the command line, or the fallback. */
function flag(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]!;
    if (item === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (item.startsWith(`--${name}=`)) return item.slice(name.length + 3);
  }
  return fallback;
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

function main(): void {
  const inputArg = flag('input', '/input');
  const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(snapshotPath)) {
    die(`cannot find a snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const problem = boardIssue(board, snapshot);
  if (problem !== null) {
    die(`the model produced a board the gate refuses: ${problem}`, 1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));

  // Read the board back: the file the scorer reads must hold the rows just scored.
  const written = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8')) as { rows?: unknown[] };
  if (!Array.isArray(written.rows) || written.rows.length !== board.length) {
    die(`board.json holds ${Array.isArray(written.rows) ? written.rows.length : 0} rows after writing ${board.length}`, 1);
  }

  copyTree(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
  const copiedShots = copyTree(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
  if (copiedShots.length < 3) {
    die(`screenshots/ holds ${copiedShots.length} image${copiedShots.length === 1 ? '' : 's'}; hand in 3: the board, a detail view and a filtered view`, 1);
  }
  for (const shot of copiedShots) {
    if (!SHOT_NAME.test(shot)) {
      die(`screenshots/${shot}: names are letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }

  // The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, {
      text_max_bytes: LIMITS.dossierTextBytes,
      screenshots: { max: LIMITS.screenshots.max, max_bytes: LIMITS.screenshots.maxBytes },
      dashboard: { max_files: LIMITS.dashboard.maxFiles, max_bytes: LIMITS.dashboard.maxBytes },
    }),
  );

  process.stdout.write(
    `token radar: scored ${board.length} rows from ${snapshot.protocols.length} protocols (${snapshot.watchlist.length} on the watchlist; ${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${copiedShots.length} images) and ${join(outDir, 'dossier.json')}\n`,
  );
}

main();
