/**
 * Escape user-entered text (trip names, element labels, display names)
 * before it goes into an outbound email's HTML (security audit 2026-10-13).
 * Subjects are plain text and don't need it.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
