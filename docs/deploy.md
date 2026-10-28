# Deploying the demo

One image (the `Dockerfile` at the root), built per deployment. What a deployment does is
decided by its build arguments and its settings alone; nothing in the code knows which one
it is. No address, key or name of a real organisation is written in this repository: the
addresses below are placeholders.

Both deployments replay recorded replies on the bundled synthetic documents
([workflow.md](workflow.md), "Two modes, one code path"): no API key on the server, no
uploads, no cost per visit, and a sandbox of its own for each visitor.

| | Under a path of a shared address | At the root of its own address |
|---|---|---|
| Address | `https://demos.example.dev/verificador-peticiones` | `https://verifier.example.com` |
| `BASE_PATH` (build) | `/verificador-peticiones` | not set |
| HTTPS | Ends before the reverse proxy (a tunnel): the proxy serves plain HTTP | The reverse proxy gets the certificate |
| `PUBLIC_URL` | `https://demos.example.dev` | `https://verifier.example.com` |

They share nothing: each has its own build, settings and volume.

## Build arguments

| Argument | Value |
|---|---|
| `BASE_PATH` | The path the app is served under, as `/name`; not set to serve it at the root. Next.js fixes it when building, so each deployment builds its own image |
| `DEMO_DATA_URL` | The demo's data archive, from a release of this repository (below) |
| `DEMO_DATA_SHA256` | That archive's sha256: the build fails if the download is not that one |

## Settings

The image sets replay mode and where its data is; a deployment only adds what it needs.

| Setting | Value |
|---|---|
| `PUBLIC_URL` | The address's origin, without the path: the share image's address is made from it, and Next.js adds the path |
| `MAX_SANDBOXES` | Optional, 500 by default: sandboxes kept at most; a new visitor beyond it takes the place of the one unused for longest. About half a megabyte each |
| `SANDBOX_IDLE_MINUTES` | Optional, 30 by default: how long a sandbox must have been unused to make room for a new visitor; when none has, the new visitor is told the demo is full |
| `LOCK_MINUTES` | Optional, 30 by default (at least 15): how long a document stays locked to a technician whose page stopped renewing the lock |
| `SANDBOX_TTL_HOURS` | Optional, 24 by default: hours a sandbox lives after its last use |
| `REPLAY_SPEED` | Optional, 20 by default: how much faster than recorded a reply comes |

Set by the image, to leave alone: `APP_MODE=replay`, `APP_DATA_DIR=/app/state`,
`DEMO_DOCUMENTS`, `REPLAY_GEMINI_RUN`, `REPLAY_LOCAL_RUN`, `LIS_TEMPLATE`, `REPLAY_MAPPING`,
`MAPPING_MODEL_CACHE`, `PORT=3000`, `HOSTNAME=0.0.0.0`. Not set, on purpose:
`GEMINI_API_KEY` (nothing is sent to a model).

The same list without values, to copy into the deployment: [`.env.example`](../.env.example).

## The demo's data

`data/` is outside version control, so the image takes the demo's data from an archive
attached to a release of this repository. Everything in it is synthetic, made by the project:

- the 200 bundled requests (PDFs, and their goldens for what the new-batch screen says);
- the extractor's recorded readings, Gemini's and the local model's;
- the template: the mock LIS, the catalog, and the memory of 400 earlier approved requests;
- the mapping model's recorded replies.

To make a new one, from `web/` with the data in place:

```bash
npm run seed-memory
npm run record-mapping
npm run pack-demo
```

`pack-demo` prints the archive's sha256. Attach the archive to a release
(`gh release create demo-data-<date> <archive>`), and set `DEMO_DATA_URL` and
`DEMO_DATA_SHA256` to the asset's address and that sha256.

## On Dokploy

- **An application from this GitHub repository**, branch `production`, built with the
  `Dockerfile` at the root, with the build arguments above. `main` is where the work goes;
  publishing is moving `production` forward to it, so a push to `main` publishes nothing.
- **Port 3000.**
- **A volume mounted at `/app/state`:** the sandboxes, one SQLite file per visitor.
- **A domain:**
  - Under a path: the path set in the domain, and **Strip path off**. Next.js serves the
    app under its path itself and expects to receive it; this differs from apps whose page
    asks for everything by relative address.
  - With HTTPS ending before the reverse proxy (a tunnel), the domain is served over HTTP,
    with no certificate and no redirect to HTTPS, as the other apps behind the same tunnel.
  - With the reverse proxy getting the certificate, HTTPS on, with Let's Encrypt.
- If the reverse proxy does not reach the container, check the service it points to against
  those of the other apps on the same server.

## Checking it

- The log says `Ready`, and nothing else until visits come.
- The address opens the entry page; the address with a final slash redirects to it.
- Picking a technician, then a new batch of a few documents: they are read in seconds, with
  most lines green. A document's pages show, and approving it goes on to the next.
- "Start from scratch", on the entry page, gives a new sandbox.

Locally, without Docker: `BASE_PATH=/name npx next build` in `web/`, then copy
`.next/static` and `public/` next to `.next/standalone/web/server.js`, set the settings the
image sets, and run `node server.js`. Note that browsers keep cookies per host, not per port:
test on `127.0.0.1` if a development server runs on `localhost`.

## Live mode, not used by these deployments

`APP_MODE=live` reads new documents with Gemini (`GEMINI_API_KEY`) and accepts uploads. In
this image:

- only Gemini can read: the local model and its OCR are not in the container;
- there is one workspace, shared by everyone who has the address, and no sign-in: it needs
  access control in front of it;
- an uploaded request may be a real one, health data sent to a model: not for a public
  address.
