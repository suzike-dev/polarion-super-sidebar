export type LocalCommand = { name: string; description: string; aliases: string[]; builtin: boolean };

/** Search the complete native catalog; never synthesize executable commands. */
export function filterCommands<T extends LocalCommand>(commands: readonly T[], query: string): T[] {
  const normalized=query.trim().replace(/^\//, '').toLocaleLowerCase();
  const terms = normalized.split(/\s+/).filter(Boolean);
  const score=(command:LocalCommand)=>{const names=[command.name,...command.aliases].map(n=>n.toLocaleLowerCase());return names.includes(normalized)?0:names.some(n=>n.startsWith(normalized))?1:names.some(n=>n.includes(normalized))?2:3;};
  return commands.filter(command => {
    const haystack = [command.name, command.description, ...command.aliases].join(' ').toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  }).sort((a,b)=>score(a)-score(b));
}

export function commandNameMatches(command:LocalCommand,query:string){const q=query.trim().replace(/^\//,'').toLocaleLowerCase();return [command.name,...command.aliases].some(n=>n.toLocaleLowerCase().startsWith(q));}

export function slashQuery(input: string): string | null {
  return /^\/[^\r\n]*$/.test(input) ? input.slice(1) : null;
}
