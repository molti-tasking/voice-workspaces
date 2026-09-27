# Evaluation drive 01, and what it changed

27 September 2026: a 13:33 drive recorded to evaluate the system itself, with
feedback given aloud. It had 82 chunks and 39 agent turns, and the transcript
has 0 utterances. It ran German, then English, with three speaker tags.

**The recording's own ledger failed completely.** All 82 chunks came back
`415 Failed to decode audio. The provided file type is not supported.` The
live conversation ran on its own STT, so the agent heard everything while
nothing was written down.

## What shipped

| What happened on the drive | Cause | Fix |
|---|---|---|
| 82 of 82 chunks failed with a 415 | The part's Content-Type was `audio/webm;codecs=opus`, and nothing on our side had changed | Only the container type is sent upstream (`containerType`, `transcribe.ts`) |
| The banner said the audio "can be retried", but nothing could retry it | `failed` chunks were never looked at again | Retry button → `POST /api/capture-sessions/[id]/retry` |
| "I've added that to your notes", "I'll report this as a second bug": seven turns that wrote nothing | The no-claim rule only covered the board | `WHAT YOU CANNOT DO` now covers noting, saving and reporting (talkback-16) |
| The transcript could not tell a turn that wrote a draft from one that claimed to | Drafts are inline tags, not tool calls | Such turns now carry `write_draft` / `revise_draft` in `toolCalls` |
| A second draft on the same subject, instead of an addition to the first | Revising was only for an explicit "change that draft" | Adding a point to something already kept is now revising it |
| The web was searched for "the Magna Center", a mishearing | Nothing said the transcript mishears | A mishearing rule, and a matching rule in the search section |
| "Du könntest die Nachricht an die Kunden entwerfen", three times before saying which message | "Answer only what was just said" | Name the actual thing; the context block now says to use the background |
| Two spoken replies to one utterance (6:49, 8:27) | Pipecat's second inference for the same words spoke as well | `SilenceGate` does not release a second reply for a moment already answered, unless a tool was called |
| "Sorry, I lost that. Say it again." said to someone mid-thought | A decline by Pipecat's own inference was taken for the re-run declining | The acknowledgement is only for the re-run itself; the re-run is skipped once the moment has settled |
| A draft in a reply the person talked over was lost | The interruption dropped all of the text | A draft whose closing tag had arrived is kept |
| Back on the conversation view mid-drive: "suddenly empty", "all the notes are gone" | Cues, drafts and the trail were page state | Held with the recorder above the router, in one stream per drive |
| "It should be listed under the drafts": nothing on screen was called that | The panel had no heading | A heading with a count, and a drafts link in the sticky header |
| An animation "over and over" on the timeline | A sideways move counted as forward: a full-screen sheet rise | Moves at the same depth are a plain cut |
| The timeline spinner never went away | The load-more sentinel was never remounted | Keyed by page |
| Asked for: a persistent header with the current topic | — | `LiveDriveBar` on every other screen during a drive |

## To do after deploying

- **Retry this drive's chunks.** Their audio is still stored. Open the session
  page and press *Retry transcription*.
- **If they fail again,** the ASR server rejects WebM outright rather than the
  codec parameter. Run `ffprobe` on one stored `.webm`, then `curl` it at
  LiteLLM with `type=audio/webm` and with `.ogg`/`.m4a` to find which one it
  accepts. Fix the server's allowlist, or transcode to WAV in the worker.
  Nothing in this repo could reach the endpoint to settle it.

## Deferred

- **A runtime guard for claimed actions.** The prompt rule is the fix for now.
  A `ClaimGuard` beside `AnswerGuard` could also re-run a turn that says
  "added/noted/reported" with no draft or tool behind it. Worth building if
  talkback-16 still claims on the next drive.
- **Proactivity**, "you should think for me". It needs its own design pass
  against the offer engine and the study arms, not a prompt line.
- **Mixed-language drives.** On auto-detect the running summary and the fixed
  phrases stay English. The dominant language from `LanguageFollower` could pin
  both.
- **"Sorry, I lost that"** still blames a connection that was never lost.
  Better wording is a study decision, because the phrase is pinned on both sides.
- **Turn 36, cut off after "I've been".** Not established whether it was a
  barge-in or text followed by a tool call. Check `barged_in` and
  `generated_text` on that row.
- **Pre-existing test failure:** `test_a_degraded_drive_says_so_and_a_missing_version_does_not_vanish`
  in `test_bot.py` expects an `unknown` Langfuse tag. It fails the same way
  without these changes.
