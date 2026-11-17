// Token Radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json (or --input <file|dir>), scores
// every rankable pre-token protocol with the radar-2 model in lib/model.ts, and writes
// the ranked board to /output/board.json. It also writes the dashboard's data beside
// the page as /output/data.js, copies dashboard/ and screenshots/ into /output, and
// finishes with /output/dossier.json from the vendored make.fun library, which is the
// summary the judge reads. The program runs twice and must write the same bytes both
// times: the model is a pure function of the snapshot, and nothing here reads the
// clock, the network, or a random source.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, checkBoard, dataScript, readSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap, and the screenshot caps the gate enforces. */
const TEXT_CAP_BYTES = 65_536;
const SHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value after `--name <value>` or `--name=<value>`, or `fallback`. */
function flag(name: string, fallback: string): string {
  const args = process.argv;
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

/** Where the snapshot lives: a file, or a directory holding snapshot.json. */
function snapshotPath(): string {
  const given = flag('input', '/input');
  return given.endsWith('.json') ? given : join(given, 'snapshot.json');
}

/** Where /output lives: --output, the environment, or the grader's /output. */
function outputDir(): string {
  return flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

/** Copy a directory's regular files into `dest`, skipping dot-names; returns the names copied. */
function copyDir(from: string, dest: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(dest, name));
    names.push(name);
  }
  return names;
}

function main(): void {
  const input = snapshotPath();
  if (!existsSync(input)) {
    process.stderr.write(
      `token radar: no snapshot at ${input}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
    );
    process.exit(2);
  }
  const out = outputDir();

  const snapshot = readSnapshot(readFileSync(input, 'utf8'));
  const { board, payload } = buildRadar(snapshot);
  const problem = checkBoard(board, snapshot);
  if (problem !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${problem}\n`);
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(payload));

  const dashFiles = copyDir(join(root, 'dashboard'), join(out, 'dashboard'));
  const shots = copyDir(join(root, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(
      `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
    );
    process.exit(1);
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: TEXT_CAP_BYTES,
      screenshots: SHOT_LIMIT,
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${payload.early_size} early, ${payload.live_size} live set aside)\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

main();
