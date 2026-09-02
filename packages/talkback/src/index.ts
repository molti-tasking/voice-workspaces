/**
 * What the agent knows, independent of what is doing the talking.
 *
 * This was extracted so two competing backends could share ONE retrieval
 * implementation while they were being compared. That comparison is over —
 * Pipecat won and `apps/agent` is gone — but the split earned its keep for a
 * second reason: the Python container reaches this over HTTP
 * (`/api/realtime/context`, `/api/realtime/session`) rather than
 * reimplementing it, so there is still exactly one copy of the code that
 * decides what the agent can remember.
 */
export { buildContextPassages, loadDriveSoFarText, type ContextPassage } from "./context";
export { MAX_CONTEXT_CHARS, trimToBudget } from "./budget";
export { SUMMARY_PROMPT, foldSummary } from "./summary";
export {
  OUTPUT_CONTRACT,
  SILENCE_TOKEN,
  SYSTEM_PROMPT,
  TALKBACK_CONFIG_VERSION,
  cleanReply,
  composeSystemPrompt,
  isSilence,
  type ComposeInputs,
  type ComposedPrompt,
} from "./prompt";
export {
  DEFAULT_SETTING,
  SETTINGS,
  SETTING_PROFILES,
  asSetting,
  settingProfile,
  type Setting,
  type SettingProfile,
} from "./setting";
export { recordAgentTurn, type AgentTurnRecord } from "./agent-turns";
export {
  contentWords,
  describeWhen,
  loadDriveSoFar,
  searchTranscripts,
  type Passage,
} from "./retrieval";
export { keptIndices, withoutEcho } from "./echo";
