import "server-only";
import type { CollectionMode } from "./collection-modes";

// Which modes can be SELECTED in this environment (the launch-scope
// amendment: every mode is SHOWN; the flag only controls selectability).
// Production at launch: pledge on, the other two off. Unset = that default.
export function enabledCollectionModes(): Record<CollectionMode, boolean> {
  return {
    peer_pledge: process.env.COLLECTION_MODE_PLEDGE_ENABLED !== "false",
    catoco_psp: process.env.COLLECTION_MODE_PSP_ENABLED === "true",
    vendor_direct: process.env.COLLECTION_MODE_VENDOR_ENABLED === "true",
  };
}

export function collectionModeEnabled(mode: CollectionMode): boolean {
  return enabledCollectionModes()[mode];
}
