export const meta = {
  purpose: 'List the bundled upstream art-direction workflows with source repositories, pinned commits and licences. No generation.',
  params: {}, returns: '[{id, about, skill?, repository?, commit?, license?}]',
  example: 'await scripts.run("workflows")',
};
export default function({imagegen}) { return imagegen.workflows(); }
