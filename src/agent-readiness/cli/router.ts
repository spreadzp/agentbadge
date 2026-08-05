/**
 * SLICE-37-1: CLI Framework — Command Router & Argument Parser
 */

export interface CommandArg {
  name: string;
  required?: boolean;
  description?: string;
}

export interface CommandFlag {
  name: string;
  shortName?: string;
  type: "boolean" | "string";
  description: string;
  default?: string | boolean;
}

export interface ParsedArgs {
  positional: string[];
}

export type ParsedFlags = Record<string, string | boolean>;

export interface ParsedCommand {
  command: string;
  args: ParsedArgs;
  flags: ParsedFlags;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  outputFile?: string;
}

export type CommandHandler = (
  args: ParsedArgs,
  flags: ParsedFlags,
) => Promise<CommandResult>;

export interface CommandDefinition {
  name: string;
  description: string;
  args: CommandArg[];
  flags: CommandFlag[];
  handler: CommandHandler;
}

const COMMANDS: Record<string, CommandDefinition> = {};

export function registerCommand(cmd: CommandDefinition): void {
  if (COMMANDS[cmd.name]) {
    throw new Error(`Command "${cmd.name}" already registered`);
  }
  COMMANDS[cmd.name] = cmd;
}

export function clearCommands(): void {
  for (const key of Object.keys(COMMANDS)) {
    delete COMMANDS[key];
  }
}

export function getCommand(name: string): CommandDefinition | undefined {
  return COMMANDS[name];
}

export function getAllCommands(): CommandDefinition[] {
  return Object.values(COMMANDS);
}

export function parseArgs(
  argv: string[],
  flagDefs: CommandFlag[] = [],
): ParsedCommand {
  if (argv.length === 0) {
    return { command: "", args: { positional: [] }, flags: {} };
  }

  const command = argv[0];
  const rest = argv.slice(1);
  const positional: string[] = [];
  const flags: ParsedFlags = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];

    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      const flagDef = flagDefs.find(
        (f) => f.name === flagName || f.shortName === flagName,
      );

      if (flagDef?.type === "boolean") {
        flags[flagDef.name] = true;
      } else if (flagDef?.type === "string") {
        if (i + 1 < rest.length && !rest[i + 1].startsWith("-")) {
          flags[flagDef.name] = rest[++i];
        } else if (arg.includes("=")) {
          flags[flagDef.name] = arg.split("=")[1];
        }
      } else {
        if (arg.includes("=")) {
          const [name, value] = arg.slice(2).split("=");
          flags[name] = value;
        } else {
          flags[flagName] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      const shortName = arg.slice(1);
      const flagDef = flagDefs.find((f) => f.shortName === shortName);

      if (flagDef?.type === "boolean") {
        flags[flagDef.name] = true;
      } else if (flagDef?.type === "string") {
        if (i + 1 < rest.length && !rest[i + 1].startsWith("-")) {
          flags[flagDef.name] = rest[++i];
        }
      }
    } else {
      positional.push(arg);
    }
  }

  for (const flagDef of flagDefs) {
    if (!(flagDef.name in flags) && flagDef.default !== undefined) {
      flags[flagDef.name] = flagDef.default;
    }
  }

  return { command, args: { positional }, flags };
}

export async function runCommand(argv: string[]): Promise<CommandResult> {
  const commandName = argv.length > 0 ? argv[0] : "";
  const cmdDef = commandName ? COMMANDS[commandName] : undefined;

  if (!cmdDef) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown command: "${commandName}". Run 'agentbadge --help' for usage.`,
    };
  }

  const { args, flags } = parseArgs(argv, cmdDef.flags);

  for (const argDef of cmdDef.args) {
    if (argDef.required && args.positional.length === 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Missing required argument: ${argDef.name}\n${cmdDef.description}`,
      };
    }
  }

  try {
    return await cmdDef.handler(args, flags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Error: ${msg}` };
  }
}
