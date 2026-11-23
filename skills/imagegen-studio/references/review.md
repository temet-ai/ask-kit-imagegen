# Review the image you will deliver

Make a short checklist from this job's requirements before generation. Inspect the selected
output visually, not merely its filename or the generation tool's success message.

Record applicable checks with criterion, status (pass, fail or unverified), and a concrete
observation. Typical criteria are subject/count, composition, reference fidelity, exact text,
edit invariants, style/avoid items and edge quality. Omit criteria irrelevant to this image.
For text, transcribe what you can actually read and compare it to the request. For an edit,
compare to the supplied original. Do not infer successful preservation from memory alone.

The runner independently measures format and alpha, and fixes exact dimensions itself (it crops
and resizes an image within 3% of the requested shape), so leave pixel size out of your checks.
You may use the supplied inspection helper before deciding whether to spend the remaining
correction attempt. A missing alpha channel, the wrong orientation or an unreadable required
label is a defect, even when the image is otherwise attractive. Record an unverified check when you cannot establish the result.

Set review.status to pass only when every recorded requirement passes. A remaining failure or
uncertain requirement is needs_review. If no visual inspection was possible, use unverified.
Report defects without claiming that these checks prove aesthetic quality. Never spend more
than the job's attempt limit or automatically start a fresh job after an uncertain outcome.
