/**
 * Agent permission modes.
 *
 * Three product-level modes control whether a mutating tool call pauses for
 * an in-UI confirmation card:
 *
 *  - `manual`    — every mutating tool call asks. This is the historical
 *                  behavior and stays available as an opt-in.
 *  - `assisted`  — a local, deterministic risk classifier runs before the
 *                  call; low-risk calls execute immediately, everything else
 *                  asks. This is the default (and the "Recommended" choice).
 *  - `allow-all` — no confirmation card at all. `lib/security.ts` hard blocks
 *                  and plan-mode queuing still apply.
 *
 * The mode is chosen per session in the composer, defaulted from the
 * `agentPermissionMode` preference. Session choices are intentionally not
 * persisted: a restart falls back to the default so `allow-all` cannot stick
 * across runs by accident.
 */

export type PermissionMode = "manual" | "assisted" | "allow-all";

export const PERMISSION_MODES: readonly PermissionMode[] = [
  "manual",
  "assisted",
  "allow-all",
] as const;

export const DEFAULT_PERMISSION_MODE: PermissionMode = "assisted";

export function normalizePermissionMode(value: unknown): PermissionMode {
  return value === "manual" || value === "assisted" || value === "allow-all"
    ? value
    : DEFAULT_PERMISSION_MODE;
}
