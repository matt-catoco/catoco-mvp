// Browser side of push (three-prong Prompt 4). The app shell (prompt C)
// stores the device token here after registering it with /api/push/devices,
// so sign-out can unregister this device.
export const PUSH_TOKEN_KEY = "catoco:push-token";

/** Best-effort: unregister this device before signing out. */
export async function unregisterThisDevice(): Promise<void> {
  let token: string | null = null;
  try {
    token = window.localStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return;
  }
  if (!token) return;
  try {
    await fetch("/api/push/devices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    window.localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    // Not fatal: a dead token is pruned on the next failed send.
  }
}
