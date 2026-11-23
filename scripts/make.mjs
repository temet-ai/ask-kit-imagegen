export const meta = {
  purpose: "Make a new image (or edit one, with `image` and `change`) in a studio and wait for it: the request goes to the studio's Codex thread, which uses image_gen, checks the image and saves it. Needs act. Returns the finished job, or the job still running when `wait` runs out.",
  params: {
    prompt: "what the image shows, in the caller's words (for a new image)",
    change: "for an edit: what to change, and only that",
    image: "for an edit: the image to change: a path, a job id, or last (default)",
    out: "where to save it: a file or a folder ending in /, relative to the caller's folder; optional",
    refs: "images that guide the look, comma-separated paths or job ids; optional",
    use: "where the image will be used; optional", size: "size or shape (square, 16:9, 1536x1024); optional",
    avoid: "what must not appear; optional", studio: "studio name, default default",
    wait: "seconds to wait before handing back a running job, default 50",
  },
  returns: "the job: {id, status, file, copiedTo, prompt, checked, notes, attempts, seconds}; status running or queued means it is still going (use the wait script with its id)",
  example: 'await scripts.run("make", { prompt: "a brass lighthouse icon, flat, no text", out: "assets/" })',
};

export default async function ({ imagegen }, { prompt, change, image, out, refs, use, size, avoid, studio = "default", wait = 50 } = {}) {
  const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean);
  const job = change
    ? imagegen.edit({ change, image: image || "last", out, refs: list(refs), studio })
    : imagegen.make({ prompt, out, refs: list(refs), use, size, avoid, studio });
  let j = job;
  const until = Date.now() + Math.max(0, Number(wait) || 0) * 1000;
  while (["queued", "running"].includes(j.status) && Date.now() < until) j = await imagegen.wait(j.id, Math.min(55, Math.ceil((until - Date.now()) / 1000)));
  return j;
}
