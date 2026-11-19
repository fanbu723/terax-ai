import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { currentWorkspaceEnv } from "@/modules/workspace";

/** What a running managed `dsh web` server reports. */
export type DshWebStatus = { port: number };

/** Where the official Web GUI ended up after {@link openDshWeb}. */
export type DshWebSurface = "window" | "browser";

/** Payload of {@link DSH_WEB_EVENT}. */
export type DshWebEvent = { running: boolean; port: number | null };

/** Emitted by the Rust side when the managed server starts, stops or exits. */
export const DSH_WEB_EVENT = "terax:dsh-web-changed";

/** Current managed server, or `null` when none is running. */
export function dshWebStatus(): Promise<DshWebStatus | null> {
  return invoke<DshWebStatus | null>("dsh_web_status");
}

/**
 * Starts `dsh web` from the current workspace root and waits for the URL line.
 * Rejects with the stderr tail when the command cannot start.
 */
export function startDshWeb(opts: {
  command: string;
  cwd: string | null;
}): Promise<DshWebStatus> {
  return invoke<DshWebStatus>("dsh_web_start", {
    command: opts.command,
    cwd: opts.cwd,
    workspace: currentWorkspaceEnv(),
  });
}

/**
 * Opens the official Web GUI in a dedicated window, falling back to the system
 * browser when the window cannot be created.
 */
export function openDshWeb(): Promise<DshWebSurface> {
  return invoke<DshWebSurface>("dsh_web_open");
}

/** Stops the managed server and closes its window. */
export function stopDshWeb(): Promise<void> {
  return invoke("dsh_web_stop");
}

/** Subscribes to managed-server lifecycle events. */
export function watchDshWeb(
  listener: (event: DshWebEvent) => void,
): Promise<UnlistenFn> {
  return listen<DshWebEvent>(DSH_WEB_EVENT, (event) =>
    listener(event.payload),
  );
}
