# Recipe: imagegen kit

## What it answers

Makes and edits raster images through Codex's built-in `image_gen` tool, in long-lived Codex
threads (studios), and answers which images were made, from which prompt, where they are, and
whether a job is still running.

## What it needs

- `codex` (logged in; `image_gen` is a built-in tool, no API key) and `node`, plus Python 3 and Pillow for file verification.
- Setting `IMAGES_DIR` (default `~/Pictures/imagegen`); `CALLER_DIR` is detected with `pwd`.

## What it reads and runs

- Runs `codex exec` (a new studio) and `codex exec resume <thread>` (every later request) with
  `--json`, `--output-schema`, `-c sandbox_mode="workspace-write"`, the studio folder as the working folder, and the
  attached images as `-i`. The request goes in on stdin.
- Reads `$CODEX_HOME/generated_images/<thread>/` when the studio did not say where it saved.
- Writes `~/.local/state/ask-kit-imagegen/` (studios, jobs, Codex events, history) and image files.

## Rebuild it from an empty folder

1. `imagegen.mjs` exports `make({settings, cwd, act})`. Reading functions: `studios`, `job`,
   `wait` (polls at most 55 s, because ask-kit stops a REPL cell at 60 s), `jobs`, `history`.
   Acting functions (`make`, `edit`, `start`, `reset`, `cancel`) are built only when `act` is true.
2. `make` and `edit` write a job file and spawn `runner.mjs` detached, then return at once.
3. The runner takes the studio lock, loads `studio-brief.md` on every turn and points the worker
   at `skills/imagegen-studio/SKILL.md` plus the installed imagegen skill. It passes labelled
   snapshot inputs, house style, caller instruction paths and a content revision.
4. Codex generates, reviews and returns `studio-response.schema.json`. The runner uses
   `lib/inspect_image.py` (Pillow) to decode files, measure dimensions and alpha and publish
   without overwriting. `review.status` distinguishes a visual pass from imperfect/unverified
   output. Recovery is limited to fresh images from this job's thread and carries a warning.
5. `scripts/doctor.mjs` checks prerequisites without generation. `tests/studio.test.mjs` drives
   the real runner with a fake Codex process to check delivery, recovery and validation.
