export const meta = {
  purpose: "Stop a queued or running image job by id, so it neither spends more quota nor holds its studio. Needs act. A done or failed job is left as it is.",
  params: { id: "the job id (img-...)" },
  returns: "{cancelled, id} or {cancelled: false, status}",
  example: 'await scripts.run("cancel", { id: "img-mwt7gf4q-d07e" })',
};

export default async function ({ imagegen }, { id } = {}) {
  if (!id) return { error: "name the job: id=img-...", running: imagegen.jobs({ limit: 20 }).filter((j) => j.status === "queued" || j.status === "running").map((j) => j.id) };
  return imagegen.cancel(String(id));
}
