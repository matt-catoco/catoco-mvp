import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewTripWizard } from "./new-trip-wizard";

export default async function NewTripPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/trips/new")}`);
  }

  return (
    <div className="flex flex-1 flex-col">
      <NewTripWizard userId={user.id} />
    </div>
  );
}
