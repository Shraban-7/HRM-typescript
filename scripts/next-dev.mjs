import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
let port = process.env.PORT || '3000';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-p' || arg === '--port') {
    if (args[i + 1]) port = args[i + 1];
  } else if (arg.startsWith('--port=')) {
    port = arg.slice('--port='.length);
  }
}

const nextBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'next');
const child = spawn(nextBin, ['dev', '-p', port, '-H', '0.0.0.0'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: port },
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
