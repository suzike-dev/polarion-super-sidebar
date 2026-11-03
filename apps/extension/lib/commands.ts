export type LocalCommand = { name: string; description: string; aliases: string[]; builtin: boolean };

/** Search the complete native catalog; never synthesize executable commands. */
export function filterCommands<T extends LocalCommand>(commands: readonly T[], query: string): T[] {
  const terms = query.trim().replace(/^\//, '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter(command => {
    const haystack = [command.name, command.description, ...command.aliases].join(' ').toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}

export function slashQuery(input: string): string | null {
  return /^\/[^\r\n]*$/.test(input) ? input.slice(1) : null;
}
