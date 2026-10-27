# Batches and the verification workflow

How documents travel from a batch to a technician's decision (F5). The design and its
decisions are in `docs/roadmap.md`, section 5, "Batches". The code is in `web/src/lib/batches/`.

## Life cycle

A batch is the unit of work. Each of its documents moves through these states:

```
queued → extracting → awaiting_verification → in_verification → approved
             ↘ failed (can be retried)                        ↘ rejected
```

- **extracting** runs the whole chain (`pipeline.ts`):
  1. **Reading:** the extractor, or its recorded reply in replay mode.
  2. **Fusion** against the workspace's LIS.
  3. **Test mapping:** memory, catalog search, then the model on red lines.

  The result is stored as the document's **proposal**, exactly as proposed.
- **failed** keeps the reason, for example an extractor error or no recorded reply. A
  retry queues the document again.
- **in_verification**, **approved** and **rejected** come with the verification screen
  (F5 blocks 3 and 4). A decision is written once and never updated (`decisions`). Approving
  also registers the request in the mock LIS (`requests`).

A batch has no state of its own: its progress is its documents counted by state.

## Two modes, one code path

`APP_MODE` picks the mode; every setting is in `web/.env.example`.

| | replay (default; the public demo) | live (the development machine) |
|---|---|---|
| Reading | The recorded prediction for the PDF's hash, from an extractor run (`REPLAY_GEMINI_RUN`, `REPLAY_LOCAL_RUN`). Served after the latency measured when it was recorded, divided by `REPLAY_SPEED` (5 by default: about 2 s for Gemini, 16 s for local Qwen). The screens say the replay is faster and show the measured latency. | `extract()`: Gemini, or the local model with OCR boxes. |
| Mapping model | Recorded replies only (`MAPPING_MODEL_CACHE`). Without one, red lines stay red. | `MAPPING_MODEL_PROVIDER`, with the same cache. |
| Documents | The bundled synthetic set (`DEMO_DOCUMENTS`) that has a recording for the provider. | The bundled set, and uploaded PDFs; one batch may mix them. |
| Workspaces | A sandbox per visitor, deleted `SANDBOX_TTL_HOURS` after its last use. | One workspace, `live`. |

The queue, the chain and the stored proposal are the same in both modes. Only what answers
the extractor's call changes. The proposal records whether its reading was recorded.

## Workspaces

A workspace is one SQLite database, kept in `APP_DATA_DIR/workspaces/`. It starts as a copy
of `LIS_TEMPLATE` (the mock LIS, the catalog and the mapping memory), and migrations add the
workflow's tables. A workspace therefore holds:

- its own batches;
- its own decisions;
- the requests it registers in the LIS;
- what its memory learns.

Visitors of the demo are kept apart without a workspace column in any table.

`APP_DATA_DIR` is outside the repository by default (`~/.clinical-intake-verifier`). In live
mode it holds uploaded PDFs, possibly real, and what was read from them.

## The queue

The queue is the documents' state in each workspace (`queue.ts`). A worker inside the server
process takes the oldest queued document whose provider has a free slot. It runs up to
`QUEUE_CONCURRENCY_GEMINI` documents at once for Gemini (4) and `QUEUE_CONCURRENCY_LOCAL` for
the local model (1), across all workspaces. When the server starts (`src/instrumentation.ts`):

- documents left `extracting` go back to the queue;
- in replay mode, expired sandboxes are swept, then every hour.

## Session

There is no authentication. The visitor picks one of a few synthetic technicians
(`technicians.ts`); the choice is kept in a cookie, and so is the sandbox in replay mode.
Every route except `/api/session` answers 401 until a technician is picked.

## Screens

`web/src/app/`, client pages over the API. Shared pieces are in `_ui/`: the API client, the
session shell and the state badges.

- **`/`, the entry:** what the project is, the mode, and the technician to work as.
- **`/batches`:** the batches, newest first, each with a progress bar by state and how many
  documents wait for verification.
- **`/batches/new`:** a name, the model that reads the batch, and its documents:
  - the bundled synthetic requests, with what their goldens say about them (pages, scanned
    or digital, handwriting, language), filterable, with "add 5 at random";
  - in live mode, uploaded PDFs too.
- **`/batches/:id`:** the documents in order, each with:
  - its state;
  - the error of a failed one, with a retry;
  - for one already read, its fields and lines counted by traffic-light colour, the model
    and the latency, marked "(recorded)" in replay mode.

**The look.** It is defined in `globals.css`:
- Geist type, downloaded by `next/font` at build time and served by the app;
- an indigo brand colour and soft white cards on a light grey ground;
- icons and the logo drawn inline (`_ui/icons.tsx`), so no icon package is needed;
- three illustrations, generated with an image model from prompts written for this project
  and optimised here:
  - `public/hero-intake.webp`, the entry's hero. Its white ground is blended away with
    `mix-blend-multiply`.
  - `public/empty-batches.webp`, the empty batch list.
  - `src/app/opengraph-image.jpg`, the share image, with the title set in Inter Display.
    `PUBLIC_URL` makes its address absolute.

Three families of colour never stand in for each other:
- the brand, for actions and navigation;
- the traffic light, for how sure a proposal is;
- the workflow's states.

The entry page shows the product's four steps, the traffic light, the measured figures and a
glimpse of the verification screen.

Pages showing documents still queued or reading poll every two seconds, and stop when
nothing moves. The workflow's states have their own colours, kept apart from the traffic
light's: green, orange and red say how sure a proposal is, never where a document is. In
replay mode, every page says the replies are recorded and the work stays in the visitor's
sandbox.

## API

| Route | What it does |
|---|---|
| `GET /api/session` | Mode, technicians, the current one (null before picking or once the sandbox expired). |
| `POST /api/session` | `{ "technician": "T01" }`: work as that technician; creates the sandbox if needed. |
| `GET /api/bundled?provider=gemini` | Bundled documents a batch can be made of (in replay, those with a recording), with what their goldens say: pages, scanned, handwritten fields, language, template. |
| `GET /api/batches` | Batches, newest first, with documents counted by state. |
| `POST /api/batches` | JSON `{ "provider", "name"?, "documents": [names] }`; in live mode also multipart with `files`. Up to 50 documents; queued at once. |
| `GET /api/batches/:id` | The batch and its documents in order; a ready one with its summary (model, latency, recorded, pages, fields and lines by colour). |
| `POST /api/documents/:id/retry` | A failed document back to the queue (409 otherwise). |
| `GET /api/documents/:id/proposal` | The prediction, the fusion and each line's codes (409 until ready). |
| `GET /api/documents/:id/pdf` | The PDF, for the viewer. |
