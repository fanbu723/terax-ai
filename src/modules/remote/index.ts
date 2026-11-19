// Remote SSH. The barrel stays eager-safe: dialogs are reached only through
// the dynamic imports in `lib/lazy.ts`, never from this module.
export { RemoteDialogHost } from "./components/RemoteDialogHost";
export { RemoteStatusPill } from "./components/RemoteStatusPill";
export {
  DEFAULT_SSH_PORT,
  formatSshTarget,
  hasFieldErrors,
  reduceConnection,
  validateRemoteDir,
  validateSshHostInput,
  type SshHostField,
  type SshHostFieldErrors,
} from "./connect";
export {
  describeProbe,
  normalizeSshHostInput,
  probeSucceeded,
  useSshHosts,
} from "./hosts";
export { authorizeRemoteRoot } from "./lib/authorize";
export {
  openRemoteConnectDialog,
  openRemoteHostManager,
  openRemoteSpaceDialog,
} from "./lib/lazy";
export { useRemoteUi } from "./lib/useRemoteUi";
export type {
  RemoteDialogKind,
  SshConnectionEvent,
  SshConnectionState,
  SshConnectionStatus,
  SshHost,
  SshHostInput,
  SshProbeKind,
  SshProbeResult,
} from "./types";
