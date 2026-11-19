import { Suspense, lazy } from "react";
import { useRemoteDialogStore } from "../lib/dialogStore";
import { loadHostManager, loadRemoteSpaceDialog } from "../lib/lazy";

const HostManager = lazy(loadHostManager);
const SpaceDialog = lazy(loadRemoteSpaceDialog);

/**
 * Mounted once by the app shell. Renders nothing until a remote action asks for
 * a dialog, at which point the lazy chunk loads.
 */
export function RemoteDialogHost() {
  const dialog = useRemoteDialogStore((s) => s.dialog);
  const hostId = useRemoteDialogStore((s) => s.hostId);
  const managerMode = useRemoteDialogStore((s) => s.managerMode);
  const close = useRemoteDialogStore((s) => s.close);

  if (!dialog) return null;

  const handleOpenChange = (open: boolean) => {
    if (!open) close();
  };

  return (
    <Suspense fallback={null}>
      {dialog === "space" ? (
        <SpaceDialog
          open
          initialHostId={hostId}
          onOpenChange={handleOpenChange}
        />
      ) : (
        <HostManager
          open
          mode={managerMode}
          initialHostId={hostId}
          onOpenChange={handleOpenChange}
        />
      )}
    </Suspense>
  );
}
