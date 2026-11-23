interface ImageReference { image: string; role: string }
interface ImageOptions {
  out?: string; refs?: (string | ImageReference)[]; use?: string; size?: string;
  avoid?: string; context?: string; transparent?: boolean; maxAttempts?: 1 | 2; studio?: string;
  area?: string; referenceIds?: string[]; workflow?: WorkflowId;
}
type WorkflowId = "auto" | "general" | "infographic" | "cover" | "article" | "web" | "mobile" | "brand";
type ReferenceRole = "style" | "composition" | "palette" | "identity" | "subject" | "example";
type ReferenceStatus = "candidate" | "approved" | "rejected" | "archived";
interface Workflow {
  id: Exclude<WorkflowId, "auto">; about?: string; skill?: string;
  repository?: string; commit?: string; license?: string; digest?: string;
}
interface AreaStyle { guidance: string; keep: string[]; avoid: string[]; workflow: WorkflowId }
interface LibraryReference {
  id: string; title: string; role: ReferenceRole; notes: string; tags: string[];
  status: ReferenceStatus; file: string; exists: boolean; validation: ImageValidation;
  source: string | null; origin?: string; job?: string; addedAt: string;
  feedback: {at: string; note: string; verdict: ReferenceStatus; actor: string}[];
}
interface LibraryEvent {
  seq: number; id: string; at: string; area: string; type: string; actor: "user" | "studio";
  data: Record<string, unknown>;
}
interface Area {
  schema: number; name: string; title: string; description: string; createdAt: string;
  revision: number; style: AreaStyle; references: LibraryReference[];
  counts: Record<ReferenceStatus, number>; recentFeedback: LibraryEvent[];
}
interface ReferenceSelection {
  name: string; title: string; description: string; revision: number; style: AreaStyle;
  selection: string; recentFeedback: LibraryEvent[];
  references: (Pick<LibraryReference, "id" | "title" | "role" | "notes" | "tags" | "source" | "status" | "file" | "feedback"> & {sha256: string; attachment?: number})[];
}
interface LibraryResult { area: string; reference: string | null; revision: number }
interface ReferenceLibrary {
  root: string;
  areas(): (Pick<Area, "name" | "title" | "description" | "revision" | "counts"> & {workflow: WorkflowId})[];
  area(name: string): Area;
  references(opts: {area: string; status?: ReferenceStatus; search?: string; limit?: number}): LibraryReference[];
  reference(area: string, id: string): LibraryReference;
  journal(opts: {area: string; limit?: number; before?: number}): LibraryEvent[]; // newest first, immutable events
  select(opts: {area: string; query?: string; referenceIds?: string[]; limit?: number}): ReferenceSelection;
  // The following require act, but spend no image quota. User approval is separate from model review.
  createArea(opts: {name: string; title?: string; description?: string}): Area;
  addReference(opts: {area: string; image: string; title?: string; role?: ReferenceRole; notes?: string; tags?: string[]; source?: string; status?: ReferenceStatus}): LibraryReference;
  feedback(opts: {area: string; reference?: string; job?: string; verdict: ReferenceStatus; note?: string; role?: ReferenceRole; tags?: string[]}): LibraryReference;
  setStyle(opts: {area: string; guidance?: string; keep?: string[]; avoid?: string[]; workflow?: WorkflowId; note?: string}): Area;
  note(opts: {area: string; text: string}): LibraryEvent;
  sheet(opts: {area: string; out?: string; status?: ReferenceStatus | "all"}): {html: string; sheets: string[]; manifest: string; area: string; revision: number; references: number};
}
interface ImageValidation {
  format: string; width: number; height: number; bytes: number; sha256: string;
  hasAlpha: boolean; hasTransparency: boolean; fullyTransparent: boolean;
}
interface ImageReview {
  status: "pass" | "needs_review" | "unverified";
  checks: {criterion: string; status: "pass" | "fail" | "unverified"; detail: string}[];
  warnings: string[];
}
interface Job {
  id: string;              // "img-mwt675o6-6740"
  studio: string;
  kind: "make" | "edit" | "start";
  status: "queued" | "running" | "done" | "failed";
  request: ImageOptions & { prompt?: string; change?: string; image?: string; use?: string; size?: string; avoid?: string; style?: string };
  file: string | null;     // the image in the studio folder, once done
  copiedTo: string | null; // the copy at the path the caller asked for (never overwrites: hero-v2.png)
  prompt?: string;         // the final prompt the studio wrote (the imagegen skill's labeled spec)
  checked?: string;        // what the studio checked when it looked at its image
  notes?: string;          // choices it made, or what still misses
  attempts?: number;       // 1 or 2: it regenerates once when its check fails
  review?: ImageReview; validation?: ImageValidation; deliveryError?: string; guidanceRevision?: string;
  workflow?: Workflow; library?: {area: string; revision: number; referenceIds: string[]};
  libraryResult?: LibraryResult; libraryError?: string;
  referenceUse?: {reference: string; traits: string}[]; observations?: string[];
  error?: string;
  queuedAt: string; startedAt?: string; finishedAt?: string;
  seconds?: number; secondsSoFar?: number;
  waitingFor?: string | null; // queued: the job ahead of it in this studio
  route?: "new" | "resume" | "fork"; thread?: string; baseThread?: string | null; // which Codex thread ran it
}
interface Studio {
  name: string; thread: string | null; createdAt: string;
  style: string | null;     // house style applied to every request
  folder: string;           // where its images are saved
  images: number; lastImageAt: string | null;
  busyWith: string[] | null; // the jobs running or queued now
  open: string | null;      // "codex resume <thread>": the command to open the thread in Codex
}
interface HistoryRow {
  id: string; studio: string; kind: "make" | "edit"; at: string; file: string; copiedTo: string | null;
  request: Job["request"]; prompt: string | null; useCase: string | null; notes: string | null; thread: string; seconds: number;
  review?: ImageReview; validation?: ImageValidation; checked?: string; attempts?: number; guidanceRevision?: string;
  area?: string; libraryResult?: LibraryResult; workflow?: Workflow;
  exists: boolean;          // the file is still there
}

declare const imagegen: {
  imagesDir: string; // IMAGES_DIR
  act: boolean;      // true when this ask may make or change images
  library: ReferenceLibrary;
  workflows(): Workflow[]; // bundled specialist methods, pinned sources and licences

  // Reading (any ask)
  studios(): Studio[];
  job(id: string): Job;
  // Polls a job until it is done or failed, or `seconds` pass (at most 55, one cell). Loop it.
  wait(id: string, seconds?: number): Promise<Job>;
  jobs(opts?: { studio?: string; limit?: number }): Job[];            // newest first
  history(opts?: { studio?: string; search?: string; limit?: number }): HistoryRow[]; // newest first; search is a regex over the request and the prompt

  // Acting (only when act is true; otherwise they throw "not in this ask")
  // Each returns a queued Job at once; a turn takes 2 to 6 minutes. A busy studio forks its thread, so up to 4 jobs
  // per studio run at once with its style and references; more queue. Send related shots to one studio.
  // Paths are relative to the caller's folder. refs/image take a path, job id, area reference id or "last".
  // area defaults to studio, created on first generation. Approved references are selected automatically.
  // referenceIds explicitly chooses references for this job only; [] disables automatic attachments.
  make(opts: ImageOptions & { prompt: string }): Job;
  edit(opts: ImageOptions & { change: string; image?: string }): Job; // image defaults to "last"
  start(opts?: { studio?: string; style?: string }): Job | { started: false; studio: string; thread: string; open: string; note: string };
  reset(opts?: { studio?: string }): { reset: boolean; studio: string; oldThread?: string; note: string };
  cancel(id: string): { cancelled: boolean; id?: string; status?: string };
};
