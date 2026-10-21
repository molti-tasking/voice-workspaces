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
export {
  MAX_BOARD_CHARS,
  buildBoardContext,
  type BoardContext,
} from "./board-context";
export {
  MAX_DRAFT_CONTEXT_CHARS,
  buildDraftContext,
  draftHandle,
  type DraftContext,
  type DraftForContext,
} from "./draft-context";
export { SUMMARY_PROMPT, foldSummary, summaryPromptFor } from "./summary";
export { SETTLED_PROMPT, TITLE_PROMPT } from "./title";
export {
  ANSWER_ACKNOWLEDGEMENTS,
  ANSWER_RETRY_NUDGE,
  BOARD_EDITING,
  FLOOR_OPEN_NOTE,
  OUTPUT_CONTRACT,
  READING_SECTION,
  POKE_FALLBACKS,
  POKE_NUDGE,
  POKE_RETRY_NUDGE,
  SEARCH_WAIT_PHRASES,
  SILENCE_TOKEN,
  SPARK_FALLBACKS,
  SPARK_KINDS,
  SPARK_NUDGES,
  SPARK_OFFER_GISTS,
  SPARK_RETRY_NUDGE,
  SPARKS_NONE_ON_OFFER,
  SYSTEM_PROMPT,
  TALKBACK_CONFIG_VERSION,
  answerAcknowledgement,
  cleanReply,
  composeSystemPrompt,
  isSilence,
  pokeFallback,
  searchWaitPhrase,
  renderSparksOnOffer,
  sparkFallback,
  sparkText,
  type ComposeInputs,
  type SparkKind,
  type ComposedPrompt,
} from "./prompt";
export {
  PROACTIVITY_STANZAS,
  PROACTIVE_AFTER_SECS,
  PROFILE,
  type ConversationProfile,
  type Density,
  type Proactivity,
} from "./profile";
export {
  DEFAULT_VOICE_ID,
  VOICES,
  VOICE_IDS,
  asVoiceId,
  isKnownVoice,
  nativeVoicesByLanguage,
  voiceFor,
  voiceProfile,
  voicesForPicker,
  type VoiceProfile,
} from "./voice";
export { SCREENS, STUDY_SCREEN, isScreen, renderScreen, screenFor, type Screen } from "./screen";
export { capabilitiesSection, type DriveCapabilities } from "./capabilities";
export { isTimeZone, localDate, renderLocalTime, timeZoneOf } from "./clock";
export { RECENT_DRIVES_SHOWN, renderRecentDrives, type RecentDrive } from "./recent-drives";
export {
  STT_LANGUAGES,
  STT_LANGUAGE_CODES,
  asSttLanguage,
  isKnownSttLanguage,
  sttLanguageProfile,
  type SttLanguageProfile,
} from "./language";
export {
  BOARD_TOOLS,
  BOARD_TOOL_NAMES,
  boardEditFromToolCall,
  type BoardToolName,
  type ToolDefinition,
} from "./board-tools";
export {
  SEARCH_OUTAGE_ERROR,
  WEB_SEARCH_TOOL,
  WEB_SEARCH_TOOL_NAME,
  searchOutage,
  searchResultForModel,
  searxngRequest,
  webSearchFromToolCall,
  webSearchSection,
  type SearchResultForModel,
} from "./web-search";
export {
  recordAgentDecision,
  recordAgentTurn,
  recordFloorEvent,
  type AgentDecisionOutcome,
  type AgentDecisionRecord,
  type AgentDecisionTrigger,
  type AgentTurnRecord,
  type FloorEventKind,
  type FloorEventRecord,
} from "./agent-turns";
export {
  contentWords,
  describeWhen,
  loadDriveSoFar,
  searchConversations,
  searchTranscripts,
  type Passage,
  type TranscriptHit,
} from "./retrieval";
export { containment, isEcho, keptIndices, withoutEcho } from "./echo";
export {
  DEFAULT_STUDY_TASK,
  PROLIFIC_TASKS,
  SESSION_TASKS,
  isStudyTaskId,
  sessionTaskFor,
  studyTaskFor,
  type SessionTask,
  type StudyTask,
  type StudyTaskId,
} from "./study-task";
export { SESSION_PROFILE, SESSION_SYSTEM_PROMPT, STUDY_PROFILE, STUDY_SYSTEM_PROMPT } from "./study-agent";
export {
  SPARK_QUESTION_MAX_CHARS,
  cleanSparkQuestion,
  sparkQuestionMessages,
  type SparkLine,
} from "./spark-question";
export { SPARK_QUESTION_NUDGE, sparkQuestionText } from "./prompt";
export {
  MIRROR_MAX_BULLETS,
  mirrorMessages,
  parseMirrorBullets,
  type MirrorBullets,
} from "./mirror";
