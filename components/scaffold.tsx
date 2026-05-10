import Link from "next/link"

type ScaffoldProps = {
  eyebrow: string
  title: string
  lede: string
  commit: string
  next: string[]
}

/**
 * Shared scaffold layout for non-briefing surfaces (Position Book, Borrower
 * X-Ray, Peer Telemetry, Patterns, Memo Composer). Each surface is part of a
 * later commit; this scaffold makes that explicit so the route renders
 * something honest instead of an empty 404.
 */
export function Scaffold({ eyebrow, title, lede, commit, next }: ScaffoldProps) {
  return (
    <main className="flex flex-col gap-6">
      <header className="border-b pb-6" style={{ borderColor: "var(--line)" }}>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-text-faint">
          {eyebrow}
        </div>
        <h1 className="font-serif text-[34px] font-normal leading-[1.15] tracking-[-0.6px] text-text">
          {title}
        </h1>
        <p className="mt-3 max-w-[720px] font-serif text-[17px] leading-[1.6] text-text-dim">
          {lede}
        </p>
      </header>

      <section
        className="rounded-[10px] border p-6"
        style={{
          background: "var(--bg-1)",
          borderColor: "var(--line)",
        }}
      >
        <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.15em] text-accent">
          scaffold · ships in {commit}
        </div>
        <p className="font-serif text-[14px] leading-relaxed text-text-dim">
          This surface is intentionally a scaffold. The Briefing at{" "}
          <Link href="/" className="text-accent underline-offset-4 hover:underline">
            /
          </Link>{" "}
          is live in Commit 2. The following items will be wired up in {commit}:
        </p>
        <ul className="mt-4 flex flex-col gap-2 font-mono text-[12px] text-text-dim">
          {next.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span className="mt-[2px] text-accent" aria-hidden>
                →
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
