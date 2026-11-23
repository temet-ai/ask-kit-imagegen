export const meta = {
  purpose: "Which images were made, newest first, one short line each (id, studio, time, size, review, path, request, first unresolved defect), and the jobs queued or running now. Filter by studio or a search over the requests and prompts. Name one id for its full record: the whole request, the final prompt, every review check.",
  params: { search: "a word or regex in the request or prompt; optional", studio: "a studio name; optional", limit: "how many, default 10", id: "one job id (img-...) for its full record; optional" },
  returns: "{running: [\"id studio status 120s: request...\"], images: [\"id studio 14:02 1664x936 pass /path.png: request...\"]}, or one full record for `id`",
  example: 'await scripts.run("recent", { search: "lighthouse" })',
};

const cut = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const what = (r) => r?.prompt ?? (r?.change ? `edit: ${r.change}` : "");
const hhmm = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "");

export default async function ({ imagegen }, { search, studio, limit = 10, id } = {}) {
  if (id) {
    const row = imagegen.history({ limit: 500 }).find((h) => h.id === id);
    return row ?? imagegen.job(id);
  }
  const running = imagegen.jobs({ studio, limit: Infinity }).filter((j) => j.status === "queued" || j.status === "running")
    .map((j) => `${j.id} ${j.studio} ${j.status} ${j.secondsSoFar ?? 0}s${j.waitingFor ? ` after ${j.waitingFor}` : ""}: ${cut(what(j.request), 70)}`);
  const images = imagegen.history({ studio, search, limit: Number(limit) || 10 }).map((h) => {
    const v = h.validation, fails = (h.review?.checks ?? []).filter((c) => c.status !== "pass").length;
    const review = h.review ? `${h.review.status}${fails ? `(${fails})` : ""}` : "unverified";
    const check = h.review?.checks?.find(c => c.status !== "pass");
    const issue = check ? `${check.criterion}: ${check.detail}` : h.review?.warnings?.[0] || (review.startsWith("unverified") ? "No verified visual review" : h.review?.status === "needs_review" ? h.notes || "Inspect the full review" : "");
    return `${h.id} ${h.studio} ${hhmm(h.at)} ${v ? `${v.width}x${v.height}` : "?"} ${review}${h.exists ? "" : " MISSING"} ${h.copiedTo ?? h.file}: ${cut(what(h.request), 70)}${issue ? ` | ${cut(issue, 180)}` : ""}`;
  });
  return { running, images };
}
