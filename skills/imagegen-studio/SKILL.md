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
Request the stated dimensions or aspect ratio, but do not claim they are enforced by a parameter
the tool does not expose. Never use the Codex agent model flag to select an image backend.

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
the file and handles the caller's final destination. Fill the supplied response schema; the
prompt is the exact prompt used for the selected image and checked describes what you observed.
Never mark a check pass when it was not inspected. State remaining defects and useful next
actions plainly. If generation fails, fill error and leave file null.
