export const meta = {
  purpose: "Which images were made, newest first: the file, the request, the studio's final prompt, when and how long; plus any job queued or running now. Filter by studio or a search over the requests and prompts.",
  params: { search: "a word or regex in the request or prompt; optional", studio: "a studio name; optional", limit: "how many, default 10" },
  returns: "{running: [{id, studio, status, secondsSoFar, request}], images: [{id, studio, at, file, copiedTo, exists, request, useCase, seconds}]}",
  example: 'await scripts.run("recent", { search: "lighthouse" })',
};

export default async function ({ imagegen }, { search, studio, limit = 10 } = {}) {
  const running = imagegen.jobs({ studio, limit: 50 }).filter((j) => j.status === "queued" || j.status === "running")
    .map(({ id, studio, status, secondsSoFar, request, waitingFor }) => ({ id, studio, status, secondsSoFar, request, waitingFor }));
  const images = imagegen.history({ studio, search, limit: Number(limit) || 10 })
    .map(({ id, studio, at, file, copiedTo, exists, request, useCase, seconds }) => ({ id, studio, at, file, copiedTo, exists, request, useCase, seconds }));
  return { running, images };
}
