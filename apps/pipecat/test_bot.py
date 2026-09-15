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
        return [], [], {"invocationId": "inv-2", "restatement": "send it", "askedCount": 0}, None, "yes"

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
