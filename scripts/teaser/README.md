# Teaser

A short video for talks: the demo conversation on a phone, first as the chat
transcript, then a call, then the transcript turning into the Stack.

```bash
corepack pnpm --filter @voicemural/web dev   # the app on :3000, in another terminal
cd scripts/teaser && npm install              # once
npm run film                                  # → storage/teaser/teaser.mp4
```

`npm run watch` records the same way in a visible Chrome window, so you can
follow it as it happens. A render takes about 90 s, because the conversation
plays in real time. `npm run cut` re-encodes without recording again, which
is enough after a change to `SPEED`.

## What to edit where

| To change | Edit |
|---|---|
| Captions, title cards, the label above the phone, the caller | `storyboard.mjs`: `BEATS`, `OPENING`, `CLOSING`, `LABEL`, `CALLER` |
| How long a caption holds | `holdMs` on its beat |
| When the call comes, which return is shown | `CUES` |
| Pace of the morph | `MORPH` |
| Which stretches are time-lapsed, and how fast | `SPEED` |
| Video size, 4K | `FRAME` |
| Where the phone and the captions sit, sizes, colours, fonts | the variables at the top of `stage.html` |
| The order of the beats, or a new beat | the sequence at the end of `film.mjs` |
| The conversation itself | `apps/web/src/lib/talkback/demo-conversation.ts` (the app's demo too), then `TOPICS` and `CUES` |

To check a layout change without rendering, open `stage.html` in a browser
while the dev server runs. It shows the frame scaled to the window, with the
live demo in the phone and a sample caption. The demo's own controls show in
this preview; the film hides them.
