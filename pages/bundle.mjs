import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// All application modules now target the browser directly. The only alias is
// the project's ordinary @/ import convention; no server modules are replaced.
export const browserBuildOptions = {
  alias: { '@': root },
  resolveExtensions: ['.ts', '.mjs', '.js', '.json'],
};

export async function bundleApi(outfile, platform = 'node') {
  return build({
    ...browserBuildOptions,
    entryPoints: [resolve(root, 'pages/api.ts')],
    outfile,
    bundle: true,
    platform,
    format: 'esm',
    target: 'es2022',
    logLevel: 'warning',
  });
}
