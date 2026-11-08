// Export the owner-selected Light loom mark without redrawing or recoloring it.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'assets/branding/omnisynth-logo-original.png');
mkdirSync(join(root, '.tmp'), { recursive: true });
const output = mkdtempSync(join(root, '.tmp/app-icons-'));
try {
  execFileSync('bun', ['run', 'tauri', 'icon', source, '--output', output], { cwd: root, stdio: 'inherit' });
  // Desktop bundles use these files; keep mobile project scaffolding separate.
  for (const file of readdirSync(output)) {
    if (/\.(png|ico|icns)$/.test(file) && (process.platform === 'darwin' || !file.endsWith('.icns'))) cpSync(join(output, file), join(root, 'src-tauri/icons', file));
  }
  mkdirSync(join(root, 'build'), { recursive: true });
  // Other hosts encode ICNS differently; preserve the selected Mac bytes.
  if (process.platform === 'darwin') cpSync(join(output, 'icon.icns'), join(root, 'build/icon.icns'));
  cpSync(join(output, 'icon.png'), join(root, 'assets/branding/omnisynth-app-icon.png'));
  const mark = readFileSync(join(root, 'assets/branding/omnisynth-logo.svg'), 'utf8');
  // The white ground matches the selected original and remains visible in dark browser chrome.
  const favicon = mark.replace(/(<svg\b[^>]*>)/, '$1<rect width="1024" height="1024" fill="#fff"/>');
  writeFileSync(join(root, 'src/assets/logo.svg'), favicon);
  writeFileSync(join(root, 'build/icon.svg'), favicon);
  console.log('Updated Tauri desktop icons, browser icon and Electron build/icon.icns.');
} finally {
  rmSync(output, { recursive: true, force: true });
}
