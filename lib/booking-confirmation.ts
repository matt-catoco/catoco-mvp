// Shared (client + server) constants for booking-confirmation attachments —
// must match the booking-confirmations bucket's own limits
// (20260930010000_booking_confirmation.sql), which are the real enforcement.
export const CONFIRMATION_BUCKET = "booking-confirmations";
export const CONFIRMATION_MAX_BYTES = 10 * 1024 * 1024;
export const CONFIRMATION_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
export const CONFIRMATION_DETAILS_MAX = 4000;
