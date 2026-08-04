# VoiceMural: An End-User Programmable Voice Interface with a Growing Repertoire

## Research paper proposal, draft v1

## *Premise*

Speech is a good medium for formulating difficult problems and a poor medium for operating software. The first fact is old: Kleist argued in 1805 that thought is not transmitted by speech but formed in it, and programmers rediscovered the point as rubber-duck debugging. The second fact is why voice assistants stalled. They ask users to speak in a fixed grammar authored by someone else, and they discover a fresh utterance is a command only after acting on it.

VoiceMural takes the opposite position on both. It listens while the user is eyes-busy, typically driving, and treats everything as content by default. Its interface is generated from a repertoire: a personal, accumulated set of capabilities that the user authors in situ, by voice, as needs surface. The design comes from watching physicians dictate patient records to secretaries who transcribed the content, obeyed the instructions, and filled in the forms correctly.

## *Claim*

A voice interface for thinking cannot be designed to fit, because users discover their needs through use. The interface must therefore be generated from a repertoire that the end user extends during use, without a screen.

This reframes voice interaction as an end-user programming problem rather than a recognition or dialogue-management problem. It also predicts what a fixed-grammar assistant cannot do: absorb the idiosyncratic, low-frequency, personally invented operations that make up most of what a person actually wants.

# Repertoire Abstraction

Four capability types, along two axes: who speaks when, how they speak, what happens to the record, and when that happens unbidden.

| Type | Governs | Examples |
| :---- | :---- | :---- |
| Mode | turn-taking and elicitation; what the system does with silence | interview, note-taking, rubber-ducking, critique |
| Persona | register and content of the system's turns | supportive, sceptical, terse |
| Action | a punctual operation on the record | mark, summarise, send to document |
| Rule | binds an action to an event | on session end, summarise |

Mode and persona form a genuine cross-product: interview with a sceptical persona is a viva; interview with a supportive persona is coaching. A mode owns its defaults, including entry and exit rules, which resolves the disposition of the many sessions that end without any instruction. Capabilities carry parameters, so "one question at a time, immediate feedback on" and the same mode with feedback off remain one capability rather than two.

Each capability is a parameterised Markdown file. The repertoire is a folder. This makes capabilities inspectable, versionable, and portable, and it keeps the system's state legible to the user who wants to look.

# Direction versus content

The central interaction problem is the Midas touch: some speech is destined for the record, some directs the machine that keeps it. VoiceMural handles this with an asymmetry rather than a classifier arms race. The captured stream is verbatim and append-only; the artefact is derived from it. Misclassification therefore blemishes but never destroys. Additive and reversible actions such as mark may over-trigger at no cost; anything irreversible or outbound confirms before firing, and confirmation can be deferred to a pause or to the end of the drive.

# Authoring without a screen

Two paths, both by voice:

1. Retrospective crystallisation. The user improvises something, then says "make that a thing." The system induces a capability from the recent transcript, names it, and offers it back. Usage counts accrue from the start, which gives frequency-ordered presentation for free.  
2. Reflexive authoring. A mode whose purpose is authoring capabilities interviews the user. The system is self-hosting.

Verification is the hard part, since the user cannot read the resulting file at 110 km/h. The system restates the capability in one sentence and offers to run it against the last few minutes of the current session, so the user hears the effect rather than the definition.

# Starter repertoire

Drawn from recurring needs observed in the first author's own driving sessions; it doubles as the paper's walkthrough.

* mark (action): flag an idea so it survives the session. Highest frequency, safest to over-trigger.  
* diary (action \+ form): render the session as a dated entry in a fixed structure.  
* to-doc (action \+ outlet): append the entry to a nominated Google Doc.  
* interview (mode): one question at a time, with a parameter controlling immediate feedback, and an exit rule that calls diary.

## *System*

A headless capture service is the primary system; it runs on a phone and needs no display. A desktop console exists for inspection, repair, and export, and is deliberately thin. Output is a folder of Markdown and audio with provenance from every derived sentence back to its offset in the stream. Export happens through named outlets, so findings leave the system by default rather than by effort.

# Method

Prestudy (retrospective). The first author has an existing corpus of voice sessions recorded on a daily 80 km commute. We code every utterance that directed the system rather than contributing content, and report the distribution of intents. This grounds the four capability types and the starter repertoire in observed need rather than assertion. We declare the corpus as self-collected and use it to motivate, not to validate.

Deployment (longitudinal, first person). Autobiographical design in the sense of Neustaedter and Sengers. The measured outcome is the growth curve of the repertoire: which capabilities were added, when, after what triggering episode, and which survived. The claim that needs cannot be specified in advance is testable only by someone who uses the system long enough to be surprised.

Field study (small, if the calendar allows). Three to six participants with regular commutes, two weeks each, with the same growth-curve measure plus interviews on what they tried to add and failed.

# Contributions

1. A four-type abstraction for generative voice interfaces, with an argument for its closure.  
2. In-situ, eyes-free authoring of new capabilities, including retrospective crystallisation and verification by replay.  
3. Empirical evidence that a personal repertoire grows and stabilises through use, from a longitudinal deployment.