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
| `NODE_IMAGE` | Optional: the base image, pinned by digest in the `Dockerfile`; Dependabot proposes a new digest when the image is updated |

## Settings

The image sets replay mode and where its data is; a deployment only adds what it needs.

| Setting | Value |
|---|---|
| `PUBLIC_URL` | The address's origin, without the path: the share image's address is made from it, and Next.js adds the path |
| `MAX_SANDBOXES` | Optional, 500 by default: sandboxes kept at most; a new visitor beyond it takes the place of the one unused for longest. Half a megabyte each to start, some 30 KB more for each document read, so some 6.5 MB at most with `MAX_SANDBOX_DOCUMENTS` |
| `MAX_SANDBOX_DOCUMENTS` | Optional, 200 by default: documents one sandbox may hold, read or not; beyond it, the visitor is asked to delete a batch first |
| `NEW_SANDBOXES_PER_HOUR` | Optional, 20 by default: new sandboxes one client address may make in an hour, so that a script cannot fill the demo; the address is Cloudflare's `CF-Connecting-IP` when present (behind Cloudflare, `X-Forwarded-For` ends with Cloudflare's own address, the same for every visitor), else the last one the proxy adds to `X-Forwarded-For` |
| `CLIENT_ADDRESS_HEADER` | Optional: the header the proxy in front of the app puts the client's address in, when it is neither of those |
| `SANDBOX_IDLE_MINUTES` | Optional, 30 by default: how long a sandbox must have been unused to make room for a new visitor; when none has, the new visitor is told the demo is full |
| `LOCK_MINUTES` | Optional, 30 by default (at least 15): how long a document stays locked to a technician whose page stopped renewing the lock |
| `SANDBOX_TTL_HOURS` | Optional, 24 by default: hours a sandbox lives after its last use |
| `REPLAY_SPEED` | Optional, 20 by default: how much faster than recorded a reply comes |
| `PRIVATE_SET_DIR` | Optional, one deployment only: where its private set is mounted (below, "A private set") |
| `PRIVATE_SET_PASSWORD` | With `PRIVATE_SET_DIR`: the set's password, at least 12 characters, a long random one. Without both, or with a shorter password, nothing about the set shows |

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

## A private set

One deployment may offer, besides the synthetic documents, real requests that were anonymized
(the patient's and the physician's data replaced by fictitious data: [anonymize.md](anonymize.md)),
behind a password. Why, and the rule it is an exception to: the roadmap's entry of 2026-11-18.
The repository, the release archive and the image never hold it; the other deployment does not
have one.

The set is a folder, made on the development machine:

```
<set>/
  documents/      the anonymized PDFs
  runs/gemini/    the extractor's run on them with Gemini
  runs/local/     and with the local model, if it read them
  mapping.json    the mapping model's recorded replies for those runs
```

```bash
cd web
npm run extract -- --in <set>/documents --out <set>/runs/gemini --provider gemini
npm run extract -- --in <set>/documents --out <set>/runs/local --provider local
npm run record-mapping -- --runs <set>/runs/gemini,<set>/runs/local --out <set>/mapping.json
```

The runs must read the very files in `documents/`: replay finds a reply by the PDF's hash. A
document with no reply recorded for a model is not offered with that model.

It reaches the server over SSH (`rsync -a --delete <set>/ <server>:<folder>/`), and the
application mounts that folder read-only (Dokploy: Advanced, Volumes, a bind mount) at, say,
`/app/private`, with `PRIVATE_SET_DIR=/app/private` and `PRIVATE_SET_PASSWORD` in its settings.
The recorded replies are read once, when the app starts: after copying a new version of the
set, deploy again.

What a visitor sees: under the synthetic requests on the new-batch screen, a discreet "Private
set" link asks for the password. The right one unlocks the visitor's sandbox, not their
browser, and the set's documents are listed apart, to be chosen like the synthetic ones; a
sandbox that starts from scratch is locked again. Five wrong passwords from one address hold it
back for fifteen minutes. The documents are served only to a sandbox that unlocked the set.

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
- **Update order: stop-first** (Swarm settings, update config). One container at a time on the
  volume: the queue, the sandbox sweep and the in-process turns on each SQLite file assume a
  single server, and with start-first the old and the new one overlap during a deployment.
  The image's healthcheck (`/api/session` under the app's path) tells Dokploy when the new
  one is ready.

## Checking it

- The log says `Ready`, and nothing else until visits come.
- The address opens the entry page; the address with a final slash redirects to it.
- Picking a technician, then a new batch of a few documents: they are read in seconds, with
  most lines green. A document's pages show, and approving it goes on to the next.
- "Start from scratch", on the entry page, gives a new sandbox.
- With a private set: the link shows under the synthetic requests, a wrong password is
  refused, the right one lists the set, and a batch of its documents is read and shown.

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
