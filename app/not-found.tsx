import Link from "next/link";
import { AuthCard, AuthHeading, authButton } from "@/components/auth-ui";

export default function NotFound() {
  return (
    <AuthCard label="Page not found">
      <span
        aria-hidden
        className="font-[family-name:var(--font-display)] text-[80px] font-bold leading-none tracking-[-0.04em] text-brand-accent"
      >
        404
      </span>
      <AuthHeading>Page not found</AuthHeading>
      <Link href="/" className={authButton}>
        Home
      </Link>
    </AuthCard>
  );
}
