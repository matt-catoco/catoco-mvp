import Link from "next/link";
import { AuthCard, AuthHeading, AuthIcon, AuthText, authLink } from "@/components/auth-ui";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <AuthCard label="Check your email">
      <AuthIcon icon="mail" />
      <AuthHeading>Check your email</AuthHeading>
      <AuthText>
        We sent a link{email ? " to " : "."}
        {email && <span className="break-all font-semibold text-foreground">{email}</span>}
      </AuthText>
      <p className="text-[13px] text-brand-muted">
        Wrong address?{" "}
        <Link href="/sign-in" className={authLink}>
          Try again
        </Link>
      </p>
    </AuthCard>
  );
}
