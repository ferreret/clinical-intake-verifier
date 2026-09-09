export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">clinical-intake-verifier</h1>
      <p className="mt-4 text-neutral-700">
        AI-assisted intake of clinical lab requests with a human in the loop. The model is one
        source among several, not the source of truth.
      </p>
      <p className="mt-4 text-neutral-700">
        The extractor is available at <code className="rounded bg-neutral-100 px-1">POST /api/extract</code>{" "}
        (multipart form, field <code className="rounded bg-neutral-100 px-1">file</code>). The
        verification interface arrives in a later phase.
      </p>
    </main>
  );
}
