import { t } from "@/i18n";
import type {
  SshConnectionEvent,
  SshConnectionState,
  SshHost,
  SshHostInput,
  SshProbeResult,
} from "./types";

export const DEFAULT_SSH_PORT = 22;

/**
 * Pure connection state machine for the status pill. `probe-result` for a
 * host other than the one being probed is ignored, so a slow response from a
 * previous target cannot overwrite the current state.
 */
export function reduceConnection(
  state: SshConnectionState,
  event: SshConnectionEvent,
): SshConnectionState {
  switch (event.type) {
    case "probe-started":
      return { status: "probing", hostId: event.hostId };
    case "probe-result": {
      if (state.status === "probing" && state.hostId !== event.hostId) {
        return state;
      }
      return connectionFromProbe(event.hostId, event.result);
    }
    case "reset":
      return { status: "idle" };
    default:
      return state;
  }
}

function connectionFromProbe(
  hostId: string,
  result: SshProbeResult,
): SshConnectionState {
  switch (result.kind) {
    case "ok":
      return { status: "connected", hostId, home: result.home };
    case "auth-needed":
      return { status: "auth-needed", hostId, message: result.message };
    case "host-key-untrusted":
      return {
        status: "host-key-untrusted",
        hostId,
        message: result.message,
      };
    case "unreachable":
      return { status: "unreachable", hostId, message: result.message };
    case "missing-binary":
      return { status: "missing-binary", hostId, message: result.message };
    default:
      return { status: "failed", hostId, message: result.message };
  }
}

/** `user@host`, with `:port` only when the port is set and not the default. */
export function formatSshTarget(
  host: Pick<SshHost, "host" | "user" | "port">,
): string {
  const target = host.user ? `${host.user}@${host.host}` : host.host;
  return host.port !== null && host.port !== DEFAULT_SSH_PORT
    ? `${target}:${host.port}`
    : target;
}

const ABSOLUTE_POSIX = /^\//;

function hasControlChars(value: string): boolean {
  return /[\0\n\r]/.test(value);
}

/**
 * Validates a remote POSIX directory: absolute, no NUL/newline and no `..`
 * segment that climbs above the filesystem root.
 */
export function validateRemoteDir(path: string): string | null {
  const value = path.trim();
  if (!value) return t("Remote folder is required.");
  if (hasControlChars(value)) {
    return t("Remote folder cannot contain line breaks.");
  }
  if (!ABSOLUTE_POSIX.test(value)) {
    return t(
      "Remote folder must be an absolute path such as /home/me/project.",
    );
  }
  let depth = 1;
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth -= 1;
      if (depth < 1)
        return t("Remote folder cannot escape the root directory.");
      continue;
    }
    depth += 1;
  }
  return null;
}

const HOST_CHARS = /^[A-Za-z0-9._:-]+$/;
const USER_CHARS = /^[A-Za-z0-9._-]+$/;

function validateIdentityFile(path: string): string | null {
  if (hasControlChars(path))
    return t("Identity file cannot contain line breaks.");
  if (!ABSOLUTE_POSIX.test(path) && !path.startsWith("~/")) {
    return t("Identity file must be an absolute path or start with ~/.");
  }
  return null;
}

function validateRemoteShell(shell: string): string | null {
  if (hasControlChars(shell)) {
    return t("Remote shell cannot contain line breaks.");
  }
  if (!ABSOLUTE_POSIX.test(shell)) {
    return t("Remote shell must be an absolute path.");
  }
  return null;
}

export type SshHostField =
  | "label"
  | "host"
  | "port"
  | "user"
  | "identityFile"
  | "defaultDir"
  | "remoteShell";

export type SshHostFieldErrors = Partial<Record<SshHostField, string>>;

/** Field-level validation for the add/edit form. Empty optional fields pass. */
export function validateSshHostInput(input: SshHostInput): SshHostFieldErrors {
  const errors: SshHostFieldErrors = {};

  const label = input.label.trim();
  if (!label) errors.label = t("Display name is required.");
  else if (label.length > 80) errors.label = t("Display name is too long.");

  const host = input.host.trim();
  const bracketed = host.startsWith("[") && host.endsWith("]");
  const hostBody = bracketed ? host.slice(1, -1) : host;
  if (!host) errors.host = t("Host is required.");
  else if (host.length > 255) errors.host = t("Host is too long.");
  else if (host.includes("@")) {
    errors.host = t("Put the user in the user field, not in the host.");
  } else if (hasControlChars(host) || /\s/.test(host)) {
    errors.host = t("Host cannot contain spaces or line breaks.");
  } else if (host.startsWith("-")) {
    errors.host = t("Host cannot start with a dash.");
  } else if (!hostBody) {
    errors.host = t("Host is required.");
  } else if (!HOST_CHARS.test(hostBody)) {
    errors.host = t("Host contains characters that are not valid in a target.");
  }

  if (input.port !== null) {
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      errors.port = t("Port must be a whole number between 1 and 65535.");
    }
  }

  const user = input.user?.trim();
  if (user) {
    if (user.startsWith("-")) {
      errors.user = t("User name cannot start with a dash.");
    } else if (!USER_CHARS.test(user)) {
      errors.user = t(
        "User names may only contain letters, numbers, dots, dashes and underscores.",
      );
    }
  }

  if (input.identityFile?.trim()) {
    const error = validateIdentityFile(input.identityFile.trim());
    if (error) errors.identityFile = error;
  }

  if (input.defaultDir?.trim()) {
    const error = validateRemoteDir(input.defaultDir);
    if (error) errors.defaultDir = error;
  }

  if (input.remoteShell?.trim()) {
    const error = validateRemoteShell(input.remoteShell.trim());
    if (error) errors.remoteShell = error;
  }

  return errors;
}

export function hasFieldErrors(errors: SshHostFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
