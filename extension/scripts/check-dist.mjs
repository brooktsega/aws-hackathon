// Fails the build if dist/ is missing a file the manifest refers to.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));

const referenced = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
].filter(Boolean);

const missing = referenced.filter((p) => !existsSync(resolve(dist, p)));
if (missing.length > 0) {
  console.error('manifest.json references missing files:', missing.join(', '));
  process.exit(1);
}
console.log(`Manifest OK: ${referenced.length} referenced files present.`);
