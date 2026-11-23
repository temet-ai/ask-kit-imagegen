export const meta = {
  purpose: "Make a new image (or edit one, with `image` and `change`) in a studio and wait for it: the request goes to the studio's Codex thread, which uses image_gen, checks the image and saves it. Needs act. Returns the finished job, or the job still running when `wait` runs out.",
  params: {
    prompt: "what the image shows, in the caller's words (for a new image)",
    change: "for an edit: what to change, and only that",
    image: "for an edit: the image to change: a path, a job id, or last (default)",
    out: "where to save it: a file or a folder ending in /, relative to the caller's folder; optional",
    refs: "images that guide the look: comma-separated paths/job ids, or an array of strings or {image, role}; optional",
    context: "relevant project design context; optional",
    transparent: "true for real alpha, false for opaque; omit when not specified",
    maxAttempts: "1 or 2 generation attempts; default 2",
    use: "where the image will be used; optional", size: "size or shape (square, 16:9, 1536x1024); optional",
    avoid: "what must not appear; optional", studio: "studio name, default default",
    wait: "seconds to wait before handing back a running job, default 50",
  },
  returns: "the job: {id, status, file, copiedTo, prompt, checked, notes, attempts, review, validation, deliveryError, seconds}; status running or queued means it is still going (use the wait script with its id)",
  example: 'await scripts.run("make", { prompt: "a brass lighthouse icon, flat, no text", out: "assets/" })',
};

export default async function ({ imagegen }, { prompt, change, image, out, refs, use, size, avoid, context, transparent, maxAttempts, studio = "default", wait = 50 } = {}) {
  const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => typeof s === "string" ? s.trim() : s).filter(Boolean);
  if (transparent === "true") transparent = true;
  else if (transparent === "false") transparent = false;
  if (maxAttempts !== undefined) maxAttempts = Number(maxAttempts);
  const options = { out, refs: list(refs), use, size, avoid, context, transparent, maxAttempts, studio };
  const job = change
    ? imagegen.edit({ ...options, change, image: image || "last" })
    : imagegen.make({ ...options, prompt });
  let j = job;
  const until = Date.now() + Math.max(0, Number(wait) || 0) * 1000;
  while (["queued", "running"].includes(j.status) && Date.now() < until) j = await imagegen.wait(j.id, Math.min(55, Math.ceil((until - Date.now()) / 1000)));
  return j;
}
