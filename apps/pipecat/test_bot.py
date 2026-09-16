"""What reaches the speaker, and what gets written down about it.

The first Python tests in the repo. They cover the two places `bot.py` makes a
decision of its own rather than relaying one — `SilenceGate`, which decides
what a completion becomes as speech, and `TurnRecorder`, which decides what
`agent_turn` learns about it — because a seven-minute two-person drive on
9 Sep 2026 showed both getting it wrong: replies cut off after one word filed
as complete turns, an interrupted `<silence>` read aloud as "sil", and a
`[Speaker 2]` tag spoken as text.

Run where Pipecat is installed, which is the container — the image is the
only place this service's toolchain exists (see the Dockerfile):

    docker cp apps/pipecat/. voice-workspace-pipecat-1:/tmp/pipecat-tests/
    docker exec -u 0 voice-workspace-pipecat-1 sh -c \\
        'pip install -q -r /tmp/pipecat-tests/requirements-dev.txt && chown -R 1001 /tmp/pipecat-tests'
    docker exec -w /tmp/pipecat-tests voice-workspace-pipecat-1 python -m pytest -q

`bot.py` reads its environment at import, so inside the container the
service's own variables serve. Anywhere else, the three below are enough.
"""

import asyncio
import os
import time
import urllib.error

for _name, _value in (
    ("LITELLM_BASE_URL", "http://litellm.test"),
    ("LITELLM_API_KEY", "test"),
    ("ELEVENLABS_VOICE_ID", "test-voice"),
):
    os.environ.setdefault(_name, _value)

import pytest  # noqa: E402

import bot  # noqa: E402  — needs the environment above
from pipecat.frames.frames import (  # noqa: E402
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    MetricsFrame,
    StartFrame,
    TranscriptionFrame,
)
from pipecat.metrics.metrics import (  # noqa: E402
    LLMTokenUsage,
    LLMUsageMetricsData,
    TTFBMetricsData,
)
from pipecat.processors.frame_processor import FrameDirection  # noqa: E402


@pytest.fixture(autouse=True)
def _bare_processor(monkeypatch):
    """Run the gate outside a pipeline.

    `FrameProcessor.process_frame` does the framework's own bookkeeping —
    clocks, task managers, interruption plumbing — none of which exists for a
    processor that was never linked into a pipeline, and none of which is
    what these tests are about. The gate's `super().process_frame` resolves
    against the class at call time, so replacing it here leaves only the
    gate's own logic running.
    """

    async def nothing(self, frame, direction):
        return None

    monkeypatch.setattr(bot.FrameProcessor, "process_frame", nothing)


class FakeRecorder:
    """Stands in for `TurnRecorder`: remembers each call instead of POSTing.

    `calls` are turns that reached the speaker; `declines` are completions
    that did not. Kept apart the way the two tables are.
    """

    def __init__(self, cue=None):
        self.calls = []
        self.declines = []
        self.current = cue or bot.Cue("user_turn", None, 1_000)

    def cue(self):
        return self.current

    def record(self, spoken, generated, *, started_ms=None, barged_in=False, cue=None, metrics=None):
        self.calls.append(
            {
                "spoken": spoken,
                "generated": generated,
                "started_ms": started_ms,
                "barged_in": barged_in,
                "cue": cue,
                "metrics": metrics,
            }
        )

    def decline(self, *, interrupted=False, cue=None):
        self.declines.append({"interrupted": interrupted, "cue": cue})


def drive(frames, recorder=None, llm_name=None):
    """Push frames through a fresh `SilenceGate`; return the text that reached TTS."""
    spoken = []

    async def run():
        gate = bot.SilenceGate(recorder=recorder, llm_name=llm_name)

        async def capture(frame, direction=FrameDirection.DOWNSTREAM):
            if isinstance(frame, LLMTextFrame):
                spoken.append(frame.text)

        gate.push_frame = capture
        for frame in frames:
            await gate.process_frame(frame, FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    return spoken


async def _swallow(frame, direction=FrameDirection.DOWNSTREAM):
    """A push that goes nowhere, for tests that only look at state."""
    return None


def heard(text):
    """A final transcript, as the STT service emits it.

    Pipecat 1.7 made `user_id` and `timestamp` required. Three offer tests
    built the frame from `text` alone and had been failing on that since the
    upgrade; one constructor keeps the next signature change to one line.
    """
    return TranscriptionFrame(text=text, user_id="driver", timestamp="")


def reply(*chunks):
    """One completion, as the LLM service streams it."""
    return [
        LLMFullResponseStartFrame(),
        *(LLMTextFrame(text=chunk) for chunk in chunks),
        LLMFullResponseEndFrame(),
    ]


# --- SilenceGate: what becomes speech ---------------------------------------


def test_complete_sentinel_is_suppressed_even_across_frames():
    recorder = FakeRecorder()
    assert drive(reply("<sil", "ence>"), recorder) == []
    assert recorder.calls == []
    # …but the silence it chose is written down, as a decision.
    assert recorder.declines == [{"interrupted": False, "cue": recorder.current}]


def test_truncated_decline_is_not_spoken():
    # Turn 5 of the 9 Sep drive: the stream ended two tokens into `<silence>`
    # and the old end-of-response fallback read "sil" aloud.
    recorder = FakeRecorder()
    assert drive(reply("<sil"), recorder) == []
    assert recorder.calls == []
    assert len(recorder.declines) == 1


def test_real_reply_streams_and_is_recorded_once():
    recorder = FakeRecorder()
    heard = drive(reply("Yes", ", I can", " hear you."), recorder)
    assert heard == ["Yes", ", I can", " hear you."]
    assert len(recorder.calls) == 1
    call = recorder.calls[0]
    assert call["spoken"] == "Yes, I can hear you."
    assert call["barged_in"] is False
    assert call["started_ms"] is not None


def test_interruption_records_once_with_barge_in():
    # Turns 1–3 of the 9 Sep drive: "The", "So", "There" — replies the next
    # speaker talked over, filed as complete turns because nothing said otherwise.
    recorder = FakeRecorder()
    frames = [
        LLMFullResponseStartFrame(),
        LLMTextFrame(text="The"),
        LLMTextFrame(text=" deadline"),
        InterruptionFrame(),
    ]
    assert drive(frames, recorder) == ["The", " deadline"]
    assert len(recorder.calls) == 1
    assert recorder.calls[0]["spoken"] == "The deadline"
    assert recorder.calls[0]["barged_in"] is True
    assert recorder.declines == []


def test_end_frame_after_interruption_does_not_record_again():
    recorder = FakeRecorder()
    frames = [
        LLMFullResponseStartFrame(),
        LLMTextFrame(text="The"),
        InterruptionFrame(),
        LLMFullResponseEndFrame(),
    ]
    drive(frames, recorder)
    assert len(recorder.calls) == 1
    assert recorder.calls[0]["barged_in"] is True
    assert recorder.declines == []


def test_interruption_while_holding_writes_no_turn_but_a_talked_over_decision():
    recorder = FakeRecorder()
    frames = [LLMFullResponseStartFrame(), LLMTextFrame(text="<sil"), InterruptionFrame()]
    assert drive(frames, recorder) == []
    assert recorder.calls == []  # nothing reached the speaker, so nothing for the echo filter
    assert recorder.declines == [{"interrupted": True, "cue": recorder.current}]


def test_driver_talking_while_nothing_is_in_flight_is_not_a_decision():
    # Pipecat sends InterruptionFrame whenever the driver starts speaking.
    # With no completion running there was no moment to dismiss.
    recorder = FakeRecorder()
    drive([InterruptionFrame()], recorder)
    drive([*reply("Noted."), InterruptionFrame()], recorder)
    assert len(recorder.calls) == 1
    assert recorder.declines == []


def test_the_gate_labels_a_turn_with_the_cue_it_started_under():
    # The driver's next words can arrive while a completion is still
    # streaming; they must not relabel the turn already in flight.
    recorder = FakeRecorder(bot.Cue("silence_offer", None, 5_000))
    offered = recorder.current

    async def run():
        gate = bot.SilenceGate(recorder=recorder)

        async def capture(frame, direction=FrameDirection.DOWNSTREAM):
            pass

        gate.push_frame = capture
        await gate.process_frame(LLMFullResponseStartFrame(), FrameDirection.DOWNSTREAM)
        await gate.process_frame(LLMTextFrame(text="Want the outline?"), FrameDirection.DOWNSTREAM)
        recorder.current = bot.Cue("user_turn", None, 9_000)
        await gate.process_frame(LLMFullResponseEndFrame(), FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    assert recorder.calls[0]["cue"] is offered


def test_no_processor_overwrites_pipecat_s_own_state():
    """Our processors must not reuse a name the framework's base class set.

    Observed: the gate kept its per-turn metrics in `self._metrics`, which is
    where `FrameProcessor` keeps its metrics collector. Every drive then died
    at pipeline start (`'dict' object has no attribute 'setup'`) while every
    test here passed — the tests bypass the framework's setup. This compares
    instance attributes against a bare FrameProcessor instead.
    """
    base = {name: type(value) for name, value in vars(bot.FrameProcessor()).items()}
    processors = [
        bot.SilenceGate(recorder=FakeRecorder(), llm_name="llm"),
        bot.Offers(FakeContext(), FakeRecall(), {}, bot.TurnRecorder(None, None)),
        bot.Recall(FakeLLMContext(), FakeSummary(), None, bot.TurnRecorder(None, None)),
    ]
    for processor in processors:
        for name, value in vars(processor).items():
            if name in base:
                assert type(value) is base[name], (
                    f"{type(processor).__name__}.{name} overwrites FrameProcessor.{name}"
                )


def test_the_gate_keeps_the_llm_s_own_metrics_and_ignores_other_services():
    recorder = FakeRecorder()
    usage = LLMTokenUsage(prompt_tokens=900, completion_tokens=12, total_tokens=912)
    frames = [
        LLMFullResponseStartFrame(),
        MetricsFrame(data=[TTFBMetricsData(processor="stt#0", value=0.9)]),
        MetricsFrame(data=[TTFBMetricsData(processor="llm#0", value=0.412, model="converse")]),
        LLMTextFrame(text="Yes."),
        MetricsFrame(data=[LLMUsageMetricsData(processor="llm#0", value=usage)]),
        LLMFullResponseEndFrame(),
    ]
    drive(frames, recorder, llm_name="llm#0")
    assert recorder.calls[0]["metrics"] == {
        "ttftMs": 412,
        "promptTokens": 900,
        "completionTokens": 12,
        "requestedModel": "converse",
    }


def test_speaker_tag_opening_a_reply_is_held_and_dropped():
    # Turn 4 of the 9 Sep drive, as its tokens arrived.
    recorder = FakeRecorder()
    heard = drive(reply("[", "Speaker", " 2", "]'s", " question", " is theirs."), recorder)
    assert "".join(heard).strip() == "question is theirs."
    assert "[" not in "".join(heard)
    assert recorder.calls[0]["spoken"].strip() == "question is theirs."
    # The record keeps what the model actually produced, tag included.
    assert recorder.calls[0]["generated"].startswith("[Speaker 2]")


def test_speaker_tag_arriving_whole_mid_reply_is_dropped():
    heard = drive(reply("Yes,", " [Speaker 2] the", " deadline is November."))
    assert "".join(heard) == "Yes, the deadline is November."


def test_unclosed_bracket_is_never_spoken():
    assert drive(reply("[Speaker", " 2")) == []


def test_strip_speaker_tags():
    assert bot.strip_speaker_tags("[Speaker 2]'s question is for them.") == "question is for them."
    assert bot.strip_speaker_tags("Yes, [Speaker 1] said so.") == "Yes, said so."
    assert bot.strip_speaker_tags("No tag here.") == "No tag here."


# --- Drafts: what is kept rather than heard -----------------------------------
#
# `extract_drafts` is the Python half of `extractDrafts`
# (packages/talkback/src/prompt.ts); these are the cases from `prompt.test.ts`,
# ported, so the two cannot drift silently. The draft body is the one thing the
# person explicitly asked to take away, so both sides are tolerant on purpose:
# a missing closing tag loses seven characters, not the draft.


def test_extract_draft_keeps_the_body_out_of_the_speech():
    speech, drafts = bot.extract_drafts('Written it down.<draft title="Email">Dear W.</draft>')
    assert speech == "Written it down."
    assert drafts == [{"title": "Email", "text": "Dear W."}]


def test_extract_draft_runs_an_unterminated_block_to_the_end():
    _, drafts = bot.extract_drafts('<draft title="Email">Dear W. and then some')
    assert drafts == [{"title": "Email", "text": "Dear W. and then some"}]


def test_extract_takes_several_drafts_from_one_completion():
    _, drafts = bot.extract_drafts('<draft title="A">one</draft>and<draft title="B">two</draft>')
    assert [d["title"] for d in drafts] == ["A", "B"]


def test_extract_does_not_eat_a_reply_that_merely_contains_the_characters():
    # No `>` closing the tag, so nothing opened.
    speech, drafts = bot.extract_drafts("I would not write <draft without a plan")
    assert drafts == []
    assert speech == "I would not write <draft without a plan"


def test_extract_drops_an_empty_draft():
    _, drafts = bot.extract_drafts('ok<draft title="X">   </draft>')
    assert drafts == []


def test_extract_carries_the_handle_of_a_revised_draft():
    speech, drafts = bot.extract_drafts(
        'Shortened it.<draft revises="3f9a2c" title="Email">Pilot Monday.</draft>'
    )
    assert speech == "Shortened it."
    assert drafts == [{"title": "Email", "text": "Pilot Monday.", "revises": "3f9a2c"}]


def test_extract_reads_the_handle_whichever_order_the_attributes_come_in():
    _, drafts = bot.extract_drafts('<draft title="X" revises="b7e40d" >body</draft>')
    assert drafts[0]["revises"] == "b7e40d"


def test_extract_leaves_revises_off_a_new_draft():
    # ABSENT, not "". The write path tells "this is new" from "this replaces
    # something" by the key being missing.
    for reply in (
        '<draft title="X">body</draft>',
        '<draft revises="" title="X">body</draft>',
        '<draft revises="   " title="X">body</draft>',
    ):
        _, drafts = bot.extract_drafts(reply)
        assert "revises" not in drafts[0], reply


def test_silence_gate_keeps_a_revises_tag_out_of_tts_across_frames():
    # `revises="…"` makes the opening tag long enough to be split several ways
    # by a token stream. `_for_speech` holds from `<draft` until it sees `>`,
    # so none of it — and none of the body — can reach the speaker.
    heard = "".join(
        drive(reply("Shortened it.", "<draft rev", 'ises="3f9a', '2c" title="E', 'mail">Pilot', " Monday.</dr", "aft>"))
    )
    assert heard.strip() == "Shortened it."
    assert "3f9a2c" not in heard
    assert "Pilot" not in heard


# --- TurnRecorder: what agent_turn learns -----------------------------------


TURN_ID = "00000000-0000-4000-8000-00000000a001"


def posted_by(action, recorder=None):
    """Run `action(recorder)` inside a loop; return what it would have POSTed.

    A list of (route, payload), in the order sent. The turn route answers
    with an id, as the real one does, so the decision can point at it.
    """
    posted = []
    recorder = recorder or bot.TurnRecorder(
        ticket="ticket", started_at_ms=1_000, config_version="talkback-test"
    )

    def post(route, payload):
        posted.append((route, payload))
        return {"ok": True, "id": TURN_ID} if route == "agent-turn" else {"ok": True}

    recorder._post = post

    async def run():
        action(recorder)
        # `record` is fire-and-forget through `asyncio.to_thread`.
        await asyncio.sleep(0.2)

    asyncio.run(run())
    return posted


def only(posted, route):
    """The single payload sent to `route`."""
    (payload,) = [p for r, p in posted if r == route]
    return payload


def test_turn_recorder_marks_a_barged_in_turn():
    started = int(time.time() * 1000) - 500

    def act(recorder):
        recorder.note_user("Did I say something right?")
        recorder.record("The", "The deadline is in November.", started_ms=started, barged_in=True)

    posted = posted_by(act)
    payload = only(posted, "agent-turn")
    assert payload["bargedIn"] is True
    assert payload["text"] == "The"
    assert payload["generatedText"] == "The deadline is in November."
    assert payload["respondingToText"] == "Did I say something right?"
    # Cut about half a second in; measured, not estimated from length.
    assert 400 <= payload["truncatedAtMs"] <= 1_500
    assert payload["endOffsetMs"] == payload["startOffsetMs"] + payload["truncatedAtMs"]
    decision = only(posted, "decision")
    assert decision["outcome"] == "interrupted"
    assert decision["agentTurnId"] == TURN_ID


def test_turn_recorder_estimates_the_end_of_an_uninterrupted_turn():
    text = "Yes, I can hear you."

    def act(recorder):
        recorder.record(text, text)

    payload = only(posted_by(act), "agent-turn")
    assert "bargedIn" not in payload
    assert "truncatedAtMs" not in payload
    assert payload["endOffsetMs"] == payload["startOffsetMs"] + int(len(text) / 14 * 1000)


def test_turn_recorder_ignores_empty_speech():
    def act(recorder):
        recorder.record("   ", "<silence>")

    assert posted_by(act) == []


def test_a_spoken_reply_writes_the_turn_first_then_a_decision_pointing_at_it():
    def act(recorder):
        recorder.note_user("What was the second paper?")
        recorder.record("The EICS one.", "The EICS one.", started_ms=int(time.time() * 1000))

    posted = posted_by(act)
    assert [route for route, _ in posted] == ["agent-turn", "decision"]
    turn, decision = posted[0][1], posted[1][1]
    assert turn["kind"] == "reply"
    assert turn["configVersion"] == "talkback-test"
    assert "totalLatencyMs" in turn
    assert decision == {
        "ticket": "ticket",
        "seq": 0,
        "offsetMs": decision["offsetMs"],
        "trigger": "user_turn",
        "outcome": "spoke",
        "configVersion": "talkback-test",
        "latencyMs": decision["latencyMs"],
        "agentTurnId": TURN_ID,
    }


def test_a_declined_user_turn_writes_a_decision_and_no_turn():
    def act(recorder):
        recorder.note_user("so the thing about the intro is")
        recorder.decline()

    posted = posted_by(act)
    assert [route for route, _ in posted] == ["decision"]
    decision = posted[0][1]
    assert (decision["trigger"], decision["outcome"]) == ("user_turn", "declined")
    assert "agentTurnId" not in decision
    assert "text" not in decision and "generatedText" not in decision


def test_a_declined_offer_is_recorded_as_a_declined_offer():
    def act(recorder):
        recorder.note_user("okay")
        recorder.note_offer("silence_offer")
        recorder.decline(cue=recorder.cue())

    decision = only(posted_by(act), "decision")
    assert (decision["trigger"], decision["outcome"]) == ("silence_offer", "declined")


def test_a_turn_talked_over_before_its_first_word_is_a_decision_only():
    def act(recorder):
        recorder.note_user("hmm")
        recorder.decline(interrupted=True)

    posted = posted_by(act)
    assert [route for route, _ in posted] == ["decision"]
    assert posted[0][1]["outcome"] == "interrupted"
    assert "latencyMs" not in posted[0][1]


def test_an_offered_turn_is_a_proactive_prompt_answering_nobody():
    def act(recorder):
        recorder.note_user("That's the ethics form sorted.")
        recorder.note_offer("opening")
        recorder.record("Want to pick up the intro?", "Want to pick up the intro?")

    posted = posted_by(act)
    turn = only(posted, "agent-turn")
    assert turn["kind"] == "proactive_prompt"
    # An offer answers nothing; filing it against their last words would say it did.
    assert "respondingToText" not in turn
    assert only(posted, "decision")["trigger"] == "opening"


def test_an_ask_about_a_parked_action_awaits_the_driver_s_next_words_once():
    recorder = bot.TurnRecorder(ticket="ticket", started_at_ms=1_000)

    def act(r):
        r.note_user("Right, the intro's done.")
        r.note_pending("inv-1")
        r.record("Send the diary entry to the doc now?", "Send the diary entry to the doc now?")

    posted = posted_by(act, recorder)
    assert only(posted, "agent-turn")["kind"] == "confirmation_request"
    decision = only(posted, "decision")
    assert (decision["trigger"], decision["subjectKey"]) == ("confirmation", "inv-1")
    assert recorder.take_awaiting_answer() == "inv-1"
    assert recorder.take_awaiting_answer() is None  # handed over once


def test_a_reply_that_lets_the_ask_keep_awaits_nothing():
    recorder = bot.TurnRecorder(ticket="ticket", started_at_ms=1_000)

    def act(r):
        r.note_user("and the other thing is the related work")
        r.note_pending("inv-1")
        r.record("Mark's interruption paper fits there.", "Mark's interruption paper fits there.")

    posted = posted_by(act, recorder)
    assert only(posted, "agent-turn")["kind"] == "reply"
    # Still ABOUT the parked action — it was in front of the model.
    assert only(posted, "decision")["subjectKey"] == "inv-1"
    assert recorder.take_awaiting_answer() is None


def test_a_later_turn_moves_on_from_an_unanswered_ask():
    recorder = bot.TurnRecorder(ticket="ticket", started_at_ms=1_000)

    def act(r):
        r.note_user("done")
        r.note_pending("inv-1")
        r.record("Send it now?", "Send it now?")
        r.note_offer("silence_offer")
        r.record("Want the outline?", "Want the outline?")

    posted_by(act, recorder)
    assert recorder.take_awaiting_answer() is None


def test_a_pending_ask_does_not_relabel_an_offer():
    recorder = bot.TurnRecorder(ticket="ticket", started_at_ms=1_000)
    recorder.note_offer("silence_offer")
    recorder.note_pending("inv-1")
    assert recorder.cue().trigger == "silence_offer"


# --- Recall: the answer rides on the next context fetch ----------------------


class FakeSummary:
    summary = ""


class FakeLLMContext:
    def __init__(self):
        self.messages = [{"role": "system", "content": "base"}]

    def add_message(self, message):
        self.messages.append(message)

    def get_messages(self):
        return self.messages

    def set_messages(self, messages):
        self.messages[:] = messages


def test_recall_sends_the_driver_s_words_as_the_answer_and_notes_what_is_pending():
    recorder = bot.TurnRecorder(ticket="ticket", started_at_ms=1_000)
    recorder._awaiting_answer = "inv-1"
    recall = bot.Recall(FakeLLMContext(), FakeSummary(), "ticket", recorder)
    fetched = []

    def fetch(said, answering=None):
        fetched.append((said, answering))
        return (
            [],
            [],
            {"invocationId": "inv-2", "restatement": "send it", "askedCount": 0},
            None,
            "yes",
            None,
        )

    recall._fetch = fetch

    async def run():
        async def capture(frame, direction=FrameDirection.DOWNSTREAM):
            pass

        recall.push_frame = capture
        await recall.process_frame(heard("yes go ahead"), FrameDirection.DOWNSTREAM)
        await recall.process_frame(heard("and then"), FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    assert fetched == [("yes go ahead", "inv-1"), ("and then", None)]
    assert recorder.cue().trigger == "confirmation"
    assert recorder.cue().subject_key == "inv-2"


def test_a_repeat_ask_is_worded_to_be_let_go_of():
    recall = bot.Recall(FakeLLMContext(), FakeSummary(), None)
    first = recall._compose([], {"restatement": "send the diary", "askedCount": 0})
    repeat = recall._compose([], {"restatement": "send the diary", "askedCount": 1})
    assert "ask in one short sentence" in first
    assert "already asked about it once" in repeat
    assert "ask in one short sentence" not in repeat


# --- The study condition decides whether offers run -------------------------


def test_the_turn_fallback_defaults_short_and_stays_within_bounds(monkeypatch):
    monkeypatch.delenv("USER_TURN_STOP_TIMEOUT_SECS", raising=False)
    assert bot.user_turn_stop_timeout_secs() == 2.0  # not Pipecat's 5.0
    for raw, expected in (("1.5", 1.5), ("0.1", 1.0), ("30", 5.0), ("soon", 2.0), ("", 2.0)):
        monkeypatch.setenv("USER_TURN_STOP_TIMEOUT_SECS", raw)
        assert bot.user_turn_stop_timeout_secs() == expected


def test_offers_follow_the_drive_s_condition_and_fall_back_to_the_env_only_when_degraded(monkeypatch):
    monkeypatch.setattr(bot, "PROACTIVE_OFFERS", True)
    assert bot.offers_enabled({"studyCondition": {"proactiveOffers": False}}) is False
    assert bot.offers_enabled({"studyCondition": {"proactiveOffers": True}}) is True
    assert bot.offers_enabled({"degraded": True, "studyCondition": {"proactiveOffers": False}}) is True
    assert bot.offers_enabled({}) is True
    monkeypatch.setattr(bot, "PROACTIVE_OFFERS", False)
    assert bot.offers_enabled({"degraded": True}) is False
    assert bot.offers_enabled({"studyCondition": {"proactiveOffers": True}}) is True


def test_an_engine_under_a_no_offers_condition_never_arms(monkeypatch):
    engine = offers_with(monkeypatch, {"studyCondition": {"proactiveOffers": False}})

    async def run():
        await engine.process_frame(StartFrame(), FrameDirection.DOWNSTREAM)
        await engine.process_frame(heard("hello"), FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    engine.note_agent_turn(spoke=False)
    assert engine._log == []


# --- DraftRecorder: what agent_draft learns ----------------------------------


def drafts_posted_by(action, first_seq=0):
    """Run `action(recorder)` inside a loop and return what it would have POSTed."""
    posted = []
    recorder = bot.DraftRecorder(
        ticket="ticket", started_at_ms=int(time.time() * 1000), first_seq=first_seq
    )
    recorder._post = posted.append

    async def run():
        action(recorder)
        # `record` is fire-and-forget through `asyncio.to_thread`.
        await asyncio.sleep(0.2)

    asyncio.run(run())
    return posted


def test_draft_recorder_passes_the_revised_handle_through():
    def act(recorder):
        recorder.note_user("Make it shorter.")
        recorder.record(
            [
                {"title": "Email", "text": "Pilot Monday.", "revises": "3f9a2c"},
                {"title": "Notes", "text": "Something new."},
            ]
        )

    revision, fresh = drafts_posted_by(act)
    assert revision["revises"] == "3f9a2c"
    assert revision["respondingToText"] == "Make it shorter."
    # A new draft carries no handle at all, so the web app has nothing to
    # resolve and writes a new row.
    assert "revises" not in fresh


def test_draft_recorder_counts_on_from_the_seeded_seq():
    # A reconnect mid-drive. Counting from 0 again would collide with the rows
    # this drive already has, and `recordDraft` resolves a collision by doing
    # nothing — so every draft for the rest of the drive would vanish behind a
    # 200.
    def act(recorder):
        recorder.record([{"title": "A", "text": "one"}, {"title": "B", "text": "two"}])

    assert [p["seq"] for p in drafts_posted_by(act, first_seq=3)] == [3, 4]
    assert [p["seq"] for p in drafts_posted_by(act)] == [0, 1]


# --- Offers: the proactive engine's state machine ----------------------------
#
# The engine's timing is an asyncio task inside the pipeline; what is tested
# here is every DECISION around it — what arms, what cancels, what fires and
# what the guards refuse — because those are the rules the prompt makes
# mechanical: never mid-thought, never twice without a reply, back off on a
# declined offer.


class FakeTask:
    def __init__(self, log):
        self._log = log

    def cancel(self):
        self._log.append("cancel")


class FakeRecall:
    def __init__(self):
        self.blocks = 0

    def ensure_block(self):
        self.blocks += 1


class FakeContext:
    def __init__(self):
        self.messages = []

    def add_message(self, message):
        self.messages.append(message)


def offers_with(monkeypatch, session=None, recall=None):
    """A fresh engine with the timer disarmed into a log of arm/cancel calls.

    `asyncio.sleep` is a no-op for the engine's lifetime so `_fire` can be
    exercised directly without waiting real seconds; `create_task` needs the
    pipeline's task manager, which a bare processor has not got, so arming is
    recorded instead of scheduled.
    """

    async def now(_secs):
        return None

    monkeypatch.setattr(bot.asyncio, "sleep", now)

    log = []
    engine = bot.Offers(FakeContext(), recall or FakeRecall(), session or {})

    def create_task(coro, name=None):
        coro.close()
        log.append("arm")
        return FakeTask(log)

    monkeypatch.setattr(engine, "create_task", create_task)
    engine._log = log
    return engine


def test_engine_reads_its_patience_from_the_proactivity_level():
    assert bot.PROACTIVE_AFTER_SECS["quiet"] == 25
    with pytest.MonkeyPatch.context() as mp:
        assert offers_with(mp, {"proactivity": "forthcoming"})._delay == 7
        # A degraded session knows nothing; the driving default's patience applies.
        assert offers_with(mp, {})._delay == 25


def test_completed_speech_arms_and_resumed_speech_cancels(monkeypatch):
    engine = offers_with(monkeypatch)

    async def run():
        await engine.process_frame(StartFrame(), FrameDirection.DOWNSTREAM)
        assert engine._log == ["arm"]  # the opening turn is armed on start
        await engine.process_frame(bot.VADUserStartedSpeakingFrame(), FrameDirection.DOWNSTREAM)
        assert engine._log == ["arm", "cancel"]  # …and speech beat it
        engine._log.clear()
        await engine.process_frame(heard("hello there"), FrameDirection.DOWNSTREAM)
        assert engine._log == ["arm"]  # a completed turn re-arms

    asyncio.run(run())


def test_a_spoken_agent_turn_blocks_until_the_driver_replies(monkeypatch):
    engine = offers_with(monkeypatch)

    async def arm():
        await engine.process_frame(heard("hi"), FrameDirection.DOWNSTREAM)

    asyncio.run(arm())  # a completed turn holds one armed offer

    engine.note_agent_turn(spoke=True)
    assert engine._awaiting_user is True
    assert engine._log == ["arm", "cancel"]  # the pending offer was cancelled

    async def run():
        # The guard holds even if a stray timer were to expire.
        await engine._fire(engine._delay, opening=False)
        assert engine._context.messages == []  # nothing was offered

    asyncio.run(run())

    # The driver's next completed words clear the rule and re-arm.
    async def run2():
        await engine.process_frame(heard("back"), FrameDirection.DOWNSTREAM)

    asyncio.run(run2())
    assert engine._awaiting_user is False
    assert engine._log[-1] == "arm"


def test_a_declined_offer_backs_off_and_speech_resets_the_backoff(monkeypatch):
    engine = offers_with(monkeypatch)
    base = engine._delay
    engine.note_agent_turn(spoke=False)
    assert engine._backoff == 2  # same question, asked less often
    engine.note_agent_turn(spoke=False)
    assert engine._backoff == 4
    assert engine._backoff * base <= bot.Offers.BACKOFF_CAP_SECS or engine._backoff == 4

    async def run():
        await engine.process_frame(heard("hi"), FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    assert engine._backoff == 1


def test_firing_offers_a_turn_in_the_driver_s_slot(monkeypatch):
    recall = FakeRecall()
    context = FakeContext()
    engine = bot.Offers(context, recall, {"proactivity": "occasional"})

    async def fire():
        # Sleep is patched for engines from `offers_with`; patch this one too,
        # then fire at the real interval so the instruction names it.
        async def now(_secs):
            return None

        monkeypatch.setattr(bot.asyncio, "sleep", now)
        await engine._fire(engine._delay, opening=False)

    asyncio.run(fire())
    assert len(context.messages) == 1
    assert context.messages[0]["role"] == "user"
    assert "12 seconds" in context.messages[0]["content"]
    assert "<silence>" in context.messages[0]["content"]


def test_the_opening_turn_uses_its_own_instruction_and_seeds_the_block(monkeypatch):
    recall = FakeRecall()
    context = FakeContext()
    engine = bot.Offers(context, recall, {})

    async def fire():
        async def now(_secs):
            return None

        monkeypatch.setattr(bot.asyncio, "sleep", now)
        await engine._fire(2.5, opening=True)

    asyncio.run(fire())
    assert recall.blocks == 1  # the reconnect summary became the background
    assert "drive is just starting" in context.messages[0]["content"]


def test_firing_tells_the_recorder_the_moment_is_an_offer(monkeypatch):
    recorder = bot.TurnRecorder(ticket=None, started_at_ms=None)
    engine = bot.Offers(FakeContext(), FakeRecall(), {}, recorder)

    async def fire(opening):
        async def now(_secs):
            return None

        monkeypatch.setattr(bot.asyncio, "sleep", now)
        await engine._fire(2.5, opening=opening)

    asyncio.run(fire(True))
    assert recorder.cue().trigger == "opening"
    engine._awaiting_user = False
    asyncio.run(fire(False))
    assert recorder.cue().trigger == "silence_offer"


def test_silence_gate_reports_what_a_turn_became():
    """The engine learns from the gate, like the summary does — not from frames the gate suppresses."""
    notes = []

    class FakeOffers:
        def note_agent_turn(self, spoke):
            notes.append(spoke)

    async def run():
        gate = bot.SilenceGate(offers=FakeOffers())

        async def capture(frame, direction=FrameDirection.DOWNSTREAM):
            pass

        gate.push_frame = capture
        for frame in reply("<silence>"):
            await gate.process_frame(frame, FrameDirection.DOWNSTREAM)
        for frame in reply("Noted."):
            await gate.process_frame(frame, FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    assert notes == [False, True]


# --- Board tools: the agent's hands, carried to the web app -----------------


SESSION_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "move_task",
            "description": "Move a task.",
            "parameters": {
                "type": "object",
                "properties": {"card": {"type": "string"}, "column": {"type": "string"}},
                "required": ["card", "column"],
            },
        },
    }
]


def test_the_session_s_tools_become_pipecat_schemas_and_none_means_none():
    schema = bot.BoardTools.schemas(SESSION_TOOLS)
    assert [s.name for s in schema.standard_tools] == ["move_task"]
    assert schema.standard_tools[0].required == ["card", "column"]
    assert bot.BoardTools.schemas([]) is None
    assert bot.BoardTools.schemas(None) is None


def run_tool(tools, name, arguments):
    """Call the handler as Pipecat would; return what the model was handed."""
    from types import SimpleNamespace

    results = []

    async def result_callback(result, **_):
        results.append(result)

    params = SimpleNamespace(function_name=name, arguments=arguments, result_callback=result_callback)
    asyncio.run(tools.handle(params))
    return results


def test_a_board_tool_call_is_posted_verbatim_and_its_answer_handed_to_the_model():
    recorder = bot.TurnRecorder(ticket="ticket", started_at_ms=1_000)
    tools = bot.BoardTools("ticket", recorder)
    posted = []

    def post(payload):
        posted.append(payload)
        return {"ok": True, "changed": True, "task": "Write up the asymmetry argument.", "column": "dropped"}

    tools._post = post
    results = run_tool(tools, "move_task", {"card": "1225b3", "column": "dropped"})

    (payload,) = posted
    assert payload["tool"] == "move_task"
    assert payload["arguments"] == {"card": "1225b3", "column": "dropped"}
    assert payload["ticket"] == "ticket"
    assert len(payload["opId"]) == 36  # a uuid: the row id that makes a retry a no-op
    assert results == [{"ok": True, "changed": True, "task": "Write up the asymmetry argument.", "column": "dropped"}]
    assert recorder._tool_calls[0]["name"] == "move_task"
    assert "error" not in recorder._tool_calls[0]


def test_an_unreachable_board_is_told_to_the_model_in_words_not_raised():
    recorder = bot.TurnRecorder(ticket="ticket", started_at_ms=1_000)
    tools = bot.BoardTools("ticket", recorder)

    def post(payload):
        raise OSError("connection refused")

    tools._post = post
    (result,) = run_tool(tools, "move_task", {"card": "1225b3", "column": "dropped"})
    assert result["ok"] is False
    assert "Nothing was changed" in result["error"]
    assert recorder._tool_calls[0]["error"] == "connection refused"


def test_the_turn_after_a_tool_call_carries_the_call_and_the_next_does_not():
    def act(recorder):
        recorder.note_user("drop the asymmetry one")
        recorder.note_tool_call("move_task", 180)
        recorder.record("Dropped the asymmetry argument.", "Dropped the asymmetry argument.")
        recorder.note_user("thanks")
        recorder.record("Sure.", "Sure.")

    turns = [p for route, p in posted_by(act) if route == "agent-turn"]
    assert turns[0]["toolCalls"] == [{"name": "move_task", "latencyMs": 180}]
    assert "toolCalls" not in turns[1]


def test_a_completion_that_only_calls_a_tool_is_not_a_declined_turn():
    """The reply comes from the completion Pipecat runs after the tool answers."""
    recorder = FakeRecorder()
    notes = []

    class FakeOffers:
        def note_agent_turn(self, spoke):
            notes.append(spoke)

    from pipecat.frames.frames import FunctionCallFromLLM

    call = FunctionCallFromLLM(
        function_name="move_task", tool_call_id="call-1", arguments={"card": "1225b3"}, context=None
    )

    async def run():
        gate = bot.SilenceGate(recorder=recorder, offers=FakeOffers())

        async def capture(frame, direction=FrameDirection.DOWNSTREAM):
            pass

        gate.push_frame = capture
        await gate.process_frame(LLMFullResponseStartFrame(), FrameDirection.DOWNSTREAM)
        await gate.process_frame(bot.FunctionCallsStartedFrame(function_calls=[call]), FrameDirection.DOWNSTREAM)
        await gate.process_frame(LLMFullResponseEndFrame(), FrameDirection.DOWNSTREAM)
        # …and the follow-up completion, once the tool has answered.
        for frame in reply("Dropped the asymmetry argument."):
            await gate.process_frame(frame, FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    assert recorder.declines == []
    assert [c["spoken"] for c in recorder.calls] == ["Dropped the asymmetry argument."]
    assert notes == [True]  # only the spoken turn reached the engine


# --- TopicTitle: what the title is told, and how often -----------------------
# The recorder shows ONE short title of what is being talked about now, and
# blurs it across to the new one when it changes. Two things decide whether
# that is bearable to sit next to for a whole drive: how often the container
# calls the model, and whether an unchanged subject is allowed to re-push. Both
# are tested here; the blur itself is the browser's (topic-title.tsx).


def titler(monkeypatch, prompt="name it", reply=None, replies=None):
    """A `TopicTitle` with the model faked and the task manager stood in for.

    Like `offers_with`: `create_task` needs a pipeline the bare processor has
    not got, so the coroutine is RUN here instead of scheduled — which also
    makes the call synchronous for the test, and the cadence is what is being
    measured, not the concurrency.
    """
    answers = list(replies) if replies is not None else [reply]
    asked = []

    def chat(messages, *, max_tokens, metadata):
        asked.append(messages)
        return answers.pop(0) if answers else None

    monkeypatch.setattr(bot, "_litellm_chat", chat)

    processor = bot.TopicTitle(prompt)
    pushed = []

    async def capture(frame, direction=FrameDirection.DOWNSTREAM):
        pushed.append(frame)

    processor.push_frame = capture
    processor.create_task = _plain_task
    processor.asked = asked
    processor.pushed = pushed
    return processor


def _plain_task(coro, name=None):
    """Stand in for the pipeline's task manager, which a bare processor lacks."""
    return asyncio.get_running_loop().create_task(coro)


async def settled(processor):
    """Let the naming task finish.

    It ends in `asyncio.to_thread`, so yielding once is not enough — the thread
    has to be joined before the push it makes can be observed.
    """
    if processor._task is not None:
        await processor._task


def messages_pushed(processor):
    return [f for f in processor.pushed if isinstance(f, bot.RTVIServerMessageFrame)]


def test_clean_title_strips_what_a_board_cannot_show():
    assert bot.clean_title('"Funding round."', None) == "Funding round"
    assert bot.clean_title("**Tuesday deadline**", None) == "Tuesday deadline"
    assert bot.clean_title("  Split   flap  board \n", None) == "Split flap board"


def test_clean_title_caps_at_four_words_and_thirty_two_characters():
    assert bot.clean_title("one two three four five", None) == "one two three four"
    long = bot.clean_title("Immunotherapy reimbursement negotiation timeline", None)
    assert len(long) <= 32
    assert long == "Immunotherapy reimbursement"


def test_clean_title_reports_nothing_to_change():
    assert bot.clean_title(None, "Funding round") is None
    assert bot.clean_title("   ", "Funding round") is None
    assert bot.clean_title("NONE", None) is None
    # The common case: the model was asked to return the current title when the
    # subject has not moved, and does. The board must not re-flip to itself.
    assert bot.clean_title("Funding round", "Funding round") is None
    assert bot.clean_title("FUNDING ROUND", "Funding round") is None


def test_the_board_stays_quiet_below_the_thresholds(monkeypatch):
    processor = titler(monkeypatch, reply="Funding round")

    async def run():
        # Well under CALL_AFTER_CHARS, and no time has passed.
        await processor.process_frame(heard("so anyway"), FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    assert processor.asked == []
    assert messages_pushed(processor) == []
    # The transcript itself went straight on regardless.
    assert len(processor.pushed) == 1


def test_enough_speech_after_the_gap_names_the_subject_once(monkeypatch):
    processor = titler(monkeypatch, reply="Funding round")

    async def run():
        # The gap, as if the drive had been running.
        processor._last_call -= bot.TopicTitle.MIN_GAP_SECONDS + 1
        await processor.process_frame(
            heard("x" * bot.TopicTitle.CALL_AFTER_CHARS), FrameDirection.DOWNSTREAM
        )
        await settled(processor)

    asyncio.run(run())
    assert len(processor.asked) == 1
    assert processor.title == "Funding round"


def test_any_speech_names_the_subject_once_it_is_overdue(monkeypatch):
    processor = titler(monkeypatch, reply="Funding round")

    async def run():
        # Far too little speech for the char threshold, but long enough that a
        # slow talker should still get a board.
        processor._last_call -= bot.TopicTitle.CALL_AFTER_SECONDS + 1
        await processor.process_frame(heard("mm the funding"), FrameDirection.DOWNSTREAM)
        await settled(processor)

    asyncio.run(run())
    assert len(processor.asked) == 1


def test_a_changed_title_is_pushed_to_the_browser_exactly_once(monkeypatch):
    processor = titler(monkeypatch, reply="Funding round")

    async def run():
        processor._last_call -= bot.TopicTitle.CALL_AFTER_SECONDS + 1
        await processor.process_frame(heard("about the funding"), FrameDirection.DOWNSTREAM)
        await settled(processor)

    asyncio.run(run())
    messages = messages_pushed(processor)
    assert len(messages) == 1
    assert messages[0].data == {"type": "title", "title": "Funding round"}


def test_the_same_subject_named_again_pushes_nothing(monkeypatch):
    processor = titler(monkeypatch, replies=["Funding round", "Funding round"])

    async def run():
        for _ in range(2):
            processor._last_call -= bot.TopicTitle.CALL_AFTER_SECONDS + 1
            await processor.process_frame(heard("still the funding"), FrameDirection.DOWNSTREAM)
            await settled(processor)

    asyncio.run(run())
    assert len(processor.asked) == 2  # it asked twice…
    assert len(messages_pushed(processor)) == 1  # …and the board moved once


def test_a_failed_call_is_logged_and_the_next_trigger_retries(monkeypatch):
    def boom(messages, *, max_tokens, metadata):
        raise urllib.error.URLError("proxy down")

    monkeypatch.setattr(bot, "_litellm_chat", boom)
    processor = bot.TopicTitle("name it")
    processor.push_frame = _swallow
    processor.create_task = _plain_task

    async def run():
        processor._last_call -= bot.TopicTitle.CALL_AFTER_SECONDS + 1
        await processor.process_frame(heard("about the funding"), FrameDirection.DOWNSTREAM)
        await settled(processor)

    asyncio.run(run())
    assert processor.title is None


def test_a_container_with_no_title_prompt_never_calls(monkeypatch):
    """An older web app sends no `titlePrompt`. Then the board simply never runs."""
    processor = titler(monkeypatch, prompt="", reply="Funding round")

    async def run():
        processor._last_call -= bot.TopicTitle.CALL_AFTER_SECONDS + 1
        await processor.process_frame(heard("x" * 400), FrameDirection.DOWNSTREAM)
        await settled(processor)

    asyncio.run(run())
    assert processor.asked == []
    assert messages_pushed(processor) == []


def test_the_gate_tells_the_board_what_the_driver_heard():
    """The agent's own phrase for the subject is half of what names it."""
    noted = []

    class FakeTitle:
        def note_agent(self, text):
            noted.append(text)

    async def run():
        gate = bot.SilenceGate(title=FakeTitle())
        gate.push_frame = _swallow
        for frame in reply("The Tuesday deadline is the binding one."):
            await gate.process_frame(frame, FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    assert "".join(noted) == "The Tuesday deadline is the binding one."


# --- Web search -------------------------------------------------------------

SEARCH_RATE = 24_000
SEARCH_CHUNK = b"\x00\x00" * (SEARCH_RATE // 25)  # 40ms of silence, the transport's chunk


def peak(audio: bytes) -> int:
    import numpy as np

    return int(np.abs(np.frombuffer(audio, dtype=np.int16).astype(np.int32)).max())


def started_sound():
    sound = bot.SearchingSound()
    asyncio.run(sound.start(SEARCH_RATE))
    return sound


def test_the_search_cue_leaves_the_audio_untouched_until_a_search_begins():
    sound = started_sound()
    assert sound.mix_now(SEARCH_CHUNK) is SEARCH_CHUNK

    sound.begin()
    first = sound.mix_now(SEARCH_CHUNK)
    assert len(first) == len(SEARCH_CHUNK)
    assert peak(first) > 0


def test_the_search_cue_fades_out_over_one_chunk_and_then_costs_nothing():
    sound = started_sound()
    sound.begin()
    for _ in range(3):
        sound.mix_now(SEARCH_CHUNK)
    sound.end()
    sound.mix_now(SEARCH_CHUNK)  # the fade
    assert sound.mix_now(SEARCH_CHUNK) is SEARCH_CHUNK


def test_the_search_cue_ducks_under_speech():
    import numpy as np

    speech = (np.sin(np.arange(len(SEARCH_CHUNK) // 2) / 3) * 8_000).astype(np.int16).tobytes()

    def cue_level(audio: bytes) -> int:
        sound = started_sound()
        sound.begin()
        sound.mix_now(audio)  # settle the ramp
        sound._pos = 0  # compare the same stretch of the cue
        mixed = np.frombuffer(sound.mix_now(audio), dtype=np.int16).astype(np.int32)
        return int(np.abs(mixed - np.frombuffer(audio, dtype=np.int16)).max())

    assert cue_level(speech) < cue_level(SEARCH_CHUNK) * 0.5


class FakeLLM:
    def __init__(self):
        self.pushed = []

    async def push_frame(self, frame, direction=None):
        self.pushed.append(frame)


def run_search(search, arguments, *, cancel_after=None):
    """Call the search handler as Pipecat would; return (spoken, results)."""
    from types import SimpleNamespace

    llm = FakeLLM()
    results = []

    async def result_callback(result, **_):
        results.append(result)

    params = SimpleNamespace(
        function_name="search_web", arguments=arguments, llm=llm, result_callback=result_callback
    )

    async def run():
        task = asyncio.create_task(search.handle(params))
        if cancel_after is None:
            await task
            return
        await asyncio.sleep(cancel_after)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    return [f.text for f in llm.pushed if isinstance(f, bot.TTSSpeakFrame)], results


class RecordingSound:
    def __init__(self):
        self.events = []

    def begin(self):
        self.events.append("begin")

    def end(self):
        self.events.append("end")


def test_a_search_announces_itself_plays_the_cue_and_hands_back_the_result():
    sound = RecordingSound()
    recorder = FakeRecorder()
    recorder.announcements = []
    recorder.tool_calls = []
    recorder.record_announcement = recorder.announcements.append
    recorder.note_tool_call = lambda name, ms, error=None: recorder.tool_calls.append((name, error))

    search = bot.WebSearch("ticket", sound, recorder)
    posted = []

    def post(payload):
        assert sound.events == ["begin"], "the cue must be playing while the request is out"
        posted.append(payload)
        return {"ok": True, "query": "CHI 2027 deadline", "results": []}

    search._post = post
    spoken, results = run_search(
        search, {"query": "CHI 2027 deadline", "announcement": "Let me look up the CHI deadline."}
    )

    assert spoken == ["Let me look up the CHI deadline."]
    assert recorder.announcements == ["Let me look up the CHI deadline."]
    assert posted == [
        {
            "ticket": "ticket",
            "arguments": {"query": "CHI 2027 deadline", "announcement": "Let me look up the CHI deadline."},
        }
    ]
    assert sound.events == ["begin", "end"]
    assert results == [{"ok": True, "query": "CHI 2027 deadline", "results": []}]
    assert recorder.tool_calls == [("search_web", None)]


def test_a_search_with_no_announcement_still_says_what_it_is_doing():
    assert bot.WebSearch.announcement({"query": "CHI deadline"}) == "Searching the web for CHI deadline."
    assert bot.WebSearch.announcement({"query": "x " * 50}) == "Let me look that up."
    assert bot.WebSearch.announcement({}) == "Let me look that up."


def test_a_failed_search_is_told_to_the_model_in_words_and_the_cue_stops():
    sound = RecordingSound()
    search = bot.WebSearch("ticket", sound)

    def post(payload):
        raise OSError("connection refused")

    search._post = post
    _, (result,) = run_search(search, {"query": "q", "announcement": "Looking."})
    assert result == {"ok": False, "error": "The search could not be reached."}
    assert sound.events == ["begin", "end"]


def test_a_search_the_driver_talks_over_stops_the_cue_and_answers_nothing():
    sound = RecordingSound()
    search = bot.WebSearch("ticket", sound)
    # A request still out when the driver starts talking. Short, because the
    # loop waits for the worker thread on the way out.
    search._post = lambda payload: time.sleep(0.3) or {"ok": True}

    _, results = run_search(search, {"query": "q", "announcement": "Looking."}, cancel_after=0.05)
    assert sound.events == ["begin", "end"]
    assert results == []


def test_an_announcement_is_an_agent_turn_but_not_a_decision_and_keeps_the_tool_calls():
    recorder = bot.TurnRecorder(ticket="ticket", started_at_ms=1_000, config_version="talkback-test")

    def act(recorder):
        recorder.note_user("when is the CHI deadline")
        recorder.note_tool_call("move_task", 120)
        recorder.record_announcement("Let me look up the CHI deadline.")

    posted = posted_by(act, recorder)
    assert [route for route, _ in posted] == ["agent-turn"]
    (_, turn) = posted[0]
    assert turn["text"] == "Let me look up the CHI deadline."
    assert turn["respondingToText"] == "when is the CHI deadline"
    assert "toolCalls" not in turn
    # Still waiting for the turn that answers.
    assert recorder._tool_calls == [{"name": "move_task", "latencyMs": 120}]
# --- Recall: what the model is shown, and in what order ------------------------
#
# `_compose` is mirrored in packages/talkback/src/eval/messages.ts, so an
# evaluation and a real drive see the same block. The ORDER is the load-bearing
# part: the running summary has to be last, because "that" and "the second one"
# resolve against it, and everything else is background above it.


class FakeSummary:
    def __init__(self, summary=None):
        self.summary = summary


class FakeLLMContext:
    def __init__(self):
        self._messages = []

    def add_message(self, message):
        self._messages.append(message)

    def get_messages(self):
        return self._messages

    def set_messages(self, messages):
        self._messages[:] = messages


def a_recall(summary=None, ticket="ticket"):
    return bot.Recall(FakeLLMContext(), FakeSummary(summary), ticket)


def test_compose_puts_drafts_after_the_quotes_and_before_the_drive():
    block = a_recall(summary="- Decision: go voice-first")._compose(
        [{"when": "yesterday", "text": "call Niklas"}],
        None,
        [{"text": "Topic: Field study"}],
        "Their task board right now:\n- [doing] Write the method section",
        'Drafts you have written on this drive, and which you can still see:\ndraft 3f9a2c "Email" (v1.0, written by you)',
    )

    order = [
        block.index("Their task board right now:"),
        block.index("Where things stand"),
        block.index("From their past recordings:"),
        block.index("Drafts you have written"),
        block.index("So far in this drive:"),
    ]
    assert order == sorted(order)


def test_compose_says_nothing_when_there_is_nothing_to_say():
    assert a_recall()._compose([], None, [], None, None) is None
    # …but one draft alone is worth a block: it is the difference between
    # revising the email and writing a second one.
    assert "draft 3f9a2c" in a_recall()._compose([], None, [], None, "draft 3f9a2c")


def test_recall_composes_the_block_from_what_the_route_returned(monkeypatch):
    recall = a_recall()
    recall._fetch = lambda said, answering=None: (
        [{"when": "yesterday", "text": "call Niklas"}],
        [{"text": "Topic: Field study"}],
        None,
        "Their task board right now:\n- [doing] Write the method section",
        None,
        'Drafts you have written on this drive, and which you can still see:\ndraft 3f9a2c "Email" (v1.0, written by you)',
    )

    async def run():
        recall.push_frame = _swallow
        await recall.process_frame(
            heard("Make that shorter."), FrameDirection.DOWNSTREAM
        )

    asyncio.run(run())

    (message,) = recall._context.get_messages()
    assert message["role"] == "system"
    assert "draft 3f9a2c" in message["content"]


def test_recall_keeps_talking_when_the_route_is_down():
    recall = a_recall(summary="- Decision: go voice-first")

    def boom(said, answering=None):
        raise RuntimeError("context route is down")

    recall._fetch = boom

    async def run():
        recall.push_frame = _swallow
        await recall.process_frame(heard("anything"), FrameDirection.DOWNSTREAM)

    asyncio.run(run())

    # The running summary is local and still worth putting in front of the
    # model. An agent that has forgotten the past beats one that stops talking.
    (message,) = recall._context.get_messages()
    assert "So far in this drive:" in message["content"]

