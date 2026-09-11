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
export {
  buildContextPassages,
  buildTurnContext,
  loadDriveSoFarText,
  type ContextPassage,
  type ContextThread,
  type TurnContext,
} from "./context";
export {
  contentHash,
  cutPassages,
  mergePassages,
  renderTopicForMemory,
  type CutOptions,
  type MemoryPassage,
  type MemoryUtterance,
} from "./memory";
export { QUERY_TIMEOUT_MS, recallFromMemory, type MemoryRecall, type Thread } from "./memory-search";
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
  PROACTIVITY_STANZAS,
  SETTINGS,
  SETTING_PROFILES,
  asSetting,
  settingProfile,
  type Proactivity,
  type Setting,
  type SettingProfile,
} from "./setting";
export {
  DEFAULT_VOICE_ID,
  VOICES,
  VOICE_IDS,
  asVoiceId,
  isKnownVoice,
  voiceProfile,
  type VoiceProfile,
} from "./voice";
export {
  STT_LANGUAGES,
  STT_LANGUAGE_CODES,
  asSttLanguage,
  isKnownSttLanguage,
  sttLanguageProfile,
  type SttLanguageProfile,
} from "./language";
export { recordAgentTurn, type AgentTurnRecord } from "./agent-turns";
export {
  contentWords,
  describeWhen,
  loadDriveSoFar,
  searchTranscripts,
  type Passage,
} from "./retrieval";
export { keptIndices, withoutEcho } from "./echo";
