/** Home-only fallback. Kept out of `app/` so `/vaults/[id]` can 404 before a stream. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <h1 className="sr-only">Owner console</h1>
      <p className="sr-only" role="status">
        Loading owner console
      </p>
      <div className="min-h-[28rem] rounded-lg border border-border bg-card/70 sm:min-h-[32rem]" />
    </div>
  );
}
