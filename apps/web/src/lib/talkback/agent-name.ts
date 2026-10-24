/**
 * What the screen calls the agent, in the forms a sentence needs. The field
 * app's agent is Souffleur; the display study's has no name, so its views say
 * "the assistant" (`agent-name-context.tsx`).
 */
export interface AgentName {
  /** Mid-sentence: "Locked: the assistant only talks…". */
  name: string;
  /** Opening a sentence or a label: "The assistant is speaking". */
  Name: string;
  possessive: string;
  Possessive: string;
}

export function agentName(name: string): AgentName {
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  return { name, Name, possessive: `${name}'s`, Possessive: `${Name}'s` };
}
