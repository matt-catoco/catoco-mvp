import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

// Brand type system (design-handoff/cataco-brand-toolkit.md), applied
// platform-wide: Bricolage Grotesque for display/headings, Inter for
// body/UI. Loaded once here so every route inherits it — the homepage
// previously loaded its own copy locally; now it just uses these.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cataco",
  description: "Plan group trips together — vote on the details, split the cost, go.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
