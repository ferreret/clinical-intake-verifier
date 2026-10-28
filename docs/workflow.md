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

**Deleting a batch** (`lib/batches/remove.ts`), from the batch list or the batch page, after a
confirmation that says what goes: its documents and their proposals, the decisions taken on
them and the requests those approvals registered in the mock LIS, in one transaction, and
then its uploaded PDFs. What the mapping memory learned from its approvals stays, as it
cannot be told apart from what other approvals taught. A batch still being read waits.
"Delete all", on the batch list, deletes every batch but those still being read, and says
how many stay.

## Two modes, one code path

`APP_MODE` picks the mode; every setting is in `web/.env.example`.

| | replay (default; the public demo) | live (the development machine) |
|---|---|---|
| Reading | The recorded prediction for the PDF's hash, from an extractor run (`REPLAY_GEMINI_RUN`, `REPLAY_LOCAL_RUN`). Served after the latency measured when it was recorded, divided by `REPLAY_SPEED` (20 by default: about half a second for Gemini, 4 s for local Qwen). The screens say the replay is faster and show the measured latency. | `extract()`: Gemini, or the local model with OCR boxes. |
| Mapping model | Recorded replies, per line (`REPLAY_MAPPING`, `npm run record-mapping`): the model was asked about every line of each demo document, so whichever lines are red find their answer. A line not recorded stays red, and the decision log says why. | `MAPPING_MODEL_PROVIDER`, cached by request (`MAPPING_MODEL_CACHE`). |
| Documents | The bundled synthetic set (`DEMO_DOCUMENTS`) that has a recording for the provider. | The bundled set, and uploaded PDFs; one batch may mix them. |
| Workspaces | A sandbox per visitor, deleted `SANDBOX_TTL_HOURS` after its last use, or when the visitor chooses "Start from scratch" on the entry page (`DELETE /api/session`). | One workspace, `live`. |

The queue, the chain and the stored proposal are the same in both modes. Only what answers
the extractor's call changes. The proposal records whether its reading was recorded.

## Workspaces

A workspace is one SQLite database, kept in `APP_DATA_DIR/workspaces/`. It starts as a copy
of `LIS_TEMPLATE` (the mock LIS, the catalog and the mapping memory), and migrations add the
workflow's tables. The demo's template (`npm run seed-memory`, `data/lis/seed-42-demo.sqlite`)
starts with the memory of 400 earlier requests: synthetic documents 200 to 999 of the
1,000-document set, which the demo never shows, each line taken as approved with its right
codes under its insurer. A sandbox thus starts where a lab with some history would. A workspace therefore holds:

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
    last 60 documents kept), so the browser needs no PDF library. The queue renders them as
    soon as a document is read, and the screen fetches those of the documents either side
    ahead, so moving through a batch does not wait for them. Every value read has a box:
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
    batch, Alt+N / Alt+Shift+N next or previous item still to resolve or confirm (also the
    arrows by the count in the footer), Alt+Enter confirm and go to the next item to check,
    Ctrl+Enter approve, Alt+Z the
    lens, Esc to leave an input. All of them, grouped, in a window opened from the footer's
    "Keyboard shortcuts" button or with ? (`shortcuts.tsx`). While the reject panel, a dialog
    or the record search is open, only the lens, the log and Esc respond. In a text field on
    a Mac, Option+←/→ moves by words as usual; AltGr and Option never take a conflict's value
    while typing, since they type "@" and "|".
  - **Footer:** what is left to resolve or confirm, the confirmations made, Reject, "Leave
    for later" and Approve.

  **The decision log** (`explain.ts`, `log.tsx`). Why each value and code was proposed, step
  by step, and what the technician did with it. Clicking a field's reason, or "Why?" under a
  test line, unfolds its steps below the row:
  - a field: what was read and on which page, with its warnings; what the linked record
    holds; how the two were compared (the compare mode of fields.json and both values as
    compared); the rule that set the colour; what is proposed and from where (an age kept as
    a number); and the technician's change or confirmation;
  - a test line: what this insurer's approvals held for it, and other insurers'; the
    catalog's closest entries with their scores and the thresholds; whether the model was
    asked and what it answered, or why it could not be; the result; the technician's codes.

  "Decision log" in the footer (Alt+L) opens the whole document's log in a panel: the
  reading (model, prompt, attempts, latency, where the boxes came from, warnings, fields
  left empty), the record links and on what keys, every field and line, and the decision
  (who, when and what was done), or the technician's unsaved work.

  What could not be told later is recorded when the document is processed: per line, the
  memory as it was and the model's answer (`seen`, in the proposal's tests), and for the
  document the memory scope, the language the model was told and how the model was
  consulted (`proposals.trace`, migration 0003). The rest is derived from what is stored,
  the way the engine did it, so it also holds once a record is linked by hand. Documents
  processed before the log say what is not known.

  **Searching the records** (`records.tsx`, `lib/lis/records.ts`). Each record card (patient,
  physician, insurer) has a magnifier that searches the lab's records of its kind: every
  word of a name, accents and case aside, or an identifying number (identity document,
  birth date, phone, registration number, insurer code). Choosing one links the document to
  it, marked "chosen by you", and the document is fused again against it
  (`POST /api/documents/:id/fusion`): the fields the technician has not changed take the new
  proposal, and field confirmations start over. "No record" says the person or insurer is
  new. "Back to what was found" undoes it. Nothing is stored until approval, which checks
  the fields against the chosen records and records the choice. The search is not modal:
  it opens by its button, never over the document, which can be scrolled and zoomed while
  searching, since what is searched for is read off it; a click elsewhere, or Esc, closes it.

  **Approving** (`lib/batches/decide.ts`, F4 decision 9). A red or orange field or line is
  resolved one by one: by changing it, or by confirming it as proposed with its check
  button (Alt+Enter). A green one is covered by the approval itself. Required fields need a
  value, every value its field's form (`inForm`: the pattern, the enum, and a date that
  exists; one out of it cannot be confirmed, only changed), and every kept line its codes.
  Approve stays disabled until nothing is left, and the
  server checks it all again. Then, in one transaction:
  - the decision, written once: who, when, and per field and line what was proposed, what
    was approved and how (kept, confirmed, changed; for lines also corrected, chosen,
    dropped, added);
  - the request in the mock LIS, with the approved values and codes, and the patient,
    physician and insurer records the document was linked to (a candidate is not);
  - the memory of approved mappings, taught the approved lines: a green line approved as
    proposed counts as passive, one confirmed or chosen as active, and a replaced proposal
    as a correction. Dropped and added lines teach nothing. Documents already processed keep
    their proposals; what the memory learns shows in documents read afterwards.

  The screen then opens the batch's next document still to decide on, after this one and
  wrapping round: first one nobody has open or the technician has; else one another
  technician left open, shown read-only with the offer to take it over. With none left, it
  goes back to the batch.
  **Rejecting** asks for a reason (illegible, not a lab request, a duplicate, other with a
  note) and keeps the document and its proposal. A decided document opens read-only, showing
  what was approved as recorded, or who rejected it and why.

  Opening a document locks it to the technician (`POST /api/documents/:id/open`); another
  technician sees it read-only and can take it over. Leaving it for later, or moving to
  another document, releases it (`POST /api/documents/:id/release`), and so does leaving any
  other way: a link in the header, the browser's Back, closing or reloading the tab. The
  technician's changes stay in the page until they approve: leaving with changes or
  confirmations asks first, by the page's buttons and links as by the browser's own question
  on closing or reloading; only Back cannot be asked about.

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

**Languages: English and Spanish.** An EN | ES switch sits on the entry page and in the
header. The choice is kept in the `civ_lang` cookie, so the server renders the next page in
it; with no choice, the browser's Accept-Language decides (Catalan reads Spanish), else
English (`_ui/lang.ts`).
- **Every text** lives in `_ui/messages/en.ts` and `es.ts`; the compiler checks they have the
  same shape. Texts with numbers or names are functions.
- **Field labels** come from `schema/fields.json`, the one place fields are configured:
  `label` in English, `label_es` in Spanish.
- **The server's explanations** (why a record was linked, where a line's codes came from)
  are written in English; the Spanish messages translate them by pattern, clause by
  clause, and show an unknown one as it is. Unnamed batches are numbered in the visitor's
  language. Extraction errors stay as the extractor wrote them.

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
| `DELETE /api/batches` | Delete every batch but those still being read. Returns how many went and how many stay. |
| `DELETE /api/batches/:id` | Delete the batch and everything it left: documents, proposals, decisions, the requests registered in the mock LIS, uploaded PDFs. 409 while a document is being read. |
| `POST /api/documents/:id/retry` | A failed document back to the queue (409 otherwise). |
| `GET /api/catalog?q=` | The workspace's catalog searched by a typed name or code: codes that start with it first, then the trigram search; with each code's name. |
| `GET /api/documents/:id/proposal` | The prediction, the fusion and each line's codes (409 until ready); with the catalog names of the codes, the linked and candidate LIS records, and the batch's documents in order. |
| `POST /api/documents/:id/open` | Lock the document for verification to the technician (409 if another has it, unless `{ "takeOver": true }`, or if it is not ready). |
| `GET /api/lis/search?kind=patient&q=` | The LIS records of one kind (patient, physician, insurer) a typed name or number finds. |
| `POST /api/documents/:id/fusion` | The document fused again with links the technician chose: `{ links: { patient: id or null, … } }`. Nothing stored. |
| `POST /api/documents/:id/approve` | Approve it: `{ fields, lines, added, confirmed, links? }`. 422 with the problems when something is unresolved; 409 when it is not in verification by this technician. Returns the decision and the next document to verify. |
| `POST /api/documents/:id/reject` | Reject it: `{ reason, note }`, the note required with `other`. Returns the decision and the next document to verify. |
| `POST /api/documents/:id/release` | Leave it for later: back to awaiting verification (only its holder). |
| `GET /api/documents/:id/pages/:n` | Page n as a PNG, for the viewer. |
| `GET /api/documents/:id/pdf` | The PDF, for the viewer. |
