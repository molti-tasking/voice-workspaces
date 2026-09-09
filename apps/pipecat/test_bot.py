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
    """Stands in for `TurnRecorder`: remembers each call instead of POSTing."""

    def __init__(self):
        self.calls = []

    def record(self, spoken, generated, *, started_ms=None, barged_in=False):
        self.calls.append(
            {
                "spoken": spoken,
                "generated": generated,
                "started_ms": started_ms,
                "barged_in": barged_in,
            }
        )


def drive(frames, recorder=None):
    """Push frames through a fresh `SilenceGate`; return the text that reached TTS."""
    spoken = []

    async def run():
        gate = bot.SilenceGate(recorder=recorder)

        async def capture(frame, direction=FrameDirection.DOWNSTREAM):
            if isinstance(frame, LLMTextFrame):
                spoken.append(frame.text)

        gate.push_frame = capture
        for frame in frames:
            await gate.process_frame(frame, FrameDirection.DOWNSTREAM)

    asyncio.run(run())
    return spoken


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


def test_truncated_decline_is_not_spoken():
    # Turn 5 of the 9 Sep drive: the stream ended two tokens into `<silence>`
    # and the old end-of-response fallback read "sil" aloud.
    recorder = FakeRecorder()
    assert drive(reply("<sil"), recorder) == []
    assert recorder.calls == []


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


def test_interruption_while_holding_records_nothing():
    recorder = FakeRecorder()
    frames = [LLMFullResponseStartFrame(), LLMTextFrame(text="<sil"), InterruptionFrame()]
    assert drive(frames, recorder) == []
    assert recorder.calls == []


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


def posted_by(action):
    """Run `action(recorder)` inside a loop and return what it would have POSTed."""
    posted = []
    recorder = bot.TurnRecorder(ticket="ticket", started_at_ms=1_000)
    recorder._post = posted.append

    async def run():
        action(recorder)
        # `record` is fire-and-forget through `asyncio.to_thread`.
        await asyncio.sleep(0.2)

    asyncio.run(run())
    return posted


def test_turn_recorder_marks_a_barged_in_turn():
    started = int(time.time() * 1000) - 500

    def act(recorder):
        recorder.note_user("Did I say something right?")
        recorder.record("The", "The deadline is in November.", started_ms=started, barged_in=True)

    (payload,) = posted_by(act)
    assert payload["bargedIn"] is True
    assert payload["text"] == "The"
    assert payload["generatedText"] == "The deadline is in November."
    assert payload["respondingToText"] == "Did I say something right?"
    # Cut about half a second in; measured, not estimated from length.
    assert 400 <= payload["truncatedAtMs"] <= 1_500
    assert payload["endOffsetMs"] == payload["startOffsetMs"] + payload["truncatedAtMs"]


def test_turn_recorder_estimates_the_end_of_an_uninterrupted_turn():
    text = "Yes, I can hear you."

    def act(recorder):
        recorder.record(text, text)

    (payload,) = posted_by(act)
    assert "bargedIn" not in payload
    assert "truncatedAtMs" not in payload
    assert payload["endOffsetMs"] == payload["startOffsetMs"] + int(len(text) / 14 * 1000)


def test_turn_recorder_ignores_empty_speech():
    def act(recorder):
        recorder.record("   ", "<silence>")

    assert posted_by(act) == []
