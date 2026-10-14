"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { AuthCard, AuthHeading, AuthIcon, AuthText, authButton } from "@/components/auth-ui";

// Replaces the root layout when it errors, so it brings its own document,
// global styles and fonts (Next.js global-error convention).
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <title>Something went wrong · Catoco</title>
        <AuthCard label="Something went wrong">
          <AuthIcon icon="alert" tone="error" />
          <AuthHeading>Something went wrong</AuthHeading>
          <AuthText>Try again in a moment.</AuthText>
          <button type="button" onClick={() => retry()} className={authButton}>
            Try again
          </button>
        </AuthCard>
      </body>
    </html>
  );
}
