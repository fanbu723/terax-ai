import { createElement, useEffect } from "react";
import { useSshHosts } from "../hosts";
import { RemoteDialogHost } from "../components/RemoteDialogHost";

/**
 * The only remote wiring `App.tsx` needs: the palette's host counts and an
 * element that lazily mounts the dialogs when one is requested.
 */
export function useRemoteUi() {
  const hostCount = useSshHosts((s) => s.hosts.length);
  const backendAvailable = useSshHosts((s) => s.backendAvailable);

  useEffect(() => {
    void useSshHosts.getState().hydrate();
  }, []);

  return {
    hostCount,
    backendAvailable,
    dialogHost: createElement(RemoteDialogHost),
  };
}
