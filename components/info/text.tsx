import type { ReactNode } from "react";

/**
 * Renders a catalog string, turning [[placeholder]] markers into a visibly
 * highlighted span so unfinished copy can't slip through unnoticed.
 */
export function T({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  const re = /\[\[(.+?)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(children)) !== null) {
    if (m.index > last) parts.push(children.slice(last, m.index));
    parts.push(
      <mark
        key={i++}
        className="rounded bg-brand-amber/25 px-1 text-foreground"
        title="Placeholder: replace before launch"
      >
        {m[1]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < children.length) parts.push(children.slice(last));
  return <>{parts}</>;
}

export function Banner({ children }: { children: string }) {
  return (
    <p className="mb-8 rounded-lg border border-brand-amber/50 bg-brand-amber/15 px-4 py-3 text-sm text-foreground">
      {children}
    </p>
  );
}

export function PageHeading({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className="mb-10">
      <p className="text-sm font-medium text-brand-teal-deep">{eyebrow}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
        {title}
      </h1>
      {lede ? (
        <p className="mt-4 max-w-2xl text-lg text-brand-muted">
          <T>{lede}</T>
        </p>
      ) : null}
    </header>
  );
}
