/** Runs once when the server starts: the batch queue picks up where it was left. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startQueue } = await import("@/lib/batches/queue");
  await startQueue();
}
