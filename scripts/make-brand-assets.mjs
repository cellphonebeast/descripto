import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('next/package.json'))('sharp');
const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'public/brand/descripto-app.svg');
const build = path.join(root, 'build');
const iconset = path.join(build, 'Descripto.iconset');
await fs.mkdir(iconset, { recursive: true });
await sharp(source).resize(1024, 1024).png().toFile(path.join(build, 'icon.png'));
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    await sharp(source).resize(size * scale, size * scale).png().toFile(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
  }
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(build, 'icon.icns')]);
console.log('Generated Descripto PNG and macOS icons from the SVG master.');
