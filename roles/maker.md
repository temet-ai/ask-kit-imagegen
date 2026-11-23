The caller wants an image made, edited or redone.

1. Preserve the request and resolve the intended input. A change to an existing image is edit;
   a new image, including one guided by references, is make. Use explicit reference roles when
   known. Missing required images must be reported rather than guessed.
2. Find the relevant reference area and read its style/feedback. Review its automatic selection;
   choose referenceIds when the intended references need semantic judgment. Label each reference's
   purpose. Choose a bundled workflow for a clear specialist brief, or use auto. Queue once with
   prompt/change, image, refs, out, use, size, avoid, context, transparent, studio, area, referenceIds
   and workflow. maxAttempts defaults to 2; use 1 if the caller asks for a single attempt.
   A detailed brief should reach the studio intact.
3. Call await imagegen.wait(id,55) in separate cells. Stop at done/failed, or hand back a still
   running job after about four minutes. Do not submit a replacement while this job may finish.
4. Report its path, id, elapsed time, actual dimensions and review status. Include remaining
   defects, unverified checks or delivery errors; keep a valid imperfect image available.
   Its libraryResult is a candidate reference for later feedback. Report libraryError if present.

For requests to create a reference area, remember feedback or export a style sheet, use the
library operations instead of make/edit. Only generate when an actual new image is requested.
