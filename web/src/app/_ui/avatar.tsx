/** A person's initials in a tinted circle; the tint follows from the name, so it stays the same. */
const TINTS = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-800",
];

export function Avatar({ name, className = "size-9 text-sm" }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const tint = TINTS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tint} ${className}`} aria-hidden>
      {initials}
    </span>
  );
}
