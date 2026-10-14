import { AuthCard, AuthHeading, AuthIcon, AuthText } from "@/components/auth-ui";
import { UndoUnsubscribe } from "./undo";

export function UnsubscribedView({ email, userId, token }: { email: string | null; userId: string; token: string }) {
  return (
    <AuthCard label="Unsubscribed">
      <AuthIcon icon="check" />
      <AuthHeading>Unsubscribed</AuthHeading>
      <AuthText>
        {email ? <span className="break-all font-semibold text-foreground">{email}</span> : "You"} won&apos;t get emails
        from us.
      </AuthText>
      <UndoUnsubscribe userId={userId} token={token} />
    </AuthCard>
  );
}

export function UnsubscribeFailedView() {
  return (
    <AuthCard label="Link didn't work">
      <AuthIcon icon="alert" tone="error" />
      <AuthHeading>That link didn&apos;t work</AuthHeading>
      <AuthText>If you&apos;re still getting emails you don&apos;t want, reach out to hello@catoco.co.</AuthText>
    </AuthCard>
  );
}
