import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";
import { site } from "@/content/pages/en";

/**
 * Header + footer for the public info pages. Deliberately static (no
 * Supabase call) so these pages stay fast and cacheable. The signed-in app
 * keeps its own SiteNav.
 */
export function InfoHeader() {
  return (
    <header className="border-b border-brand-line">
      <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-5 w-5">
            <LogoMark />
          </span>
          catoco
        </Link>
        <div className="flex items-center gap-5">
          {site.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hidden text-sm font-medium text-brand-muted hover:text-foreground sm:inline"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/sign-in"
            className="rounded-full bg-brand-teal px-4 py-1.5 text-sm font-semibold text-[#0d2020] hover:bg-brand-teal-deep hover:text-white"
          >
            Sign in
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function InfoFooter() {
  const cols = [
    { title: site.footer.product, links: site.footer.links.product },
    { title: site.footer.company, links: site.footer.links.company },
    { title: site.footer.legal, links: site.footer.links.legal },
  ];
  return (
    <footer className="mt-24 border-t border-brand-line">
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-12 sm:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="h-5 w-5">
              <LogoMark />
            </span>
            catoco
          </div>
          <p className="mt-3 text-sm text-brand-muted">{site.tagline}</p>
        </div>
        {cols.map((col) => (
          <div key={col.title}>
            <h2 className="font-sans text-sm font-semibold">{col.title}</h2>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-brand-muted hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mx-auto w-full max-w-5xl px-6 pb-10 text-xs text-brand-muted">
        © {new Date().getFullYear()} {site.footer.rights}
      </p>
    </footer>
  );
}
