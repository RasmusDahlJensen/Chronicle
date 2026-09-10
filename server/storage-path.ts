import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Resolve existing ancestors too, so an alias cannot place saves in published/build output. */
function canonical(path: string): string {
  let ancestor = path;
  for (;;) {
    try { return resolve(realpathSync(ancestor), relative(ancestor, path)); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}
function inside(parent: string, child: string) {
  const distance = relative(parent, child);
  return distance === '' || distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance);
}
export function resolveSaveDirectory(input?: string, projectRoot = process.cwd()) {
  const directory = resolve(projectRoot, input || '.chronicle');
  const actual = canonical(directory);
  for (const name of ['public', 'dist']) {
    const protectedRoot = resolve(projectRoot, name);
    if (inside(protectedRoot, directory) || inside(canonical(protectedRoot), actual)) {
      throw new Error('CHRONICLE_DATA_DIR must be outside public/ and dist/ to preserve private saves across builds.');
    }
  }
  return actual;
}

export function assertSaveOutsideStatic(directory: string, staticRoot: string) {
  if (inside(canonical(resolve(staticRoot)), canonical(resolve(directory)))) {
    throw new Error('The simulation save directory must be outside the static frontend directory.');
  }
}
