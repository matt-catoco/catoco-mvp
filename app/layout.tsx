import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { PostHogProvider } from "@/components/posthog-provider";
import { CookieBanner } from "@/components/cookie-banner";
import { ServiceWorker } from "@/components/service-worker";

// Brand type system (design-handoff/catoco-brand-toolkit.md), applied
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

// The manifest (app/manifest.ts) and icons (app/icon.png, app/apple-icon.png)
// are picked up from their file conventions; this adds the iOS home-screen
// settings (app-store prep, prompt A).
export const metadata: Metadata = {
  title: "Catoco",
  description: "Plan group trips together — vote on the details, split the cost, go.",
  applicationName: "Catoco",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Catoco" },
};

// viewportFit "cover" lets the page reach under a notch / home indicator;
// globals.css and the fixed bars pad with env(safe-area-inset-*) to match.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0D2020",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PostHogProvider>
          {children}
          <CookieBanner />
          <ServiceWorker />
        </PostHogProvider>
      </body>
    </html>
  );
}
