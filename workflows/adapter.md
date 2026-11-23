# Upstream art direction in the imagegen kit

Read the selected upstream SKILL.md and the applicable design references it names. Use its
content analysis, layout selection, composition, palette, typography and visual review methods.
The upstream files are retained unchanged with their licences and pinned source commits.

The kit provides the surrounding workflow:

- The caller already authorised this image job. Intake has supplied the requested content,
  dimensions, reference roles and area profile. Use those choices; explain any consequential
  defaults in the receipt. Return an actionable error for missing essential information.
- Generate the one asset this job requests. Upstream default section/screen counts and batch
  sizes apply only when the caller requested such a set; the desk queues its assets separately.
- Use the built-in image_gen tool in this worker. The kit owns the queue, image transport,
  files, validation and journal. Do not run vendored wrappers, install dependencies, change
  configuration, invoke another agent, publish, or use an API fallback.
- Use the area's accepted guidance, attached references and user feedback in preference to
  upstream preset aesthetics. A reference role limits what to borrow: palette approval does
  not approve its subject or layout. Describe which visible traits informed the final prompt.
- For Baoyu, the area profile supplies preferences normally held in EXTEND.md. Read the
  applicable layout/style/palette and prompt-construction references in the selected skill.
  Preserve the requested content and treat any upstream default layout as a starting option.
- For Leon, use composition, screen hierarchy and brand-consistency guidance for the requested
  surface. Preserve the caller's density, copy and scope. Do not force a logo request into a
  brand board or a single-screen request into an app flow.
- Save the generation prompt in the structured receipt; the runner journals it with the exact
  area revision, attached reference IDs, upstream commit and workflow digest. This supplies
  upstream prompt-persistence requirements without competing output directories.

A style observation from the worker belongs in notes. It is not a user preference or approval.
