# ask-kit-imagegen

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that makes and edits images with Codex's
built-in `image_gen` tool, from any agent that has `ask`.

Requests go to a long-lived Codex thread called a studio. The studio reads Codex's imagegen skill
once, then for every request writes the prompt as the skill's labeled spec, generates the image,
looks at it, regenerates once if it misses, and saves it. Because it is one thread, it remembers
its house style and every image it made: "the last one, but at night" works from any session.

```text
ask: make a flat brass lighthouse icon, no text, save it to assets/lighthouse.png
ask: the last image, but at night with the beam lit
ask: which images did we make of the lighthouse, and where are they?
```

## How it works

- Each request is a job. A detached runner sends it to the studio with `codex exec resume`, so a
  job finishes even if the ask that started it gives up. A turn takes one to three minutes.
- A studio runs one job at a time. Jobs from other sessions queue behind it, so two sessions never
  write to the same thread at once.
- Images are saved in `IMAGES_DIR/<studio>/` (default `~/Pictures/imagegen`). With `out`, a copy
  goes where the caller asked; an existing file is never overwritten (`hero-v2.png`).
- Open a studio in Codex yourself with the `open` command from `studios` (`codex resume <thread>`).
  Close it before sending the next request through `ask`.
- A studio can have a house style: `ask: start an image studio called brand with the style "flat
  vector, warm brass and navy, no gradients"`.

Making, editing, starting, resetting and cancelling need `act`: they spend the Codex plan's image
quota and write files. Reading the history, jobs and studios does not.

## Needs

- `codex` logged in, with the `image_gen` feature on (`codex features list`). No OpenAI API key.
- `node`.

## Settings

| Key | What | Default |
|---|---|---|
| `IMAGES_DIR` | where studios save images | `~/Pictures/imagegen` |
| `CALLER_DIR` | the caller's folder, for relative paths | detected |

State (studios, jobs, history) is in `~/.local/state/ask-kit-imagegen/`.

## Scripts

`make` (queue and wait), `wait` (is a job done), `recent` (images made and jobs running),
`studios`. Run one with no model: `ask-kit run imagegen recent search=lighthouse`. A direct
`make` run spends an image.
