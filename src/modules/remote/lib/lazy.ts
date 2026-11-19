import type { RemoteDialogKind } from "../types";

/**
 * Dynamic-import boundaries for the remote dialogs. `RemoteDialogHost` calls
 * these through `React.lazy`, and the command palette / launcher functions
 * below preload the chunk before flipping the eager dialog store.
 */
export const loadHostManager = () =>
  import("../components/SshHostManager").then((m) => ({
    default: m.SshHostManager,
  }));

export const loadRemoteSpaceDialog = () =>
  import("../components/RemoteSpaceDialog").then((m) => ({
    default: m.RemoteSpaceDialog,
  }));

export const loadSshHostDialog = () =>
  import("../components/SshHostDialog").then((m) => ({
    default: m.SshHostDialog,
  }));

async function show(kind: RemoteDialogKind): Promise<void> {
  const { useRemoteDialogStore } = await import("./dialogStore");
  useRemoteDialogStore.getState().open(kind);
}

/** "Remote: Connect to Host..." and the pill's manage action share this. */
export async function openRemoteHostManager(
  mode: "manage" | "connect" = "manage",
): Promise<void> {
  await loadHostManager();
  await show(mode === "connect" ? "connect" : "hosts");
}

export async function openRemoteSpaceDialog(
  hostId?: string | null,
): Promise<void> {
  await loadRemoteSpaceDialog();
  const { useRemoteDialogStore } = await import("./dialogStore");
  useRemoteDialogStore.getState().open("space", { hostId: hostId ?? null });
}

/** "Remote: Connect to Host..." preselects a host in the space dialog. */
export async function openRemoteConnectDialog(
  hostId?: string | null,
): Promise<void> {
  await openRemoteSpaceDialog(hostId);
}
