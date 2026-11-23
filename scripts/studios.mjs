export const meta = {
  purpose: "Which image studios exist: each one's Codex thread, house style, folder, how many images it made, whether it is busy, and the command that opens it in Codex.",
  params: {},
  returns: "[{name, thread, style, folder, images, lastImageAt, busyWith, open}]",
  example: 'await scripts.run("studios")',
};

export default async function ({ imagegen }) {
  const s = imagegen.studios();
  return s.length ? s : { studios: [], note: `no studio yet; the first image request opens "default" in ${imagegen.imagesDir}/default` };
}
