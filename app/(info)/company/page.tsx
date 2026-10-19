import { permanentRedirect } from "next/navigation";

// The Company page was merged into About (founder, 2026-10-19).
export default function CompanyPage() {
  permanentRedirect("/about");
}
