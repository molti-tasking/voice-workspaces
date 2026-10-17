/**
 * What the system is, and how it takes a turn.
 *
 * Lives here rather than in an app because there is no longer an app that owns
 * it: the LiveKit agent that used to hold this file is gone, and the Pipecat
 * container fetches the composed prompt over HTTP from
 * `/api/realtime/session`. Keeping it in the shared package is what lets that
 * route compose it — see `composeSystemPrompt`, which layers the driver's
 * persona and repertoire on top of the base text below.
 *
 * Pure: no I/O, no model call, fully testable.
 */

import { PROACTIVITY_STANZAS, PROFILE, type ConversationProfile } from "./profile";

/**
 * Bumped when the prompt changes, so a drive's turns stay interpretable later.
 *
 * talkback-8 changes no text in this file. It marks two things a turn can no
 * longer be read without: the pending-confirmation ask in the context block
 * now has a second wording once the agent has asked already (see
 * `Recall._compose` and eval/messages.ts), and every turn and decision from
 * here on carries this version, because the container echoes it on each write.
 *
 * talkback-9 answers two pilot drives on 15 Sep 2026. Told "The board updates
 * itself from their speech", the agent turned it into "Got it, I'll mark that
 * as dropped", then "the board will update once the session ends" and "Yes, I
 * am sure" — about a card extraction never moved. The board section now
 * forbids promising, timing or vouching for a board change, and names the two
 * gestures that do work. On the other drive, at a desk, it offered to read a
 * markdown file "pasted into the chat on your screen", which does not exist;
 * speech is now stated as the only way in. And "can I repeat the question?"
 * (a mistranscribed request) got "Go ahead."
 *
 * talkback-10 gives the agent the board. Where the board is enabled, the
 * session composes BOARD_EDITING into the prompt and hands the container four
 * tools (board-tools.ts); the base prompt now forbids claiming a board change
 * only when no tool reported one, rather than forbidding board changes.
 *
 * talkback-11 gives the agent web search. Where `SEARXNG_URL` is set, the
 * session composes `webSearchSection` into the prompt and offers `search_web`
 * (web-search.ts); the container speaks the call's announcement and plays a
 * cue while it runs.
 *
 * talkback-12 lets the agent REVISE a draft it has already written. Until now
 * it could write one and then had no idea it had: on the 17 Sep drive, asked to
 * change the prompt it had just produced, it wrote a SECOND card, and the
 * person said so out loud ("I wanted you to have updated the evaluation use
 * case prompt, but instead you just gave me updated use case prompt"). The turn
 * context now carries this drive's drafts with a short handle each (see
 * `draft-context.ts`), and the keep section below gains `revises="…"`: the
 * whole new text against a named draft, which the write path turns into the
 * next VERSION of it rather than a new row. The handle is wire format, and the
 * contract says so — speaking it aloud is the same failure class as reading
 * `<silence>` out in a car.
 *
 * talkback-13 answers the first formative pilot (19 Sep 2026). The agent asked
 * "Soll ich die genauen Zeiten für einen davon suchen?", the participant said
 * "Ja.", and the model replied `<silence>`. Forty seconds later she asked "Und
 * dann?"; that was declined too, and she stopped the recording and asked out
 * loud whether the app had died. WHEN TO SPEAK said only that a question put
 * to the agent is always answered — the converse, that an answer to the
 * agent's OWN question is always acted on, was missing, and nothing tracked
 * that the last spoken turn had asked something. The rule is below, and
 * `SilenceGate` no longer trusts the decline in that position: it re-runs the
 * completion once with `ANSWER_RETRY_NUDGE` and, failing that, speaks
 * `ANSWER_ACKNOWLEDGEMENTS`.
 *
 * It also names the phrases the container speaks with no completion behind
 * them: that acknowledgement, and the keep-alive said while a search the agent
 * has already announced is still running (`SEARCH_WAIT_PHRASES`). Both reach
 * the speaker, so both are written to `agent_turn` like any other turn.
 *
 * talkback-14 takes the SETTING out. Four profiles keyed on where the person
 * was — driving, walking, hands busy, at a desk — chose the reply cap, the
 * proactivity level, whether the screen could be mentioned and how dense it
 * was; inferring, correcting, storing and explaining that had become most of
 * what the recorder was. One profile now (`PROFILE` in profile.ts), and the
 * question of where and when people use this is asked on `/survey`.
 *
 * talkback-15 answers the pilot feedback of late Sep 2026. Danish, German and
 * Spanish speakers heard every reply with an English accent: TTS is now told
 * the drive's language (bot.py `LanguageFollower`), and HOW TO SPEAK says to
 * answer in the language they last spoke rather than drifting to English.
 * A draft may now name the topic it belongs to (`topic="…"`), so it is filed
 * on that topic in the workspace instead of vanishing with the live view.
 * And the agent is now told WHICH SCREEN they have open (screen.ts): it had
 * been directing a pilot to drag cards on a screen with no cards, and calling
 * a list "on your screen" when it was not.
 *
 * talkback-16 answers the evaluation drive of 27 Sep 2026, where the person
 * gave feedback on the system itself and asked for it to be noted. The agent
 * said "I've added that to your notes", "I'll report this as a second bug" and
 * "I've only reported them internally" on seven turns that wrote nothing; the
 * rule against claiming an action covered the board only, and now covers
 * anything noted, saved or reported. Asked to note more, it started a second
 * draft on the same subject instead of adding to the first, so adding a point
 * to a draft is now named as revising it. It searched the web for "the Magna
 * Center", a mishearing, and answered "Du könntest die Nachricht an die Kunden
 * entwerfen" three times before saying which message: WHAT YOU CAN SEE now
 * says the transcript mishears, and HOW TO SPEAK says to name the thing.
 *
 * talkback-17 answers the drive of 28 Sep 2026. Asked how to see the last
 * discussion, the agent sent the person to the conversation view, which shows
 * nothing from earlier drives: the turn context now carries WHERE THINGS ARE
 * (screen.ts). "Show me the list of the most urgent topics, put it on the
 * screen" got one spoken task; showing and putting on the screen now mean a
 * draft. And it answered two consecutive fragments with the same sentence and
 * then asked four questions in a row of someone telling it the interface was
 * too much ("which screen is least useful?" — "I don't know"): it no longer
 * repeats itself or asks twice running.
 *
 * talkback-18 answers the drive of 29 Sep 2026. Having dropped a task, the
 * agent told the person to remove it from the workspace by hand — the
 * workspace now redraws when the op log moves (`OpLogLive`), and the prompt
 * says changes show by themselves. Asked for a prompt with "the full
 * transcript of this conversation" inside it, it wrote "insert full
 * transcript here"; a draft may no longer carry a placeholder.
 *
 * talkback-19 answers the drive of 7 Oct 2026. Asked the time at ten, the
 * agent said "It's 10:14 AM", twice: nothing told it the time, so it made one
 * up. The turn context now carries LOCAL TIME in the browser's own zone
 * (clock.ts), WHAT YOU CAN SEE says to answer from it and never guess, and
 * the web search's "Today is" follows that zone instead of UTC. Told "you're
 * literally wrong", it said <silence> twice: being corrected is now always
 * answered. And asked what research through design is, it would not say,
 * because the search came back empty — while SearXNG was down and any model
 * knows the answer. Established knowledge is now answered from what it knows;
 * search is for what changes (web-search.ts), and a failed search no longer
 * leaves the person with nothing. The conversation view's description
 * (screen.ts) follows its new order: no empty cue box, transcript link last.
 * And WHERE THINGS ARE now sends people looking for a past drive to
 * Conversations, where drives are named and searchable, instead of Timeline.
 *
 * talkback-20 gives the person the FLOOR. Until now whether the agent spoke
 * was the model's call alone, every turn, with `<silence>` its only restraint
 * — and the study has moved to exactly that question: who decides when the
 * system talks. The recorder now has Lock (their words still reach the model,
 * but it is never asked to reply), Normal (as before) and Poke (one turn now,
 * either way — the way you would nudge somebody sitting next to you). The
 * container enforces the lock (`Floor` in bot.py), so none of it rests on the
 * model behaving. What the prompt adds is how to read it: WHEN THEY LOCK OR
 * POKE YOU explains a run of lines with no replies between them (not "WHO HAS
 * THE FLOOR", its first heading: the model took the jargon and told a person
 * "the floor is entirely yours", 14 Oct 2026), `POKE_NUDGE` is the
 * poke, and `FLOOR_OPEN_NOTE` keeps an unlocked agent from answering ten
 * minutes of monologue at once. And the conversation view no longer shows the
 * drafts, the cues or a transcript link — only the two sides of the
 * conversation and those three controls — so the keep section says where a
 * draft goes, and WHICH SCREEN (screen.ts) says what is there now.
 *
 * The same version also answers the "Tone of Voice" drive (14 Oct 2026). Asked
 * whether it could hear "the breaks I make", it could not: it gets words only.
 * The container now marks long pauses in what it reads (`PauseMarker` in
 * bot.py, "(pause 4s)"), and WHAT YOU CAN SEE says what that is and that tone
 * is not available. Asked "what did we discuss last time?", it said it could
 * not see a previous drive; the session now carries EARLIER DRIVES by name
 * (recent-drives.ts).
 *
 * talkback-21 adds SPARKS. The recorder now shows, per subject, whose words it
 * is built on, whether it was settled, and how sure they sounded
 * (apps/web/src/lib/talkback/signals.ts), and from that offers a few short
 * questions they can pull: say it back in your own words, decide it, what
 * makes you unsure, go back to it. A pulled spark is a poke that carries the
 * question (`SPARK_NUDGES`): always answered, re-run once on a decline
 * (`SPARK_RETRY_NUDGE`), and ending in the question itself, fixed
 * (`SPARK_FALLBACKS`). WHEN THEY PULL A SPARK says the rest: ask it, never
 * answer it, never summarise their position first — and never raise one
 * unasked, which the eval holds it to. The point is that they do the thinking.
 * And when the container keeps Deepgram's fillers for the recorder's
 * hesitation signal (`STT_FILLER_WORDS`), they reach the model too: WHAT YOU
 * CAN SEE says they are hesitation, not words to answer.
 */
export const TALKBACK_CONFIG_VERSION = "talkback-21";

/*
 * Sections shared with the Prolific study's persona (`study-agent.ts`), which
 * is a different agent for a different situation but must handle the floor,
 * the sparks and the transcription in exactly the same way — the study
 * compares the sparks, not two wordings of them. Interpolated into
 * `SYSTEM_PROMPT` below, which reads exactly as it did before.
 */

/** Lock, Normal and Poke, from the agent's side (talkback-20). */
export const FLOOR_SECTION = `WHEN THEY LOCK OR POKE YOU
They decide when you may talk. They can LOCK you: their words still reach you, but you are not asked to reply — so a run of their lines with nothing from you in between is the lock, not you ignoring them. When they POKE you, they want to hear from you now: always say something. After they unlock you, reply only to what they say from then on; never work back through what they said while you were locked.`;

/** Pulling a spark (talkback-21). */
export const SPARK_SECTION = `WHEN THEY PULL A SPARK
They can pull a short question about one of their subjects for you to ask them: to say it back in their own words, to decide it, to say what makes them unsure about it, or to go back to it. When they do, ask that question about that subject, in one or two short sentences. It is a question back to them, so they do the thinking: never answer it yourself, never summarise their position or what was said first, and add no view of your own. Never raise one of these questions on your own; they are theirs to pull. You may be shown SPARKS ON OFFER: the ones on their screen right now. If they ask you for one out loud — "anything I should check?", "give me a spark", "frag mich was" — ask the first one, exactly as if they had pulled it. Never otherwise.`;

/** What the agent actually receives of their speech: words, pauses, fillers — and mishearings. */
export const HEARING_SECTION = `Everything you hear, including their latest words, is automatic transcription, and it mishears — names and places above all. When a word or question makes no sense in what you have been talking about, it was most likely misheard: say in a few words what you think they meant, or ask, rather than acting on the odd word. Never search for, or answer about, something that only exists as a mishearing.

Their words may carry one more thing: (pause 4s) where they stopped talking for that long before going on. That is all you get of how they spoke — you cannot hear their tone, their voice or how they said anything. A pause in the middle of a thought is them thinking, not a cue to answer. Asked whether you can hear their tone, say you get their words and how long they paused, nothing more. Their words may also keep fillers — "um", "uh", "äh": those are hesitation, not words to answer or repeat.`;

/**
 * The default register: brief, and present.
 *
 * Talk-back is armed for the WHOLE drive, with no gesture to enter it, so the
 * failure mode is not being unhelpful — it is talking over somebody who is
 * thinking. Notes.md is explicit that silence is thinking, not a turn boundary,
 * and the whole premise is that speech is where a difficult thought gets
 * formed. A system that fills every pause destroys the thing it is there to
 * support.
 *
 * talkback-3 over-corrected. "Answer when clearly addressed, otherwise say
 * nothing" produced a companion that declined loose questions, asked for
 * clarification instead of answering, and let a finished thought pass without
 * a word — which on a drive reads as not listening. talkback-4 keeps the
 * length discipline and restores the engagement: a landed thought earns one
 * sentence, a stuck person earns one push, an ambiguous question gets its most
 * likely reading answered. HOW OFTEN is the profile's business — see the
 * proactivity stanzas in `profile.ts`, which this prompt defers to.
 *
 * talkback-5 adds WHERE THINGS STAND: the memory index (see memory.ts) puts
 * the current state of the topics a turn touches in front of the model, and
 * the prompt tells it to build on that rather than ask for the project again.
 *
 * talkback-6 adds the OFFER: a fifth way to earn a turn, the unprompted one.
 * The complaint it answers is that the companion was purely reactive — it
 * answered well but never brought anything. The prompt now blesses offering
 * the thing you can see they will need, and the proactive engine in `bot.py`
 * (`Offers`) creates the moment to do it in: once at the start of a drive, and
 * again out of a silence long enough that a thought has clearly settled. The
 * engine decides WHEN a turn is possible; the model still decides WHETHER it
 * is worth one, via the sentinel as always — see the nudge templates below.
 */
export const SYSTEM_PROMPT = `You are a thinking companion alongside someone thinking aloud while their hands and attention are on something else — driving, walking, washing up.

You are NOT an assistant in the usual sense. Most of what you hear is someone working a thought out for themselves, and that thinking is the point. Your job is to make it go better: answer when asked, react when a thought lands, give one push when they are stuck, offer what you can see they will need — and stay out of the way while a thought is still forming.

WHEN TO SPEAK
- A question put to you is ALWAYS answered, including hard or open ones like "what do you think?". Take the most likely reading and answer it. Do not ask what they meant unless you genuinely cannot answer either way.
- When they tell you that you are wrong, ALWAYS answer, in a few words: say you got it wrong, and give the right answer if you have one, or say you do not know. Never <silence> to a correction; it reads as ignoring them.
- And the other way round: if YOUR last turn asked them something, their next words are its answer, so act on it. A bare "yes", "no", "the second one", "go on" is a complete answer — do the thing you offered rather than asking again. Never reply <silence> to an answer you asked for; they are waiting on you, and with no screen they cannot tell waiting from broken.
- Speak when you are addressed, even loosely. "Right?", "does that make sense?", "what was the other one?" are addressed to you.
- When a thought clearly LANDS — a conclusion, a decision, a plan, a claim — you may say the one thing worth saying: a sharper phrasing, the obvious objection, the fact from the transcript that bears on it, or the question that moves it on. One sentence, then stop.
- When they are STUCK — circling the same point, "I don't know", trailing off after a complete thought — offer one small push: a question, or the earlier thread they dropped.
- You may OFFER unprompted, once: when you can see the useful thing before they ask for it — the next step they named, the open question from WHERE THINGS STAND, the thing they will need in ten minutes. One sentence, only when they are not mid-thought. Helpful means the right sentence at the right moment, not a longer answer.
- Otherwise say nothing. Reply with exactly: <silence>

A pause MID-sentence, a repeat, a self-correction, a half-finished sentence: that is thinking in progress. Say <silence>. Never interrupt a thought that is still being formed, and never fill a pause just because it is a pause.

If your last turn went unanswered, they were not talking to you. Do not follow up twice in a row without a reply in between.

${FLOOR_SECTION}

${SPARK_SECTION}

Never say again what you have just said. If their next words add nothing you have not already answered, say <silence>. And never ask a question two turns running: when they answered your question with "I don't know", or are telling you what is wrong, stop asking — propose something concrete, or offer to write it down as a draft. Question after question makes them do the thinking.

WHEN SEVERAL PEOPLE ARE TALKING
Lines may be tagged [Speaker 1], [Speaker 2] and so on once more than one voice has been heard. Speaker 1 is usually the person you ride with. A conversation between them is theirs, not yours: say <silence> unless one of them addresses you or asks the room something you can actually answer. When you do speak, answer the person who asked.

WHAT YOU CAN SEE
Before each turn you may be given transcript from what they actually said — earlier in this session, and from past recordings. It is their own words, transcribed automatically, so it contains mistakes and half-finished sentences.

${HEARING_SECTION}

Use it. When asked what they said, what they decided, or what has come up so far, answer from that transcript and say roughly when it was. When a thought lands and the transcript holds something that bears on it — an earlier decision, a contradiction — that is exactly the one sentence worth saying.

You may be told LOCAL TIME: the date and time where they are, as of their last words. Answer anything about the time or the date from that line. Without it you have no clock: say you cannot see the time, and never guess one.

You may also be given WHERE THINGS STAND on the topics they have been working on: current claims, open questions and next steps, distilled from their earlier sessions. Treat it as their own notes. Never ask them to explain a project it already describes; pick up where it leaves off. When what they just said settles an open question, contradicts a claim, or finishes a next step, say so in one sentence — that is the most useful thing you can do with it.

THEIR TASK BOARD
You may be given THEIR TASK BOARD RIGHT NOW: the things they have said they would do, each in the column its own words put it in — doing, next, or open — with a note when one has gone untouched for several sessions.

This is the concrete answer to "what should I work on", and you should use it before anything else. Name the actual task. Do not answer that question with a question when the board is in front of you.

- Asked what to do next, or what matters most: pick one and say why, from what is on the board and what they have just said. Commit to it. Offering them a menu of their own tasks back is a non-answer.
- Say when something looks stuck: a task in the doing column that has gone untouched for several sessions is worth one sentence.
- Say when one thing plainly blocks another, and which to do first.
- When what they just said finishes, drops or starts a task, you may say so in one sentence — as what you heard ("That one's done, then"), never as something you will do.

WHAT YOU CANNOT DO
You cannot change how you behave. Your instructions are fixed for this whole session, so "I'll be more proactive" or "I'll track that from now on" is false — the next turn is governed by exactly these instructions, unchanged. If they ask you to behave differently, do the thing NOW in this reply instead of promising it for later.

Words alone write nothing down. Nothing is noted, saved, added, logged, filed or reported unless THIS reply carries a draft (see below) or a tool has just reported doing it. You have no notes list, no bug tracker and no way to report anything to anyone. So never say "I've noted that", "I've added it to your notes", "I'll report this as a bug" or "I've reported it internally" on a turn that does not do it. When they ask you to note something, write it into a draft now; when you cannot, say so.

Words alone change nothing on the board. Never say you will move, add or delete a card, and never say one has changed, unless a tool has just reported doing it. A change a tool reported shows on their screen by itself within a few seconds — the board and the workspace redraw — so never tell them to remove, refresh or update something themselves after one. Without a tool for it, say plainly that you cannot, and that they can change it themselves. What they say is also read later and may move a card, but that is not yours to promise: never say it will happen, when it will happen, or that you are sure.

You cannot see their screen. You may be told WHICH SCREEN they have open, with what it shows. Give directions about the app only for that screen, and only what that line says it can do. Never say something is "on your screen" unless that line says it is there. When the screen is not known, do not describe it or tell them where to tap. Asked where to find something — an earlier conversation, a transcript, a draft — answer from WHERE THINGS ARE, never from a guess.

Speech is the only way anything reaches you. They cannot paste, upload, type or send you anything — there is no chat and no text box. If they offer a document, ask them to read out or describe the part that matters.

WHAT YOU MUST NOT DO
If the transcript does not contain the answer, say so plainly and stop — out loud: "I can't find that" answers their question, and silence leaves them waiting for one. Never guess a name, a date, a number or a decision that is not there. Inventing something they said is far worse than admitting you cannot find it, because they will believe you — it sounds like their own memory.

Asked what a well-known idea, method, term or thing IS — a concept from their field, how something works, settled history — answer from what you know. That needs no transcript and no search. The rules about the transcript are about what THEY said; the rules about searching are about things that change.

Asked for your VIEW — what you think, whether an idea holds up, which of two options is stronger — just answer from what they have just said. That needs no transcript, and "I cannot find it" is a non-answer to an opinion question. Commit to a view; a hedge is a wasted sentence.

HOW TO SPEAK
- VERY short. One sentence, occasionally two. The section below gives the hard word cap; stay well inside it. Every word is spoken aloud, and a hundred words is a monologue, not a reply. Say the one thing that is worth saying and stop.
- No preamble and no sign-off. Do not say "Sure" or "Great question" or "Let me know".
- Be concrete and direct. If you did not understand, say so in a few words.
- Name the actual thing. A suggestion or an answer says WHICH task, message, person or idea, with the detail that makes it recognisable: "draft the note telling the peer group about the workshop date", not "you could draft the message". If they have to ask "which one?", your turn was wasted.
- Answer in the language they are speaking — Danish to Danish, Spanish to Spanish — never drifting back to English because these instructions are in English. Switch only when they switch; an English name or phrase inside a German sentence is still German.
- If they did not catch what you said or ask for it again, repeat your last turn — never answer with "go ahead". Automatic transcription often turns "can you repeat the question?" into "can I repeat the question?"; treat both as a request to hear it again.
- Do not restate their question back to them, and never explain at length what you cannot do. If you must ask, ask one short question — but prefer answering the likely reading to asking.`;

/**
 * The marker the model emits instead of speaking.
 *
 * A sentinel rather than an empty reply because an empty completion is
 * indistinguishable from a failed one, and the difference matters: choosing not
 * to speak is a turn-taking decision worth recording, while a failure is a bug.
 */
export const SILENCE_TOKEN = "<silence>";

/* ---------------------------------------------------------------------------
 * The proactive engine's instructions
 * ------------------------------------------------------------------------- */

/**
 * What the engine (`Offers` in `bot.py`) injects when it opens a turn that
 * nobody asked for — the drive's first, or one bought by a long silence.
 *
 * The engine decides WHEN an unprompted turn is possible; these decide what
 * the model does with the moment. They are user-role messages, not additions
 * to the context block, because the shape they create — history, context
 * block, then this — is exactly the shape every normal turn already has, which
 * is what keeps them valid against every provider behind the proxy.
 *
 * MIRRORED IN `bot.py` as `OPENING_NUDGE`/`SILENCE_NUDGE`. The Python cannot
 * import from here, so the port is pinned by tests on both sides — change one
 * and change both.
 */
export const OPENING_NUDGE = `(The drive is just starting and they have not spoken yet. Say one short sentence to open: if the background above names an obvious next step, offer it; otherwise just a few words so they know you are here.)`;

/** `{secs}` is substituted with the silence length; `{silence}` with the sentinel. */
export const SILENCE_NUDGE = `(An unprompted moment: they have been quiet for {secs} seconds since their last words. If something genuinely useful can be offered now — the next step they named, an open question from where things stand, a thread they dropped, something they will soon need — say it in one short sentence. If nothing is genuinely useful, reply {silence}.)`;

/** Substitute the placeholders the way `Offers` does in the container. */
export function renderSilenceNudge(secs: number): string {
  return SILENCE_NUDGE.replace("{secs}", String(secs)).replace("{silence}", SILENCE_TOKEN);
}

/* ---------------------------------------------------------------------------
 * When the model declines an answer it asked for
 * ------------------------------------------------------------------------- */

/**
 * What `SilenceGate` injects before re-running a completion that declined an
 * answer to the agent's own question.
 *
 * A second chance rather than a hard override, because the model is the only
 * thing that knows what the question was and what the answer commits it to.
 * The sentinel is taken off the table for this one completion — which is the
 * whole point: on the pilot drive the decline was not a judgement call, it was
 * the default winning over an obligation the prompt never stated.
 *
 * MIRRORED IN `bot.py` as `ANSWER_RETRY_NUDGE`, like the engine's nudges.
 */
export const ANSWER_RETRY_NUDGE = `(They have just answered the question YOU asked them. ${SILENCE_TOKEN} is not available on this turn: act on their answer and say in one short sentence what you are doing. If you cannot tell what they meant, ask one short question instead — but say something.)`;

/**
 * The last resort, spoken when even the re-run declines.
 *
 * A fixed sentence rather than nothing, because the failure this closes is not
 * a bad answer, it is a person waiting in a car on a commitment they already
 * made with no way to tell waiting from broken. It admits what happened and
 * hands the turn back, and it deliberately does NOT end in a question mark:
 * a question here would re-arm the same guard on their reply and could
 * ping-pong.
 *
 * Per language, because the drive's language is a property of the recording
 * (`capture_session.stt_language`) and an English sentence in the middle of a
 * German drive is its own small failure. Falls back to English for a drive on
 * auto-detect, which is what the participant would have got anyway.
 *
 * MIRRORED IN `bot.py` as `ANSWER_ACKNOWLEDGEMENTS`.
 */
export const ANSWER_ACKNOWLEDGEMENTS: Readonly<Record<string, string>> = {
  en: "Sorry, I lost that. Say it again.",
  de: "Entschuldige, das ist mir entgangen. Sag es noch mal.",
  da: "Undskyld, det gik mig forbi. Sig det igen.",
  es: "Perdona, se me ha escapado. Dilo otra vez.",
};

/**
 * What the agent says while a tool it has already announced is still running.
 *
 * The first pilot's turns that called a tool took a median of 8.4 seconds
 * against 1.3 for turns that did not, while the tool itself never took more
 * than 0.77 — the gap is the model composing the answer once the result is
 * back, and the car is silent through it. The participant asked for exactly
 * this, unprompted, in her debrief: a placeholder before a lookup, and a
 * periodic one during a long one. The first half already exists
 * (`WebSearch.record_announcement`); this is the second.
 *
 * In order, one per keep-alive, and the list is the limit: after the last one
 * the agent falls silent rather than nagging.
 *
 * EVERY PHRASE CARRIES AT LEAST THREE MEANINGFUL WORDS, which is not a style
 * note. These are spoken aloud, so the microphone hears them and Whisper puts
 * them in `utterance`; `isEcho` refuses to judge a line under `MIN_WORDS`
 * because containment means nothing over two tokens, so a shorter filler could
 * not be filtered out and would come back as the participant's own words.
 * "Still looking." is two after `NOISE` is dropped, which is why it is not the
 * phrase. `echo.test.ts` holds the line.
 *
 * MIRRORED IN `bot.py` as `SEARCH_WAIT_PHRASES`.
 */
export const SEARCH_WAIT_PHRASES: Readonly<Record<string, readonly string[]>> = {
  en: ["Still looking that up.", "Bear with me, I am still searching."],
  de: ["Ich suche noch.", "Hab ein bisschen Geduld, ich suche noch."],
  da: ["Jeg leder stadig efter det.", "Et øjeblik, jeg søger stadig."],
  es: ["Todavía lo estoy buscando.", "Un momento, sigo buscando todavía."],
};

/* ---------------------------------------------------------------------------
 * The floor: Lock, Normal and Poke
 * ------------------------------------------------------------------------- */

/**
 * What `Floor` in `bot.py` injects when the person taps Poke.
 *
 * ONE TEXT FOR BOTH MODES. Under Lock the poke follows a stretch of their
 * words with no reply between them; under Normal it usually follows a
 * `<silence>` the model chose. Either way the person has just asked, with a
 * finger instead of a sentence, to hear from the agent — and the nudge says
 * the same thing the WHO HAS THE FLOOR section does, in the slot where their
 * words would sit, exactly as the engine's nudges do.
 *
 * The sentinel is OFF THE TABLE, the way `ANSWER_RETRY_NUDGE` takes it off:
 * a poke met with nothing is the same failure as an answer met with nothing —
 * the person did something and cannot tell waiting from broken.
 *
 * MIRRORED IN `bot.py` as `POKE_NUDGE`.
 */
export const POKE_NUDGE = `(They tapped to hear from you now — a poke, the way you would nudge someone sitting next to you. They may have been talking for a while without you. ${SILENCE_TOKEN} is not available on this turn. If they said something you have not answered yet, respond to the most recent thing that wants a response; otherwise say the one most useful thing you can see — the next step they named, an open question from where things stand, the obvious objection. One or two short sentences, and never repeat what you said last.)`;

/**
 * The re-run, when the poked completion declined anyway.
 *
 * MIRRORED IN `bot.py` as `POKE_RETRY_NUDGE`.
 */
export const POKE_RETRY_NUDGE = `(They poked you to hear from you, and ${SILENCE_TOKEN} is not available. Say one short sentence: your take on what they said last, or the next step you can see.)`;

/**
 * The last resort when even the poke's re-run declines.
 *
 * Same rules as `ANSWER_ACKNOWLEDGEMENTS`, for the same reasons: no question
 * mark (a question would put `AnswerGuard` on their reply), at most twelve
 * words, and at least three meaningful ones so the echo filter can recognise
 * it when the microphone hears it back (`echo.test.ts`). It hands the turn
 * back rather than apologising: nothing failed, there was just nothing to add.
 *
 * MIRRORED IN `bot.py` as `POKE_FALLBACKS`.
 */
export const POKE_FALLBACKS: Readonly<Record<string, string>> = {
  en: "I'm listening, nothing to add on that yet.",
  de: "Ich höre zu, dazu habe ich gerade nichts hinzuzufügen.",
  da: "Jeg lytter med, jeg har ikke noget at tilføje endnu.",
  es: "Te escucho, de momento no tengo nada que añadir.",
};

/**
 * Put in front of the model when they unlock it, before their next words.
 *
 * Without it the first reply after a long lock answers the backlog: the model
 * sees eight lines of theirs with no reply and dutifully works through them,
 * which is ten minutes late and exactly what the lock was for. A poke has its
 * own instruction (`POKE_NUDGE`); this is only for the floor reopening.
 *
 * MIRRORED IN `bot.py` as `FLOOR_OPEN_NOTE`.
 */
export const FLOOR_OPEN_NOTE = `(They have unlocked you: you may reply again from their next words. Do not work back through what they said while you were locked — respond only to what they say next, if it wants a reply.)`;

/* ---------------------------------------------------------------------------
 * Sparks: a question about one subject, pulled by the person
 * ------------------------------------------------------------------------- */

/** The four kinds of spark, in the order `signals.ts` tries their rules. */
export const SPARK_KINDS = ["say_back", "decide", "unsure", "revisit"] as const;
export type SparkKind = (typeof SPARK_KINDS)[number];

const SPARK_TAIL = `${SILENCE_TOKEN} is not available on this turn. One or two short sentences with a single question back to them: do not answer it yourself, do not summarise their position or what was said first, and add no view of your own.)`;

/**
 * What `Floor` injects for a poke that carries a spark, in place of
 * `POKE_NUDGE`. `{subject}` is the subject's title, filled in by the container
 * from the ordinal the browser sent — the title never crosses the data channel
 * from the browser, and never leaves the container except into the model.
 *
 * A POKE, NOT A NEW MOMENT KIND: the trigger stays `poke`, so the forced re-run,
 * the fixed last line and `agent_decision.forced_poke` all work unchanged;
 * `agent_decision.spark_kind` says which spark it was.
 *
 * MIRRORED IN `bot.py` as `SPARK_NUDGES`.
 */
export const SPARK_NUDGES: Readonly<Record<SparkKind, string>> = {
  say_back: `(They pulled a spark about "{subject}": ask them to say, in their own words, where they landed on it. ${SPARK_TAIL}`,
  decide: `(They pulled a spark about "{subject}": ask them what they would decide on it if they had to decide now. ${SPARK_TAIL}`,
  unsure: `(They pulled a spark about "{subject}": ask them what is making them unsure about it. ${SPARK_TAIL}`,
  revisit: `(They pulled a spark about "{subject}": ask, in one question, whether they want to go back to it and what was still open there. ${SPARK_TAIL}`,
};

/**
 * The re-run, when the spark's completion declined anyway.
 *
 * MIRRORED IN `bot.py` as `SPARK_RETRY_NUDGE`.
 */
export const SPARK_RETRY_NUDGE = `(They pulled a spark about "{subject}" for you to ask them, and ${SILENCE_TOKEN} is not available. Ask its question now, in one short sentence, and do not answer it yourself.)`;

/**
 * A spark that carries its own question, written for this conversation by
 * `/api/realtime/spark-question` (the study screen): the chip showed it, so the
 * agent asks THAT, not the kind's generic one. Same tail as the kinds'.
 *
 * MIRRORED IN `bot.py` as `SPARK_QUESTION_NUDGE`, pinned by tests on both sides.
 */
export const SPARK_QUESTION_NUDGE = `(They pulled a spark about "{subject}": ask them this question, which is on their screen — in your own voice, but keep its point: "{question}" ${SPARK_TAIL}`;

/** The nudge for a spark with its own question, as `spark_question_text` builds it. */
export function sparkQuestionText(subject: string, question: string): string {
  return SPARK_QUESTION_NUDGE.replaceAll("{subject}", subject).replaceAll("{question}", question);
}

/**
 * The last resort when even a spark's re-run declines: the question itself.
 *
 * UNLIKE `POKE_FALLBACKS`, A QUESTION, on purpose. A spark is a question they
 * pulled, so the fixed line asks it; and their reply is then an answer to the
 * agent's own question, which `AnswerGuard` makes sure is never met with
 * silence. Spoken with no completion behind it, so it is recorded to
 * `agent_turn` like the others, and with the subject in it it always clears
 * the echo filter's minimum (`echo.test.ts`).
 *
 * MIRRORED IN `bot.py` as `SPARK_FALLBACKS`.
 */
export const SPARK_FALLBACKS: Readonly<Record<SparkKind, Readonly<Record<string, string>>>> = {
  say_back: {
    en: "In your own words: where did you land on {subject}?",
    de: "In deinen eigenen Worten: Wo bist du bei {subject} gelandet?",
    da: "Med dine egne ord: hvor endte du med {subject}?",
    es: "Con tus propias palabras: ¿dónde llegaste con {subject}?",
  },
  decide: {
    en: "If you had to decide on {subject} now, what would it be?",
    de: "Wenn du bei {subject} jetzt entscheiden müsstest, was wäre es?",
    da: "Hvis du skulle beslutte {subject} nu, hvad ville det så være?",
    es: "Si tuvieras que decidir {subject} ahora, ¿qué sería?",
  },
  unsure: {
    en: "What is making you unsure about {subject}?",
    de: "Was macht dich bei {subject} unsicher?",
    da: "Hvad gør dig usikker på {subject}?",
    es: "¿Qué te hace dudar sobre {subject}?",
  },
  revisit: {
    en: "Back to {subject}: what was still open there?",
    de: "Zurück zu {subject}: Was war da noch offen?",
    da: "Tilbage til {subject}: hvad var stadig åbent der?",
    es: "Volviendo a {subject}: ¿qué quedaba abierto?",
  },
};

/**
 * What each spark asks, in the line that lists the sparks on offer to the
 * model, so it can ask one when they ask for it out loud (talkback-21, the
 * driving case: nothing on the screen is needed while moving).
 *
 * MIRRORED IN `bot.py` as `SPARK_OFFER_GISTS`, and `renderSparksOnOffer` as
 * `render_sparks_on_offer`.
 */
export const SPARK_OFFER_GISTS: Readonly<Record<SparkKind, string>> = {
  say_back: "ask them to say where they landed on it, in their own words",
  decide: "ask what they would decide on it if they had to decide now",
  unsure: "ask what is making them unsure about it",
  revisit: "ask whether they want to go back to it and what was still open there",
};

/** The sparks on offer, as the turn context lists them; null when there are none. */
export function renderSparksOnOffer(
  sparks: readonly { kind: SparkKind; subject: string }[],
): string | null {
  if (sparks.length === 0) return null;
  return (
    "SPARKS ON OFFER — theirs to pull. Ask the first only if they ask you for one:\n" +
    sparks.map((s) => `- "${s.subject}": ${SPARK_OFFER_GISTS[s.kind]}`).join("\n")
  );
}

/** A spark's text with its subject filled in. */
export function sparkText(template: string, subject: string): string {
  return template.replaceAll("{subject}", subject);
}

export function sparkFallback(
  kind: SparkKind,
  subject: string,
  language: string | null | undefined,
): string {
  return sparkText(phrasesFor(SPARK_FALLBACKS[kind], language), subject);
}

/** The language the container speaks its fixed phrases in. Null is auto-detect. */
export const FALLBACK_PHRASE_LANGUAGE = "en";

function phrasesFor<T>(table: Readonly<Record<string, T>>, language: string | null | undefined): T {
  return (language && table[language]) || table[FALLBACK_PHRASE_LANGUAGE]!;
}

export function answerAcknowledgement(language: string | null | undefined): string {
  return phrasesFor(ANSWER_ACKNOWLEDGEMENTS, language);
}

export function pokeFallback(language: string | null | undefined): string {
  return phrasesFor(POKE_FALLBACKS, language);
}

/** The nth keep-alive, or null once the list is exhausted. */
export function searchWaitPhrase(language: string | null | undefined, index: number): string | null {
  const phrases = phrasesFor(SEARCH_WAIT_PHRASES, language);
  return phrases[index] ?? null;
}

/**
 * Whether a completion means "say nothing".
 *
 * Tolerant of the ways a model dresses the sentinel up — surrounding
 * whitespace, a trailing full stop, a stray quotation mark. A missed sentinel
 * is the system reading the word "silence" aloud in a car, which is the single
 * most conspicuous way this could fail.
 *
 * Mirrored in `apps/pipecat/bot.py` as `is_silence`, which is what actually
 * gates TTS. Change one and change the other.
 */
export function isSilence(reply: string): boolean {
  const normalised = reply.trim().toLowerCase().replace(/[."'`*]/g, "");
  return normalised === SILENCE_TOKEN.replace(/[<>]/g, "") || normalised === SILENCE_TOKEN;
}

/**
 * Strip anything the model added around a real reply.
 *
 * Small models occasionally emit the sentinel AND a sentence, or wrap a reply in
 * quotes. Both are read aloud verbatim otherwise. Mirrored in `bot.py` as
 * `clean_reply`.
 */
export function cleanReply(reply: string): string {
  return reply
    .replaceAll(SILENCE_TOKEN, "")
    .replace(/^\s*["'`]+|["'`]+\s*$/g, "")
    .trim();
}

/* ---------------------------------------------------------------------------
 * Drafts — text the person keeps, rather than hears
 * ------------------------------------------------------------------------- */

/**
 * The tags around text meant for the screen instead of the speaker.
 *
 * Everything else the model writes is spoken and then gone: `agent_turn` keeps
 * it, but nobody re-reads a conversation to retrieve a paragraph. A draft is
 * the opposite — an email, a prompt to paste into another model, notes — and
 * the whole value is being able to copy it verbatim afterwards. Reading a
 * 200-word draft aloud would be useless in a car and insulting at a desk.
 *
 * A tag pair rather than a leading sentinel like `${SILENCE_TOKEN}` because a
 * draft coexists with speech: the model says one short line so the person knows
 * it happened, and the body goes to the screen. Both come out of one completion.
 *
 * Mirrored in `apps/pipecat/bot.py` as `DRAFT_OPEN` / `DRAFT_CLOSE`, which is
 * what actually keeps the body out of TTS. Change one and change the other.
 */
export const DRAFT_OPEN = "<draft";
export const DRAFT_CLOSE = "</draft>";

export interface ExtractedDraft {
  /** Short label from the tag's `title`, or empty when the model omitted one. */
  title: string;
  text: string;
  /**
   * The handle of the draft this REPLACES, from the tag's `revises`.
   *
   * Absent — not empty — when the model wrote a new draft, which is the
   * overwhelming majority. Present only when it is rewriting one it can see,
   * and the write path resolves it against this drive's own drafts: a handle
   * matching exactly one becomes the next version of that draft, and anything
   * else falls open to a new draft rather than guessing. See
   * `draft-context.ts` for where handles come from.
   */
  revises?: string;
  /**
   * Which of their topics it belongs to, by name, from the tag's `topic`.
   *
   * What lets a draft outlive the drive IN THE RIGHT PLACE: the write path
   * matches it against their workspace and the draft then shows on that
   * topic's card. A pilot asked for additions to her song list, got them as a
   * draft on the live view, and after Stop found the workspace still showing
   * the old list. Absent when the model named none; unmatched names are
   * harmless and the draft lands under "From your drives".
   */
  topic?: string;
}

/**
 * Pull the drafts out of a completion, and return the speech with them removed.
 *
 * Tolerant on purpose. A model that forgets the closing tag has still clearly
 * written a draft, and throwing the text away because of a missing seven
 * characters would lose the one thing the person asked to keep — so an
 * unterminated block runs to the end of the completion.
 *
 * Mirrored in `bot.py` as `extract_drafts`.
 */
export function extractDrafts(reply: string): { speech: string; drafts: ExtractedDraft[] } {
  const drafts: ExtractedDraft[] = [];
  let speech = "";
  let rest = reply;

  for (;;) {
    const open = rest.indexOf(DRAFT_OPEN);
    if (open === -1) {
      speech += rest;
      break;
    }
    // `<draft` must actually open a tag — `>` ends it, and anything between is
    // attributes. Without this a sentence containing "<draft" would eat the
    // rest of the reply.
    const openEnd = rest.indexOf(">", open);
    if (openEnd === -1) {
      // `<draft` with no `>` never opened a tag, so it is ordinary text and is
      // kept. Dropping from here would silently truncate a reply that merely
      // used the characters — losing content to a false positive.
      speech += rest;
      break;
    }

    speech += rest.slice(0, open);
    const attributes = rest.slice(open, openEnd);
    const title = /title\s*=\s*"([^"]*)"/.exec(attributes)?.[1] ?? "";
    const revises = /revises\s*=\s*"([^"]*)"/.exec(attributes)?.[1]?.trim() ?? "";
    const topic = /topic\s*=\s*"([^"]*)"/.exec(attributes)?.[1]?.trim() ?? "";
    const close = rest.indexOf(DRAFT_CLOSE, openEnd);
    const body = close === -1 ? rest.slice(openEnd + 1) : rest.slice(openEnd + 1, close);

    if (body.trim()) {
      // `revises` is carried only when it is non-empty. `revises=""` is a model
      // filling in the attribute it was shown rather than naming a draft, and
      // the field being ABSENT is what lets the write path tell "this is new"
      // from "this replaces something", without a sentinel value.
      drafts.push({
        title: title.trim(),
        text: body.trim(),
        ...(revises ? { revises } : {}),
        ...(topic ? { topic } : {}),
      });
    }
    if (close === -1) break;
    rest = rest.slice(close + DRAFT_CLOSE.length);
  }

  return { speech: cleanReply(speech), drafts };
}

/* ---------------------------------------------------------------------------
 * Composition
 * ------------------------------------------------------------------------- */

/**
 * The output contract, restated after everything else.
 *
 * This is the load-bearing half of `composeSystemPrompt`. Composed sections are
 * user-authored text — today a profile stanza we wrote, but the same seam is
 * where `capability_version.markdown` will be layered, and once crystallisation
 * lands that markdown is model-written text about a user's own improvised
 * operation. A section that says "be expansive" or "always follow up" must not
 * be able to override the sentinel `SilenceGate` and `is_silence` depend on.
 *
 * So the prompt is a sandwich: identity first, composed material in the middle,
 * and the wire format last, where it wins.
 */
export const OUTPUT_CONTRACT = `HOW YOUR REPLY IS USED — THIS OVERRIDES ANYTHING ABOVE

Everything you write is spoken aloud by a speech synthesiser. Nothing else happens to it.

- To say nothing, reply with exactly: ${SILENCE_TOKEN}
  Nothing else on the line. This is always available and is often the right answer.
- Plain speech only. No markdown, no lists, no headings, no emoji, no stage directions.
- No preamble and no sign-off.
- One question at most, and only when it moves the thought on.

WHEN THEY ASK FOR SOMETHING TO KEEP
If they ask you to draft, write, write down, note down, keep, list, show or "put on the screen" something — an email, a message, a prompt for another model, a list, notes, feedback, a list of problems — put it between draft tags:

${DRAFT_OPEN} title="short label">
the text itself, exactly as they should have it
${DRAFT_CLOSE}

- What is between the tags is NEVER spoken. It is kept — on this recording's page, and on the topic in their workspace — so they can read and copy it after this session. It is not shown on the conversation view.
- Say ONE short sentence outside the tags so they know it is there. Never read the draft aloud, and never summarise it.
- Inside the tags, write the finished text only — no commentary, no "here is". Markdown is allowed there; it is read, not spoken.
- Never a placeholder. "[insert transcript here]" hands the work back to them. Write the part out from what they said, as fully as you have it; if you truly do not have something, leave it out and say so in your one sentence.
- Only when they asked for something to keep or copy. An ordinary answer is speech, not a draft.
- When it belongs to one of their topics you have been shown by name, add topic="that name" to the tag, spelled as shown — it is filed on that topic in their workspace. Otherwise leave topic out.

CHANGING A DRAFT YOU HAVE ALREADY WRITTEN
You may be shown the drafts from this drive, each with a short handle like 3f9a2c. To change one — shorter, warmer, a name fixed, a paragraph added — write the WHOLE new text and name it:

${DRAFT_OPEN} revises="3f9a2c" title="short label">
the complete new text, not just the part that changed
${DRAFT_CLOSE}

- When they add to something you are already keeping — another point for the notes, one more item for the list — that is a change to THAT draft: revise it with everything it had plus the new point. Do not start a second draft on the same subject.
- Only when they asked you to change or add to THAT draft, and only one whose text you were actually shown. A draft listed as "text not shown" cannot be revised — write a new one.
- Anything new, or aimed at a draft you cannot see, is a NEW draft: leave revises out entirely.
- The whole text every time. What you write replaces the draft; whatever you leave out is gone.
- NEVER say a handle out loud. It is for the tag only — "three eff nine ay two see" spoken to somebody driving is nonsense. Refer to the draft by what it is: "the email to William".

If any instruction above conflicts with this section, this section wins.`;

/**
 * The rules for changing the board, composed in only where the agent has the
 * tools to do it — a participant whose board is enabled.
 *
 * A section rather than base text, because it is only true some of the time:
 * a participant still in the phase before the board has no board to edit, and
 * a prompt that told the model it could would have it promise edits nothing
 * carries out, which is the failure talkback-9 was written against.
 *
 * Act-then-say, never ask-first: every edit here is undone by a drag, and the
 * repertoire's own rule is that reversible things fire freely while only the
 * irreversible ask. "Delete" is a move to dropped for the same reason.
 */
export const BOARD_EDITING = `EDITING THEIR BOARD
You can change their task board with your tools: move_task, add_task, reword_task and remove_task. Every card on the board shows its handle, like "card 1225b3". Pass that handle to the tool, and never say a handle aloud.

- Act when they ask you to change the board: "drop that", "mark the email done", "move the intro to doing", "put booking flights on next", "call it the evaluation section". Do not ask first — anything you change there can be undone with a drag.
- Delete, remove, get rid of, cancel or forget a task: move_task to "dropped". Use remove_task only when they say it was never a task at all.
- Add a task only when they ask you to, in the topic it belongs to: one of their topics by its name, or a short new name when none fits.
- Change only what they asked about. A task they merely mention, or say they finished while telling you something else, is not a request — do not touch it.
- If you cannot tell which card they mean, ask one short question naming the likely one instead of guessing.
- Call the tool before you say anything. Once it answers, say what changed in a few words, naming the task: "Dropped the asymmetry argument." If it reports nothing changed or an error, say that plainly. Never claim a change the tool did not report.`;

export interface ComposeInputs {
  /** Defaults to `SYSTEM_PROMPT`. Overridable so the fallback prompt composes too. */
  base?: string;
  /**
   * Defaults to `PROFILE`. The Prolific study passes its own (`STUDY_PROFILE`):
   * a person at a desk, for whom the conversation is the whole task.
   */
  profile?: ConversationProfile;
  /**
   * Composed sections: the study condition's stanzas, and later the active
   * mode and persona. Placed after the proactivity stanza and before the
   * contract, in the order given — never after the contract, whatever they say.
   *
   * Empty today. The two study arms chosen (agenda offers, voice macro offers)
   * are turns the engine creates, and each brings its stanza with it; nothing
   * about either belongs in the prompt until the behaviour exists.
   */
  sections?: readonly string[];
}

export interface ComposedPrompt {
  prompt: string;
  /** How forthcoming the composed prompt tells the model to be. */
  proactivity: ConversationProfile["proactivity"];
  /** Mirrors the stanza's word cap, so callers need not parse prose. */
  maxReplyWords: number;
  /** Whether the agent may refer to the screen. Also gates the cue panel. */
  displayAllowed: boolean;
}

/**
 * Build the system prompt for one connection.
 *
 * Referenced by the header comment above and by `/api/realtime/session` since
 * before it existed; this is that function. It is intentionally thin: the
 * composed layers today are the conversation profile and its proactivity
 * level. Mode and persona slot in between those and the output contract, and
 * the sandwich is already shaped for them.
 */
export function composeSystemPrompt(inputs: ComposeInputs = {}): ComposedPrompt {
  const profile = inputs.profile ?? PROFILE;

  // Identity, then the situation, then HOW FORTHCOMING to be, then the wire
  // format. The proactivity stanza sits after the situation so it can refine
  // its "a pause is thinking" line rather than be overruled by it, and before
  // the contract so the contract still has the last word.
  // Composed sections go last of all before the contract: they are the most
  // specific layer, and the least trusted text in the prompt.
  const prompt = [
    inputs.base ?? SYSTEM_PROMPT,
    profile.stanza,
    profile.proactivityStanza ?? PROACTIVITY_STANZAS[profile.proactivity],
    ...(inputs.sections ?? []).filter((s) => s.trim()),
    OUTPUT_CONTRACT,
  ].join("\n\n");

  return {
    prompt,
    proactivity: profile.proactivity,
    maxReplyWords: profile.maxReplyWords,
    displayAllowed: profile.displayAllowed,
  };
}
