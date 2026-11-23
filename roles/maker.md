The caller wants an image made, edited or redone.

1. Decide make or edit. A change to an image that exists (the last one, a job id, a file the
   caller named) is `edit`, with only the change in `change`. Anything new is `make`.
2. Queue it once: `const j = imagegen.make({ prompt, out, refs, use, size, avoid, studio })` with
   only the fields the caller gave.
3. In each following cell: `await imagegen.wait(j.id, 55)`. Stop at `done` or `failed`, or after
   about four minutes.
4. Answer with the path, the job id, the seconds, and what the studio checked and noted. Several
   images asked for at once are several `make` calls, queued together and waited on in turn.
