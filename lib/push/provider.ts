import "server-only";

// Push delivery behind one interface (three-prong Prompt 4, 2026-10-23), so
// FCM, APNs or the Capacitor plugin's server side can be swapped in without
// touching dispatch. No real provider yet: it needs the app shell (prompt B)
// and Matt's APNs auth key / Firebase project, which never go in the repo.
//
// PUSH_PROVIDER=log prints what would be sent (local testing). Anything else
// or unset = no provider, and lib/push/channels.ts falls back to email.

export type PushMessage = {
  token: string;
  platform: "ios" | "android" | "web";
  title: string;
  /** Generic line only: no amounts, other members' names or booking details. */
  body: string;
  /** Path inside the app, e.g. /trips/<id>/elements/<id>. */
  link: string;
  kind: string;
};

export type PushResult = {
  token: string;
  ok: boolean;
  /** The provider says this token is dead: revoke it. */
  invalidToken?: boolean;
  error?: string;
};

export interface PushProvider {
  name: string;
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

const logProvider: PushProvider = {
  name: "log",
  async send(messages) {
    for (const m of messages) {
      console.log(`[push:log] ${m.kind} → ${m.platform} …${m.token.slice(-6)}: "${m.body}" (${m.link})`);
    }
    return messages.map((m) => ({ token: m.token, ok: true }));
  },
};

export function getPushProvider(): PushProvider | null {
  switch (process.env.PUSH_PROVIDER) {
    case "log":
      return logProvider;
    default:
      return null;
  }
}

/**
 * Same split as email (lib/email.ts): only Production pushes to anyone.
 * Elsewhere push needs PUSH_SENDING_ENABLED=true AND the recipient's email
 * on PUSH_TEST_EMAILS (comma separated), so staging only reaches test devices.
 */
export function pushAllowedFor(email: string): boolean {
  if (!getPushProvider()) return false;
  if (process.env.VERCEL_ENV === "production") return true;
  if (process.env.PUSH_SENDING_ENABLED !== "true") return false;
  const allow = (process.env.PUSH_TEST_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}
