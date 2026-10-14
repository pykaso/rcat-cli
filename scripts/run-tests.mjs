// `npm test`: runs every compiled test with a temporary directory of its own as TMPDIR and removes it
// afterwards, so the state directories the tests make do not pile up in the system's temporary directory.
// Arguments are passed on to `node --test` (npm test -- --test-reporter=tap). The exit code is the tests'.
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rcat-cli-tests-')));
const remove = () => rmSync(dir, { recursive: true, force: true });
const tests = spawn(process.execPath, ['--test', ...process.argv.slice(2), 'dist/**/*.test.js'], { stdio: 'inherit', env: { ...process.env, TMPDIR: dir } });
// An interrupt reaches the tests as well (same process group); this process waits for them and cleans up.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => tests.kill(signal));
tests.on('error', (error) => {
  remove();
  console.error(error.message);
  process.exit(1);
});
tests.on('exit', (code, signal) => {
  remove();
  process.exit(code ?? (signal ? 1 : 0));
});
