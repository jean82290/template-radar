// Remembers which repositories were already reported, in a JSON file on a Railway volume.
// Without a volume the radar still works; every pick is then shown as new.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function loadState(file, log = console) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return { reported: data.reported || {}, runs: data.runs || [] };
  } catch (err) {
    if (err.code !== 'ENOENT') log.error?.(`[state] could not read ${file}: ${err.message}`);
    return { reported: {}, runs: [] };
  }
}

export async function saveState(file, state, log = console) {
  try {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, file);
    return true;
  } catch (err) {
    log.error?.(`[state] could not save ${file} (no volume mounted?): ${err.message}`);
    return false;
  }
}

// Forget reports older than 180 days so the file stays small.
export function prune(state, now = new Date()) {
  const cutoff = now.getTime() - 180 * 86400000;
  for (const [k, v] of Object.entries(state.reported)) {
    if (new Date(v.firstReported).getTime() < cutoff) delete state.reported[k];
  }
  state.runs = state.runs.slice(-52);
  return state;
}
