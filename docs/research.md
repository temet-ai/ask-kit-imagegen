# Imagegen workflow sources

Reviewed 2026-11-23. These are the sources used to choose this kit's workflow, not a measured
ranking of image quality. No third-party runtime or skill installer is needed by the studio.

| Source | Decision |
|---|---|
| [OpenAI's Codex imagegen skill](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md) | Keep the installed official skill as the base. Use its prompting guidance and the live built-in tool schema. Load the kit's smaller studio guidance on each request. |
| [OpenAI image prompting guide](https://developers.openai.com/api/docs/guides/image-prompting) | Use clear subject/composition constraints, explicit edit invariants and targeted corrections. API-specific parameters do not imply equivalent built-in Codex controls. |
| [OpenAI Academy image guidance](https://openai.com/academy/image-generation/) | Keep prompts proportionate to the request; give reference images clear roles and preserve exact supplied text. |
| [Dananz/codex-image](https://github.com/Dananz/codex-image/tree/28a4d58ff942b3db428950ab1ae683e56e27a3c2) | Its create skill supports input staging, Pillow validation and distinguishing visual review from file checks. Implement those ideas in this kit's existing queue; another dispatcher would duplicate it. |
| [Leonxlnx/imagegen-skills](https://github.com/Leonxlnx/imagegen-skills/tree/beb16b0d0f4dae9a6f5cb04ea41e97b93a54ab8e) | Bundled as three selectable workflows with original files and licence. The host adapter applies the requested asset count and area style in place of standalone section counts and aesthetic defaults. |
| [falafael/codex-imagegen](https://github.com/falafael/codex-imagegen/tree/3a52bb9aaf26ca6c1bf2c7de0c4033c8d926167f) | Useful destination-context and reference-role guidance. Do not adopt its assertion that built-in imagegen cannot produce alpha: that conflicts with the installed official skill and current exposed tool. |

The kit keeps a single studio worker with explicit preparation and review steps. It does not
spawn an additional agent for every image. File validation runs separately in Pillow. Visual
checks remain the studio's observations, not independent proof of fidelity or aesthetic quality.
The runner reports unverified or failed requirements and never labels a recovered, unreviewed
file as a clean pass.

On this machine the reviewed prerequisites were Codex CLI 0.171.0 with image_generation enabled,
a ChatGPT login, and Pillow 13.0.0. Run the doctor again after an installation change. New and
resumed CLI turns both expose --output-schema. No particular image-model backend is selected or
claimed by the kit.

Validation on the same date: 16 offline regression checks passed, and the installed kit's doctor
passed. Two live jobs in one studio completed using one generation attempt each: new transparent
artwork, then an edit using its job id. Both returned needs_review. The first measured 1254×1254
against a 1024×1024 request; the second reported slight contour drift and edge fringe. These
checks establish working generation, resume, references, file validation and honest defect
reporting. They do not measure a general quality improvement. The receipts are recorded in
[bench/live-results-2026-11-23.json](../bench/live-results-2026-11-23.json).

The live jobs also exposed difficulty viewing transparent output in the studio's image viewer.
A light/dark inspection-sheet option was added afterwards and checked locally for readability
and preservation of the source hash. A later live job can exercise that optional worker step.

## Reference-library integration

The kit now also bundles [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills/tree/bf1ff076e25f8da4a339eb1c8cf03361fea5ea4c): infographic, cover-image and article-illustrator, including their supporting references. These and the three Leon workflows are pinned and hash-verified; see [source credits](../vendor/README.md).

The adoption decision is based on inspectable methods and compatible licences, not a controlled
claim of dramatic quality improvement. The persistent library supplies role-labelled originals,
user feedback and evolving style guidance. A smoke check proves wiring; quality improvements
should be judged on repeated briefs and the user's accepted/rejected outputs in each area.

Reference-library verification on the same date: 38 regression tests passed; all 127 vendored
files verified; the installed kit's doctor passed. A normal read-only ask recovered the area,
roles and workflow. One real cover job used an earlier lighthouse only as a palette reference
to make a fern illustration. The worker read the cover skill and its applicable upstream
resource files, reported palette-only use, and returned a visual pass. The saved opaque PNG
measured 1664×936 after ratio conformance. Its journal retained input revision 2 and stored the
new image as a candidate at revision 4. The exported contact sheet was visually checked.
Evidence: [reference-library smoke receipt](../bench/reference-library-2026-11-23.json).
