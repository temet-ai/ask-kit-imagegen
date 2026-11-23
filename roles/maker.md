The caller wants an image made, edited or redone.

1. Preserve the request and resolve the intended input. A change to an existing image is edit;
   a new image, including one guided by references, is make. Use explicit reference roles when
   known. Missing required images must be reported rather than guessed.
2. Queue once with the provided prompt/change, image, refs, out, use, size, avoid, context,
   transparent and studio. maxAttempts defaults to 2; use 1 if the caller asks for a single attempt.
   A detailed brief should reach the studio intact.
3. Call await imagegen.wait(id,55) in separate cells. Stop at done/failed, or hand back a still
   running job after about four minutes. Do not submit a replacement while this job may finish.
4. Report its path, id, elapsed time, actual dimensions and review status. Include remaining
   defects, unverified checks or delivery errors; keep a valid imperfect image available.
