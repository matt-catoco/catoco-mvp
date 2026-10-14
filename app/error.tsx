"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";
import { AuthCard, AuthHeading, AuthIcon, AuthText, authButton, authGhostButton } from "@/components/auth-ui";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AuthCard label="Something went wrong">
      <AuthIcon icon="alert" tone="error" />
      <AuthHeading>Something went wrong</AuthHeading>
      <AuthText>Try again in a moment.</AuthText>
      <button type="button" onClick={() => retry()} className={authButton}>
        Try again
      </button>
      <Link href="/" className={authGhostButton}>
        Home
      </Link>
    </AuthCard>
  );
}
