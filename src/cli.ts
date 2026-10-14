#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { registerCommands } from './cli/commands.js';
import { helpByDefault, printError } from './cli/output.js';
import { RcatError } from './core/errors.js';
import { redact, registerSecrets } from './core/accounts.js';

// Every byte the CLI writes (results, errors, commander's own messages, help) goes through `redact`.
registerSecrets();
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => write(typeof chunk === 'string' ? redact(chunk) : chunk, ...rest)) as typeof stream.write;
}

const json = process.argv.includes('--json');
const program = helpByDefault(
  new Command('rcat').description('Read RevenueCat analytics across several projects').version('0.1.0'),
);
registerCommands(program);

/** Commander reports its own errors (unknown option, missing argument, unknown command) by throwing; none of them exits by itself. */
function configure(command: Command): void {
  command.exitOverride();
  // With --json the error is printed as JSON below, so commander's text stays quiet.
  command.configureOutput({ writeErr: (text) => { if (!json) process.stderr.write(text); } });
  command.commands.forEach(configure);
}
configure(program);

try {
  await program.parseAsync();
} catch (error) {
  if (!(error instanceof CommanderError)) throw error;
  process.exitCode = error.exitCode;
  if (error.exitCode !== 0 && json) {
    // `rcat help <unknown>` fails with commander's internal placeholder "(outputHelp)" instead of a message.
    const message = error.code === 'commander.help' ? `unknown command '${program.args.slice(1).filter((a) => !a.startsWith('-')).join(' ')}'` : error.message.replace(/^error: /, '');
    printError(new RcatError(message, { code: 'E_BAD_ARGUMENT', hint: 'Run `rcat --help` for usage.' }), { json: true });
  }
}
