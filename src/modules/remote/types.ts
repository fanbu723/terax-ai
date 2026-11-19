/** Mirrors `src-tauri` `workspace::SshHost` (serde camelCase). */
export type SshHost = {
  id: string;
  label: string;
  host: string;
  port: number | null;
  user: string | null;
  identityFile: string | null;
  defaultDir: string | null;
  remoteShell: string | null;
};

export type SshHostInput = Omit<SshHost, "id">;

export type SshProbeKind =
  | "ok"
  | "auth-needed"
  | "host-key-untrusted"
  | "unreachable"
  | "missing-binary"
  | "failed";

export type SshProbeResult = {
  ok: boolean;
  kind: SshProbeKind;
  message: string;
  home: string | null;
};

/** Connection state for the status pill; `idle` means nothing was probed yet. */
export type SshConnectionState =
  | { status: "idle" }
  | { status: "probing"; hostId: string }
  | { status: "connected"; hostId: string; home: string | null }
  | { status: "auth-needed"; hostId: string; message: string }
  | { status: "host-key-untrusted"; hostId: string; message: string }
  | { status: "unreachable"; hostId: string; message: string }
  | { status: "missing-binary"; hostId: string; message: string }
  | { status: "failed"; hostId: string; message: string };

export type SshConnectionStatus = SshConnectionState["status"];

export type SshConnectionEvent =
  | { type: "probe-started"; hostId: string }
  | { type: "probe-result"; hostId: string; result: SshProbeResult }
  | { type: "reset" };

/** Which remote surface a launcher shortcut should open. */
export type RemoteDialogKind = "hosts" | "connect" | "space";
