"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fieldClass, labelClass } from "@/lib/ui";
import {
  CONFIRMATION_BUCKET,
  CONFIRMATION_DETAILS_MAX,
  CONFIRMATION_MAX_BYTES,
  CONFIRMATION_MIME_TYPES,
} from "@/lib/booking-confirmation";
import { prepareConfirmationUpload } from "./confirmation-actions";

/**
 * Optional booking-confirmation inputs for either "Mark booked" surface —
 * BookingConfirmation (no funding_request) and the funding card's
 * ready-to-purchase step. Both optional; whatever's entered is shown to the
 * whole trip afterward.
 */
export function useConfirmationFields() {
  const [details, setDetails] = useState("");
  const [file, setFile] = useState<File | null>(null);

  /** Uploads the attachment (if any) through a server-issued signed URL
   * into the private bucket, then returns what reportElementBooked needs. */
  async function collect(
    tripId: string,
    elementId: string,
  ): Promise<{ error?: string; confirmation?: { details?: string; attachmentPath?: string } }> {
    let attachmentPath: string | undefined;
    if (file) {
      const prep = await prepareConfirmationUpload(tripId, elementId, file.type, file.size);
      if (prep.error || !prep.path || !prep.token) {
        return { error: prep.error ?? "Couldn't attach that file. Try again." };
      }
      const { error } = await createClient()
        .storage.from(CONFIRMATION_BUCKET)
        .uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type });
      if (error) return { error: "Upload failed. Check the file and try again." };
      attachmentPath = prep.path;
    }
    const trimmed = details.trim();
    return { confirmation: { details: trimmed || undefined, attachmentPath } };
  }

  return { details, setDetails, file, setFile, collect };
}

export function ConfirmationFields({
  details,
  setDetails,
  file,
  setFile,
  disabled,
}: Pick<ReturnType<typeof useConfirmationFields>, "details" | "setDetails" | "file" | "setFile"> & {
  disabled?: boolean;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <div className="flex w-full flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Confirmation details (optional)</span>
        <textarea
          className={`${fieldClass} min-h-16 py-2`}
          placeholder="Confirmation number, check-in instructions, who it's booked under…"
          maxLength={CONFIRMATION_DETAILS_MAX}
          value={details}
          disabled={disabled}
          onChange={(e) => setDetails(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Receipt or screenshot (optional — image or PDF, 10 MB max)</span>
        <input
          type="file"
          accept={CONFIRMATION_MIME_TYPES.join(",")}
          disabled={disabled}
          className="text-xs file:mr-2 file:rounded-md file:border file:border-brand-line file:bg-transparent file:px-2 file:py-1 file:text-xs"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFileError(null);
            if (f && !CONFIRMATION_MIME_TYPES.includes(f.type)) {
              setFileError("Attach a PNG, JPEG, WebP image or a PDF.");
              e.target.value = "";
              setFile(null);
              return;
            }
            if (f && f.size > CONFIRMATION_MAX_BYTES) {
              setFileError("That file is over the 10 MB limit.");
              e.target.value = "";
              setFile(null);
              return;
            }
            setFile(f);
          }}
        />
        {file && <span className="text-[11px] text-brand-muted">{file.name}</span>}
        {fileError && <span className="text-xs text-red-500">{fileError}</span>}
      </label>
    </div>
  );
}
