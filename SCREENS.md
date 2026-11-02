# Screens: how they came, how they went, and where they are now

Written 2 Nov 2026, when the app was consolidated onto one screen. Dates come from the commit log.

## Now (2 Nov 2026)

**One screen: the conversation on `/record`.** A signed-in home page goes straight there.

- **The display study's talk screen, made the everyday one.** The same `max-w-2xl` column as `block-talk.tsx`, a slim tinted bar at the top and the conversation filling the rest. The frame is the same before, during and after a drive: before the first one, the empty conversation holds the large Record target with voice and language; from then on it is the conversation.
- **The bar** holds the recording badge (or "Ended"), the warning pills, the view switch, the `⋯` menu, and one round button at the right end: Stop during a drive and Record after it, in the place the study's Finish was.
- **Stack** is the default view. **Transcript** (the `chat` display) is the only other one on the switch.
- **The `⋯` menu** beside the switch holds:
  - the five study views (Topics, Uptake, Now, Open, Recent);
  - the *Rethink checks* toggle (draft);
  - links to Past conversations and to the older Workspace, Board and Timeline pages.
- **No dock on `/record`.** It stays on the other pages, where it is the record button that opens `/record`.
- **Gone from the screen:** Lock / Normal / Poke (a drive on `/record` always starts with the floor open), the time bar, the ratings after a drive, and the "Saved" panel.
- **Tapping a topic** opens its sheet. The sheet has:
  - the conversation's own points on the topic;
  - the assistant's ideas, each marked taken up or not;
  - **what the workspace holds on that topic, from every drive** (tasks with their state, claims, open questions, facts);
  - the comprehension monitor's findings (draft).
  - During a drive, one tap ("Ask me") hands the topic, a workspace question or a check to the agent. The agent asks it back and does not answer it.

## How it got here

| When | What came or went | Why |
|---|---|---|
| Aug 2026 | Capture, the transcript of each session, `/timeline` and `/workspace`, with the workspace folded from the op log (`workspace_op`) across all drives. | The starting idea: the transcript answers "what did I say", the workspace answers "what do I currently think about X". |
| 2 Sep | `/trajectory` (the workspace at every moment) and `/repertoire` (learned voice capabilities). | Ways to read the corpus afterwards, and to measure the voice-studio idea. |
| 7 Sep | `/board`: tasks as kanban columns, gated per participant by `board_enabled_at`. | A before/after study phase on task management. |
| 13 Sep | The dock (Workspace · Record · Board) and a recorder that outlives the route. | A drive should survive walking over to the board and back. |
| 28 Sep | The session list folded into the timeline. The workspace now leads with recently touched topics. | "Too many different screens", and "all of it is too much for me" about eleven equal topic cards. |
| 7 Oct | `/conversations`, which replaced Timeline in the dock. | "The tool does not allow me to view my past transcripts easily." |
| 17–20 Oct | Sparks, Keep, Recall and My week. The sparks study moved to Prolific (`/p`). | The metacognition line of work: what the person actually holds. |
| 21–24 Oct | The display study: interruption game, forced views, a blind judge. | The IMWUT comparison of how the conversation is shown. |
| 25 Oct | One conversation model with five views (Chat, Topics, Uptake, Now, Open), a shared time bar and topic sheet. Past conversations replay through the same component and can be continued. | Four separate view components, plus a separate past-conversation page, had drifted apart. |
| 27 Oct | The sparks row left the recorder screen. Recent was added. | One more thing to read beside the conversation. |
| 28–29 Oct | Stack, from the design canvas: live words at the bottom, the current topic, and earlier topics on a shelf, with a return as the only motion. | The topic-stack design (project doc `related-work-topic-stack.md`). |
| 30–31 Oct | Prolific run 2 compares Chat and Stack. | The main study for the paper. |
| 2 Nov | Consolidation: Stack plus Transcript on one screen, with the workspace inside the topic sheet. Comprehension monitor drafted. | This document. |
| 2 Nov | The study's talk screen as the frame of `/record`: its column, a slim bar with Record/Stop, the same before, during and after a drive. Lock/Poke, the time bar, the post-drive ratings and the dock left the screen. | At the desktop width the Stack's topics drifted to opposite edges; the screen changed shape between talking and not; too many boxes after a drive. |

## What was kept but not developed

- `/workspace`, `/board`, `/timeline`, `/trajectory` and `/repertoire` still work. They are reachable from the `⋯` menu or the account menu on other pages.
- The study routes (`/study`, `/p`, `/recall`, `/my-week`, `/survey`, `/researcher`) are unchanged. A drive whose study condition fixes the view still gets exactly that view, with no switch, no menu and no monitor.
- The five other views still exist for the study setups (`CONVERSATION_DISPLAYS`), and the researchers' page names them as before.

## The comprehension monitor (draft)

This is a second process beside the conversation. It looks at a topic once the topic has had about 60 words of talk. It looks again when the person leaves the topic with new lines since the last look, or while the topic is current once it has grown by 120 words. For each look it sends the topic's lines and the local signals (word share, hesitation, settled, restated) to `/api/realtime/comprehension`.

The model returns:

- each idea on the topic, marked **held** (restated with something added), **borrowed** (accepted or repeated only) or **shaky**, with the evidence;
- one **check**, which is a small cognitive forcing function. There are four kinds:
  - *explain it back*;
  - *predict* a concrete case;
  - *argue against it*;
  - *commit first*, before any recommendation.

What the person sees:

- A topic with something to rethink gets a small spark after its name in the stack. It is colour only and never moves.
- The topic's sheet shows the ideas and the check under "Rethink".

During a drive, "Ask me" sends the check through the same poke a pulled spark uses. Nothing is spoken unless the person pulls it, and nothing is stored beyond the agent turn that asks it.

- Code: `packages/talkback/src/comprehension.ts` (prompt and parser), `apps/web/src/lib/talkback/comprehension-monitor.ts` (when to look, and what to send), `use-comprehension.ts` (the hook) and `topic-sheet.tsx` (the display).
- The simulated conversation (`/record/demo`) shows scripted findings, with no AI involved.

Open points:

- The checks travel as the nearest spark kind. The spark enum in the database has no check kinds yet.
- Whether a check was pulled is not logged separately.
- The prompt has not been evaluated against real drives.
- The hesitation signal reaches the model as evidence only, because it also indexes load.
