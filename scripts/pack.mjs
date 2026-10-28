import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('dist', { recursive: true });
const output = 'dist/Codex-Reset-0.2.0-插件上传包.zip';
await rm(output, { force: true });
execFileSync('zip', ['-qr', `../${output}`, '.', '-x', '*.DS_Store', '__MACOSX/*'], { cwd: 'extension' });
console.log(output);
