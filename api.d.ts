interface ImageReference { image: string; role: string }
interface ImageOptions {
  out?: string; refs?: (string | ImageReference)[]; use?: string; size?: string;
  avoid?: string; context?: string; transparent?: boolean; maxAttempts?: 1 | 2; studio?: string;
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
  error?: string;
  queuedAt: string; startedAt?: string; finishedAt?: string;
  seconds?: number; secondsSoFar?: number;
  waitingFor?: string | null; // queued: the job ahead of it in this studio
}
interface Studio {
  name: string; thread: string | null; createdAt: string;
  style: string | null;     // house style applied to every request
  folder: string;           // where its images are saved
  images: number; lastImageAt: string | null;
  busyWith: string | null;  // the job running now
  open: string | null;      // "codex resume <thread>": the command to open the thread in Codex
}
interface HistoryRow {
  id: string; studio: string; kind: "make" | "edit"; at: string; file: string; copiedTo: string | null;
  request: Job["request"]; prompt: string | null; useCase: string | null; notes: string | null; thread: string; seconds: number;
  review?: ImageReview; validation?: ImageValidation; checked?: string; attempts?: number; guidanceRevision?: string;
  exists: boolean;          // the file is still there
}

declare const imagegen: {
  imagesDir: string; // IMAGES_DIR
  act: boolean;      // true when this ask may make or change images

  // Reading (any ask)
  studios(): Studio[];
  job(id: string): Job;
  // Polls a job until it is done or failed, or `seconds` pass (at most 55, one cell). Loop it.
  wait(id: string, seconds?: number): Promise<Job>;
  jobs(opts?: { studio?: string; limit?: number }): Job[];            // newest first
  history(opts?: { studio?: string; search?: string; limit?: number }): HistoryRow[]; // newest first; search is a regex over the request and the prompt

  // Acting (only when act is true; otherwise they throw "not in this ask")
  // Each returns a queued Job at once; the turn takes 1 to 3 minutes. A studio runs one job at a time; others queue.
  // Paths are relative to the caller's folder. `out` is a file or a folder (ends with /). refs and image take a path, a job id or "last".
  make(opts: ImageOptions & { prompt: string }): Job;
  edit(opts: ImageOptions & { change: string; image?: string }): Job; // image defaults to "last"
  start(opts?: { studio?: string; style?: string }): Job | { started: false; studio: string; thread: string; open: string; note: string };
  reset(opts?: { studio?: string }): { reset: boolean; studio: string; oldThread?: string; note: string };
  cancel(id: string): { cancelled: boolean; id?: string; status?: string };
};
