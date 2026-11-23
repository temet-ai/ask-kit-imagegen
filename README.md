# ask-kit-imagegen

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that makes and edits images with Codex's
built-in `image_gen` tool, from any agent that has `ask`.

Requests go to a persistent Codex thread called a studio. Each job receives the current studio
guidance, its house style and labelled input images. Codex uses its installed imagegen skill,
checks the result visually and can make one targeted correction. The runner decodes the saved
image and checks its dimensions and transparency before returning it.

```text
ask: make a flat brass lighthouse icon, no text, save it to assets/lighthouse.png
ask: the last image, but at night with the beam lit
ask: which images did we make of the lighthouse, and where are they?
```

## Setup

Requires Node.js 18+, Python 3 with Pillow, and a current Codex CLI logged in using ChatGPT.
Codex must provide `image_generation` and `--output-schema` for both `exec` and `exec resume`.
The official imagegen skill must be installed. No OpenAI API key is used.

Check the installation without generating an image:

```sh
ask-kit run imagegen doctor
```

For a standalone checkout:

```sh
node --input-type=module -e 'import doctor from "./scripts/doctor.mjs"; console.log(doctor())'
```

If Pillow is missing, install it in a virtual environment and put that environment's `python3`
on the PATH used by ask-kit. The kit never changes global Codex settings or authentication.

## How jobs work

- Each request is a job. A detached runner sends it to the studio with `codex exec resume`, so it
  continues if the ask that submitted it stops waiting. A studio runs one job at a time.
- Reference files are copied when submitted. Queued edits use those copies even if the source
  later changes. `last` resolves when the request is submitted, not after jobs ahead of it finish.
- Images live in `IMAGES_DIR/<studio>/` (default `~/Pictures/imagegen`). An optional `out` gets a
  second copy. Existing destinations are preserved using `-v2`, `-v3`, etc., with exclusive writes.
- Output copies are encoded for their extension. PNG and WebP preserve alpha. A JPEG destination
  for a transparent image, or a GIF conversion that would reduce colours, returns a delivery
  warning and keeps the original. The kit does not resize or crop to hide a dimension mismatch.
- Every request reloads the bundled studio skill. Changes to the installed imagegen skill and
  prompting references are identified by a content hash, including for existing studios.
- Caller ancestor `AGENTS.md`/`AGENTS.override.md` paths and global Codex instructions are passed
  to the studio so it can read applicable project and taste guidance. Additional design context
  can be supplied with `context`.
- Open a studio with the command from `studios` (`codex resume <thread>`). Close it before sending
  another request through ask. A named studio can retain a house style.

Making, editing, starting, resetting and cancelling need `act`. Generation spends the Codex
plan's image quota. History, job status, studios and doctor are read-only.

## Request options

Both `make` and `edit` accept `out`, `refs`, `use`, `size`, `avoid`, `context`, `transparent`,
`maxAttempts` (1 or 2, default 2) and `studio`. `make` needs `prompt`; `edit` needs `change` and
accepts `image` (path, job id or `last`). The configured Codex agent model is preserved.

```js
const job = imagegen.edit({
  image: "product.png",
  change: "Replace the background with the supplied studio backdrop. Keep the product and label unchanged.",
  refs: [{image: "backdrop.png", role: "background reference"}],
  size: "1536x1024",
  out: "assets/product.png",
});
```

String references remain supported. Set `transparent:true` for alpha, `false` for explicitly
opaque output, or omit it. `size:"WIDTHxHEIGHT"` checks exact dimensions; `"16:9"` and `"square"`
check proportions. These are requests to the built-in tool, not guaranteed rendering settings.

One job returns one image. Submit separate jobs for requested variants or assets; use explicit
approved references to keep a set consistent. The kit does not expand requests into extra images.

## Results and recovery

`status:done` means a valid image was saved. `review.status` reports `pass`, `needs_review` or
`unverified`; read it along with `checked`, `notes` and `review.warnings`. Visual review is the
studio's assessment. `validation` independently records dimensions, format, alpha, byte count
and SHA-256. A remaining mismatch is returned with the image for review.

For transparent images that are hard to inspect in a viewer, the studio can create a separate
light/dark inspection sheet. This preview never replaces the delivered image or its alpha.

Malformed receipts and interrupted turns can recover a fresh image from that exact studio's
Codex output folder, with an explicit warning. An arbitrary or stale path cannot count as a
successful result. If delivery to `out` fails, `deliveryError` names the preserved studio image
and the problem. Check the existing job before retrying to avoid spending quota twice.

The attempt limit is an instruction to the worker and is checked against its receipt; it is not
a server-side image-tool quota. The kit does not claim to control the hidden image backend.

## Settings and scripts

| Key | Meaning | Default |
|---|---|---|
| `IMAGES_DIR` | Studio image folders | `~/Pictures/imagegen` |
| `CALLER_DIR` | Base folder for relative paths | Caller folder |

State is under `$XDG_STATE_HOME/ask-kit-imagegen/`, or `~/.local/state/ask-kit-imagegen/`.
Scripts: `make`, `wait`, `recent`, `studios`, `doctor`. For example:
`ask-kit run imagegen recent search=lighthouse`. A direct `make` run spends image quota.

Run offline regression checks with `node --test tests/*.test.mjs`; they use a fake Codex process
and real image decoding. Research sources and adoption decisions are in [docs/research.md](docs/research.md).
