import { createServiceClient } from "@/lib/supabase/service";
import { UnsubscribeFailedView, UnsubscribedView } from "./view";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One-click unsubscribe from the footer of every trip reminder email
 * (lib/notifications.ts builds /unsubscribe?u=<user id>&t=<token>). No auth
 * required — that's the point: it has to work straight from an email with no
 * session. The token in the link is the authority, not a cookie. Same flow
 * as the old route handler: unsubscribe_by_token() flips
 * profiles.email_notifications_enabled off when id + token match; a wrong or
 * missing token fails closed — no change, a generic "link didn't work".
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; t?: string }>;
}) {
  const { u: userId, t: token } = await searchParams;

  let ok = false;
  let email: string | null = null;
  if (userId && token && UUID_RE.test(userId) && UUID_RE.test(token)) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("unsubscribe_by_token", { p_user_id: userId, p_token: token });
    ok = !error && data === true;
    if (ok) {
      const { data: user } = await supabase.auth.admin.getUserById(userId);
      email = user.user?.email ?? null;
    }
  }

  if (!ok) return <UnsubscribeFailedView />;
  return <UnsubscribedView email={email} userId={userId!} token={token!} />;
}
