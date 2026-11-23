# Reference libraries and specialist workflows

An **area** holds references and decisions for one interest or project. A **studio** is the
Codex conversation that makes images. Areas persist independently of studios, so resetting a
conversation does not discard references, accepted guidance or the journal.

Without an explicit area, a generation uses the studio's name and creates that area on first
use. Use a named area such as `botanical-plates` to keep a growing body of work together. Several
studios can share it. Give unrelated interests separate areas.

## Build it through ordinary requests

```text
Create a botanical-plates reference area for my illustrated field guide.
Add ./fern.jpg as a composition reference. Borrow the specimen placement, not the colours.
Approve that reference for composition. Keep the airy spacing around the specimen.
Remember for this area: fine ink lines, off-white paper, no decorative border.
Make a fern plate using botanical-plates, with the article illustration workflow.
The new image is too crowded. Reject it as a reference; retain the fine ink lines.
Show the area's reference sheet and the last ten journal entries.
```

The desk reads the area and records the requested changes. An import defaults to `candidate`.
Every successful generation also becomes a candidate, even when its automated review passes.
Only the user's endorsement makes a reference `approved`. Rejected and archived images remain
in the journal and can be inspected later.

A reference's role matters:

| Role | What to borrow |
|---|---|
| `palette` | Colour relationships, without transferring subject or layout |
| `composition` | Arrangement, crop, spacing and visual hierarchy |
| `style` | Rendering, medium, texture and other specified stylistic traits |
| `identity` | Identifiable product, character or brand features |
| `subject` | Appearance of the specific depicted subject |
| `example` | An example whose useful traits still need to be specified |

Notes describe the permitted borrowing more precisely. Feedback retains the user's exact
wording. General guidance and keep/avoid lists evolve separately; disliking one image does not
automatically ban all of its traits. Worker observations remain suggestions in the journal.

## What the generator receives

Before queueing, the kit selects up to four approved references, using request words and area
context against titles, tags and notes. Matches rank first, with newer references breaking ties.
Identity and subject references require a text match. This is a small, deterministic search,
not an embedding or visual-similarity service. Useful titles and tags improve its results.

The desk can inspect `library.references` and select `referenceIds` explicitly when a request
requires judgment. An explicit selection can use a candidate for one request without promoting
it. `referenceIds: []` attaches no library images; area guidance still applies. One-off `refs`
are additional attachments and are not automatically imported.

Each queued job freezes the selected originals, their roles and feedback, the area's style and
revision, and the chosen workflow. Later edits to the library affect subsequent jobs. The worker
inspects the attached images and reports which traits it used. The journal records the original
request, final generation prompt, reference IDs, area revision, workflow commit/digest, review,
observations and resulting candidate. Failed worker jobs are recorded without inventing an image.
If journalling fails, `libraryError` is returned with the preserved image job.

Originals are copied into content-addressed storage and checked by SHA-256. Deleting the source
file does not lose the imported image. A missing or changed stored original stops selection
with an actionable error; it is never silently replaced. Events are immutable files with a
per-area sequence and lock, so concurrent jobs retain their separate records.

## Existing skills, integrated

The kit bundles complete, unchanged skill directories from two MIT-licensed projects. It reads
the chosen skill and relevant supporting resources for that job.

| Workflow | Upstream | Used for |
|---|---|---|
| `infographic` | Baoyu `baoyu-infographic` | Content analysis, layout and visual-summary styles |
| `cover` | Baoyu `baoyu-cover-image` | Cover composition, palette and typography |
| `article` | Baoyu `baoyu-article-illustrator` | Editorial illustration and content-to-visual decisions |
| `web` | Leon `imagegen-frontend-web` | Website concept composition and hierarchy |
| `mobile` | Leon `imagegen-frontend-mobile` | App screen concepts and visual consistency |
| `brand` | Leon `brandkit` | Brand boards and identity concepts |

`workflow: "auto"` uses the area's default or conservative keyword matching. A specific workflow
overrides that choice. `general` uses the installed Codex imagegen skill without a specialty.
The desk can choose a workflow from the meaning of the request when keywords are insufficient.

The [adapter](../workflows/adapter.md) supplies this kit's storage, permissions, generation and
journal. It replaces standalone upstream setup and backend calls, and applies the caller's
requested scope and style. A single-screen request still produces one screen. Area preferences
take precedence over upstream aesthetic defaults. No separate agent or API backend is required.
See [source preservation and updates](../vendor/README.md) for pinned versions and licences.

## Direct kit commands

```sh
ask-kit run imagegen workflows
ask-kit run imagegen library action=create area=botanical-plates title='Botanical plates'
ask-kit run imagegen library action=add area=botanical-plates image=./fern.jpg role=composition notes='Borrow specimen spacing only' tags=fern,ink
ask-kit run imagegen library action=feedback area=botanical-plates reference=ref-RETURNED-ID verdict=approved note='Use this spacing'
ask-kit run imagegen library action=style area=botanical-plates keep='fine ink,off-white paper' avoid='decorative borders' workflow=article
ask-kit run imagegen make area=botanical-plates studio=field-guide prompt='A single fern specimen plate, no labels' maxAttempts=1
ask-kit run imagegen library action=journal area=botanical-plates limit=10
ask-kit run imagegen library action=sheet area=botanical-plates
```

Direct script commands execute the named operation. Within an ask, library changes require
`act:true`; queries are read-only. Library maintenance and sheet exports spend no image quota.
Generation uses the normal Codex image quota.

`library.setStyle` replaces each supplied field; omitted fields remain. Merge arrays first when
adding traits. Feedback requires exactly one `reference` or `job` identifier. Journal pagination
uses `before: <earliest sequence from the previous page>`.

## Style sheets and storage

A sheet export contains `index.html` with embedded thumbnails, style guidance and feedback;
numbered PNG contact sheets with reference roles and statuses; and `style.json` for inspection
or tooling. The HTML can be opened offline. Each export is a snapshot of its area revision.
Choose `status: "all"` to include rejected and candidate references. An existing export is never
overwritten. The export is a presentation of the library, not a full-resolution library backup.

The default root is `$XDG_STATE_HOME/ask-kit-imagegen/library` or
`~/.local/state/ask-kit-imagegen/library`. Set `LIBRARY_DIR` to choose another location. Back up
that directory together with job state if full history and original images matter. There is no
automatic purge or background synchronisation. A studio reset leaves this directory intact.
