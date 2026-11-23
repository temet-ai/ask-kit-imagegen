---
name: imagegen-studio
description: Fulfil an ask-kit-imagegen studio job with Codex's built-in image_gen tool, labelled references, visual review and a structured delivery receipt. Applies inside the kit's studio worker; do not dispatch another studio job from here.
---

# Imagegen studio

Read the installed Codex imagegen skill and its prompting reference at the paths supplied with
the job. The live tool schema determines available arguments. Use the built-in image_gen tool;
do not select an API backend, change the user's agent model, or invoke an imagegen wrapper again.

## Prepare the image

Treat the current job as the source of truth, including its attached files. Thread history can
help with continuity but must not substitute for the supplied edit target. Read the caller's
listed instruction files, and any taste file they identify, before art direction. Apply only
guidance relevant to this request. The explicit request takes precedence over house style.

The job's areaLibrary is a frozen snapshot of the reference area at submission. Read its style,
reference notes/roles and recent user feedback. Apply current explicit requirements first, then
relevant area preferences and house style. Do not mix the subjects or identities of unrelated
references. A palette reference transfers colours only; a composition reference guides framing;
identity/subject references specify what must remain identifiable. Use the attached original
images, not a contact sheet or a remembered image from an older thread.

When a specialist workflow is supplied, read its integration adapter and upstream SKILL.md,
then the applicable linked design resources. The adapter defines the hosting contract: use the
upstream analysis, layouts and review methods within the current brief. Preserve the requested
scope and area style. Do not run upstream generation wrappers or create unrequested outputs.

Keep a detailed prompt's requirements intact. For an open brief, choose concrete framing,
medium and lighting appropriate to its use; record consequential assumptions in notes. Do not
invent slogans, brand colours, factual labels, extra deliverables or new subjects. Missing
essential source material or contradictory requirements should produce an actionable error.

Inspect each input with view_image. Identify it by attachment number and role in the generation
prompt. Distinguish the base image to edit, an identity/product reference, style and composition.
State what to change and what to preserve. A source logo is an asset to preserve; an inspiration
image is guidance. For repeated characters/products, preserve identifiable features explicitly.

Use the installed skill's use-case slug. Read [asset checks](references/asset-checks.md) for the
applicable category only; sample prompts in the installed skill are optional examples. Quote
required image text verbatim. Keep data and labels supplied by the caller; do not fabricate
statistics or scientific details. If essential facts are missing, return that requirement.

## Generate and inspect

One job delivers one image. Use the actual tool's reference mechanism and transparency control.
Ask for the stated aspect ratio and compose for it. The tool picks its own pixel size; after you
finish, the runner crops and resizes to the exact requested size when the image is within 3% of
that shape, trimming a few pixels at the edges, so keep important content off the very edges.
Never use the Codex agent model flag to select an image backend.

Open the generated file with view_image. Inspect the actual output against the original request,
using the [review guide](references/review.md). Record observations, including visible failures.
If an important requirement misses and the job permits a second attempt, make one targeted
correction using the first output as the edit target when appropriate. Repeat all invariants
and inspect that output too. Do not retry refusals, unavailable tools, login failures or quota
errors. Stop at the supplied attempt limit; a valid but imperfect image is needs_review.

If transparent pixels make the viewer hard to read, use the supplied inspection helper with
`<image-path> --preview <reviewPreview>` and view that opaque light/dark sheet. It is only for
checking edges and appearance; never deliver it or replace the original with it.

Copy the selected output to the job's absolute target path, preserving alpha. Do not resize,
crop, repaint, flatten transparency or overwrite inputs to make a check pass. The runner checks
the file, fixes its exact size and handles the caller's final destination. Do not record checks
on pixel dimensions or exact aspect ratio: the runner owns those. A composition that is clearly
the wrong shape (portrait for a landscape request) is still a defect to fix. Fill the supplied response schema; the
prompt is the exact prompt used for the selected image and checked describes what you observed.
Never mark a check pass when it was not inspected. State remaining defects and useful next
actions plainly. If generation fails, fill error and leave file null.

In reference_use, record each library reference id you used and the traits actually borrowed;
use an empty array when none applied. In style_observations, record useful observations or
possible improvements for the journal. These are proposals, never user approval or permanent
style rules. The runner stores outputs as candidate references and journals this receipt.
