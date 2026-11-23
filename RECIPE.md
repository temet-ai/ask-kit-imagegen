# Recipe: imagegen kit

## What it answers

Makes and edits raster images through Codex's built-in `image_gen` tool, in long-lived Codex
threads (studios), and answers which images were made, from which prompt, where they are, and
whether a job is still running.

## What it needs

- `codex` (logged in; `image_gen` is a built-in tool, no API key) and `node`.
- Setting `IMAGES_DIR` (default `~/Pictures/imagegen`); `CALLER_DIR` is detected with `pwd`.

## What it reads and runs

- Runs `codex exec` (a new studio) and `codex exec resume <thread>` (every later request) with
  `--json`, `-c sandbox_mode="workspace-write"`, the studio folder as the working folder, and the
  attached images as `-i`. The request goes in on stdin.
- Reads `$CODEX_HOME/generated_images/<thread>/` when the studio did not say where it saved.
- Writes `~/.local/state/ask-kit-imagegen/` (studios, jobs, Codex events, history) and image files.

## Rebuild it from an empty folder

1. `imagegen.mjs` exports `make({settings, cwd, act})`. Reading functions: `studios`, `job`,
   `wait` (polls at most 55 s, because ask-kit stops a REPL cell at 60 s), `jobs`, `history`.
   Acting functions (`make`, `edit`, `start`, `reset`, `cancel`) are built only when `act` is true.
2. `make` and `edit` write a job file and spawn `runner.mjs` detached, then return at once.
3. The runner takes the studio's lock (a `mkdir`, with the owner's pid; a dead owner's lock is
   removed), sends `studio-brief.md` plus the request on a new thread or just the request on a
   resumed one, and reads the last message's JSON line (`file`, `prompt`, `checked`, `notes`).
   Without it, it takes the newest image Codex generated in this turn. It copies to `out` without
   overwriting and appends to `history.jsonl`.
4. `studio-brief.md` tells Codex to read the imagegen skill and its prompting references, use the
   built-in tool only, look at each image, regenerate at most once, save to the named path and end
   with one JSON line.
