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

- **`/batches/:id/:document`, verification:** the pages on the left, the proposal on the
  right.
  - **Pages.** They are rendered on the server (`/api/documents/:id/pages/:n`, 130 dpi, the
    last 12 documents kept), so the browser needs no PDF library. Every value read has a box:
    - **Exact:** placed by the page's OCR, or by Gemini (99.4% at IoU 0.5).
    - **Approximate:** the local model's own boxes (15.6% where the OCR could not place the
      value), drawn dashed with a margin.

    The focused item's box is highlighted and scrolled into view; clicking a box focuses its
    item.
  - **The lab's records:** the patient, physician and insurer the document is linked to, or
    the candidates, with why.
  - **Fields as a table, by group.** Each row has:
    - its light, and the reason for it;
    - **Read:** what the document says, with its page;
    - **Records:** what the lab's records say, marked when only a candidate record says it;
    - **Proposed:** the engine's value and where it came from;
    - **Selected:** the value the technician sets, which can be typed over and is marked when
      changed.

    Clicking Read or Records selects that value; the one that matches the selection is
    highlighted. A conflict proposes nothing and is settled with one click, or Alt+1 / Alt+2.
  - **The requested lines as a table:**
    - **Read:** the line as written;
    - **Proposed:** the codes with their names, and where they came from (memory, search or
      model);
    - **Selected:** the codes as chips, each removable, and any test or profile of the
      catalog added with a search by name or code (`codes.tsx`, `GET /api/catalog`); with
      the search empty, the line's own candidates are offered. "Back to proposed" undoes it.

    A line that is not a test, or was not requested, is dropped: it stays in view struck
    through, with an undo, so that the approval can record that it was read and left out. A
    test the reading missed is added by hand: it has no page or box, its text is what the
    technician writes (optional), and its codes come from the catalog search. An added line
    will not teach the memory of approvals, having no printed line to remember.
  - **The lens** (`lens.tsx`). While the pointer is on a value in the Read column, a window
    shows the part of the page where it was read, magnified, with the box drawn. The window
    sits beside the row, and a line joins it to the box in the viewer, dashed when the box is
    approximate. If that box is out of view, the viewer moves to it once the pointer has
    rested on the value for a moment. The window and the line follow the scrolling of the
    table and of the viewer, and go as soon as the pointer leaves the cell. It is shown on
    wide layouts only, and turned on or off with Alt+Z or the "Lens" switch, which this
    browser remembers. Asked for by the product owner, after a pattern a colleague uses in
    their own applications.
  - **Built for wide screens (1920 to 3840 px).** Below 2560 px, the document is on the left
    and the proposal on the right. From there up, the proposal splits into fields and tests
    side by side, and from about 2300 px of viewer the pages go two by two. The tables narrow
    with their container: the records go under what was read, then the proposed column goes.
  - **Keyboard:** Alt+↓/↑ next and previous item, Alt+→/← next and previous document of the
    batch, Alt+Z the lens, Esc to leave an input, ? for the list.
  - **Footer:** what is left to resolve (a red or required field still empty, a line with no
    codes), "Leave for later", and the approval, which comes with block 4.

  Opening a document locks it to the technician (`POST /api/documents/:id/open`); another
  technician sees it read-only and can take it over. Leaving it for later, or moving to
  another document, releases it (`POST /api/documents/:id/release`). The technician's
  changes stay in the page until approval: leaving with changes asks first.

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
| `GET /api/catalog?q=` | The workspace's catalog searched by a typed name or code: codes that start with it first, then the trigram search; with each code's name. |
| `GET /api/documents/:id/proposal` | The prediction, the fusion and each line's codes (409 until ready); with the catalog names of the codes, the linked and candidate LIS records, and the batch's documents in order. |
| `POST /api/documents/:id/open` | Lock the document for verification to the technician (409 if another has it, unless `{ "takeOver": true }`, or if it is not ready). |
| `POST /api/documents/:id/release` | Leave it for later: back to awaiting verification (only its holder). |
| `GET /api/documents/:id/pages/:n` | Page n as a PNG, for the viewer. |
| `GET /api/documents/:id/pdf` | The PDF, for the viewer. |
