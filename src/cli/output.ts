import type { Command } from 'commander';
import { redact } from '../core/accounts.js';
import { RcatError } from '../core/errors.js';

export interface OutputOptions<T = unknown> {
  json?: boolean;
  /** How the value reads to a person; without it a scalar is printed as text and anything else as one line of JSON. */
  text?: (value: T) => string;
}

export interface ErrorOptions {
  json?: boolean;
  verbose?: boolean;
}

/** The single result of a command on stdout: one JSON line with `--json`, text otherwise. */
export function printResult<T>(value: T, opts: OutputOptions<T> = {}): void {
  if (opts.json) console.log(JSON.stringify(value));
  else if (opts.text) console.log(opts.text(value));
  else console.log(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));
}

/** A failure: with `json` as `{"error":{"code","message","hint"}}` on stdout, otherwise `error: …` (and the hint) on stderr. */
export function printError(err: unknown, opts: ErrorOptions = {}): void {
  if (opts.json) {
    const known = err instanceof RcatError;
    const message = redact(err instanceof Error ? err.message : String(err));
    console.log(JSON.stringify({ error: { code: (known && err.code) || 'E_UNEXPECTED', message, hint: (known && err.hint) || null } }));
    return;
  }
  if (err instanceof RcatError) {
    console.error(`error: ${redact(err.message)}`);
    if (err.hint) console.error(redact(err.hint));
  } else {
    console.error(`error: ${redact(String((err as Error).message ?? err))}`);
  }
}

/**
 * The program run without a command prints its help and does nothing else; a mistyped command is reported
 * by name (commander would otherwise answer with "too many arguments").
 */
export function helpByDefault(group: Command): Command {
  const createSubcommand = group.command.bind(group) as (...args: unknown[]) => Command;
  group.command = ((...args: unknown[]) => {
    const subcommand = createSubcommand(...args);
    return subcommand === group ? group : subcommand.allowExcessArguments(false);
  }) as Command['command'];

  return group
    .helpCommand(true)
    .allowExcessArguments()
    .allowUnknownOption()
    .action(() => {
      const first = group.args[0];
      if (first === undefined) group.help();
      if (first.startsWith('-')) group.error(`error: unknown option '${first}'`);
      const names = group.commands.map((command) => command.name());
      group.error(`error: unknown command '${first}'${names.length ? `\n(Commands: ${names.join(', ')})` : ''}`);
    });
}

/** The words of the command line, for the cases where the parsed options no longer show how they were written. */
function rawArguments(command: Command): string[] {
  let root = command;
  while (root.parent) root = root.parent;
  return (root as unknown as { rawArgs?: string[] }).rawArgs ?? [];
}

/**
 * Commander hands an option that takes a value whatever comes next, even another flag: `--from --json` would
 * set the date to "--json" and print text. A value that looks like a flag is reported instead; when the flag
 * that was swallowed is `--json`, the report is made the way it asks for. Written with `=` the value is taken as it is.
 */
export function refuseSwallowedFlags(command: Command): void {
  const opts = command.opts() as Record<string, unknown>;
  const words = rawArguments(command);
  for (const option of command.options) {
    const name = option.long ?? option.flags;
    const values = [opts[option.attributeName()]].flat();
    const flag = values.find((value): value is string => typeof value === 'string' && /^--[A-Za-z]/.test(value) && !words.includes(`${name}=${value}`));
    if (flag === undefined) continue;
    if (flag === '--json') command.setOptionValue('json', true);
    throw new RcatError(`${name} needs a value, but is followed by ${flag}.`, {
      code: 'E_BAD_ARGUMENT',
      hint: `Put the value right after the option. If the value really is "${flag}", write ${name}=${flag}`,
    });
  }
}
