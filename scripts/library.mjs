export const meta = {
  purpose: 'Maintain persistent image reference areas, user feedback, style guidance and the generation journal; export a visual reference sheet. Reading spends no quota. Mutations require act but never generate an image.',
  params: {
    action: 'areas (default), show, references, journal, select, create, add, feedback, style, note, sheet',
    area: 'area name, e.g. botanical-plates', title: 'area or reference title', description: 'what this area covers',
    image: 'add: image path, completed job id or reference id', role: 'style, composition, palette, identity, subject or example',
    reference: 'reference ID for feedback', job: 'completed job ID for feedback instead of reference',
    verdict: 'approved, rejected, candidate or archived; only as the user directed',
    note: 'the user feedback verbatim, or reason for a style update', notes: 'what to borrow from an imported image',
    tags: 'array or comma-separated searchable tags', source: 'original source URL or attribution',
    status: 'reference status filter; add defaults to candidate; sheet defaults to approved and also accepts all',
    guidance: 'style prose, replacing the current prose', keep: 'array or comma-separated traits to retain; replaces this list', avoid: 'array or comma-separated traits to avoid; replaces this list',
    workflow: 'auto, general, infographic, cover, article, web, mobile or brand',
    text: 'note text', query: 'select: what the next image should show', referenceIds: 'select: specific reference IDs; optional',
    search: 'search reference titles/notes/tags', limit: 'result count', before: 'journal: sequence number for earlier events',
    out: 'sheet: NEW export directory; omit to store a versioned sheet in the area',
  },
  returns: 'area/reference/journal/selection or {html,sheets,manifest,area,revision}; every generation records candidate references separately from user approval',
  example: 'await scripts.run("library", {action:"show", area:"botanical-plates"})',
};
const list=value=>Array.isArray(value)?value:String(value).trim().startsWith('[')?JSON.parse(value):String(value).split(',').map(x=>x.trim()).filter(Boolean);
export default function({imagegen},params={}){
  const {action='areas',area,...options}=params;
  for(const key of ['tags','keep','avoid','referenceIds']) if(options[key]!==undefined) options[key]=list(options[key]);
  for(const key of ['limit','before']) if(options[key]!==undefined) options[key]=Number(options[key]);
  const lib=imagegen.library;
  switch(action){
    case 'areas': return lib.areas();
    case 'show': return lib.area(area);
    case 'references': return lib.references({area,...options});
    case 'journal': return lib.journal({area,...options});
    case 'select': return lib.select({area,...options});
    case 'create': return lib.createArea({name:area,...options});
    case 'add': return lib.addReference({area,...options});
    case 'feedback': return lib.feedback({area,...options});
    case 'style': return lib.setStyle({area,...options});
    case 'note': return lib.note({area,...options});
    case 'sheet': return lib.sheet({area,...options});
    default: throw new Error(`unknown library action: ${action}`);
  }
}
