/**
 * What the agent knows, independent of which framework is speaking.
 *
 * Extracted out of `apps/agent` so the LiveKit and Pipecat backends share ONE
 * retrieval implementation rather than two that drift. That matters twice over:
 * a second copy would be a second thing to keep correct, and while the two
 * backends are being compared, any difference in what they can recall would be
 * a confound in the comparison rather than a property of the framework.
 *
 * The Python side reaches this through `/api/realtime/context` instead of
 * reimplementing it — same code, same ledger, same echo filtering.
 */
export { buildContextMessage } from "./context";
export {
  contentWords,
  describeWhen,
  loadDriveSoFar,
  searchTranscripts,
  type Passage,
} from "./retrieval";
export { keptIndices, withoutEcho } from "./echo";
