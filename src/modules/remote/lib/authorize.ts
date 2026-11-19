import { invoke } from "@tauri-apps/api/core";

/**
 * Authorize a remote directory for read/write. The backend validates that the
 * directory exists, resolves it and records the canonical path as a root.
 * Returns the canonical remote path.
 */
export function authorizeRemoteRoot(
  hostId: string,
  path: string,
): Promise<string> {
  return invoke<string>("ssh_authorize_root", { id: hostId, path });
}
