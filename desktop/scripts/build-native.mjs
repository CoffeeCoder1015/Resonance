import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log('Skipping the Windows native helper build on this platform.');
  process.exit(0);
}

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const outputDirectory = path.join(desktopRoot, 'native', 'bin');
const outputPath = path.join(outputDirectory, 'resonance-paste.exe');
const sourcePath = path.join(desktopRoot, 'native', 'windows-paste.c');
const compiler = process.env.RESONANCE_CC || 'gcc';

mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(
  compiler,
  [
    '-std=c11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-municode',
    sourcePath,
    '-o',
    outputPath,
    '-luser32',
    '-lgdi32'
  ],
  {
    cwd: desktopRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true
  }
);

if (result.error) {
  console.error(
    `Failed to start ${compiler}. Install MinGW-w64 GCC or set RESONANCE_CC to a compatible compiler.`
  );
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Built native helper: ${outputPath}`);
