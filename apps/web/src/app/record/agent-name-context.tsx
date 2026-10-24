"use client";

import { createContext, useContext, useMemo } from "react";
import { agentName, type AgentName } from "@/lib/talkback/agent-name";

/**
 * The agent's name for the conversation views, which the field app and the
 * display study share. Souffleur unless a page says otherwise: the study's
 * session wraps its view in `<AgentNameProvider name="the assistant">`, so a
 * participant never sees a name the system was given by its researchers.
 */
const AgentNameContext = createContext<AgentName>(agentName("Souffleur"));

export function AgentNameProvider({ name, children }: { name: string; children: React.ReactNode }) {
  const value = useMemo(() => agentName(name), [name]);
  return <AgentNameContext.Provider value={value}>{children}</AgentNameContext.Provider>;
}

export function useAgentName(): AgentName {
  return useContext(AgentNameContext);
}
