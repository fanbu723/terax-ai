import { describe, expect, it, vi } from "vitest";
import {
  currentWorkspaceScopeKey,
  isRemoteEnv,
  LOCAL_WORKSPACE,
  parseWorkspaceScopeKey,
  sshHome,
  useWorkspaceEnvStore,
  workspaceFallbackRoot,
  workspaceScopeKey,
  type WorkspaceEnv,
} from "./env";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => "/home/me"),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const wsl: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
const ssh: WorkspaceEnv = { kind: "ssh", hostId: "host-1" };

describe("workspaceScopeKey", () => {
  it("maps every environment kind to its stable key", () => {
    expect(workspaceScopeKey(LOCAL_WORKSPACE)).toBe("local");
    expect(workspaceScopeKey(wsl)).toBe("wsl:Ubuntu");
    expect(workspaceScopeKey(ssh)).toBe("ssh:host-1");
  });

  it("round-trips local, WSL and SSH keys", () => {
    for (const env of [LOCAL_WORKSPACE, wsl, ssh]) {
      expect(parseWorkspaceScopeKey(workspaceScopeKey(env))).toEqual(env);
    }
  });

  it("treats legacy and unknown keys as local", () => {
    for (const key of ["", "local", "windows", "wsl:", "ssh:", "unknown:x"]) {
      expect(parseWorkspaceScopeKey(key)).toEqual(LOCAL_WORKSPACE);
    }
  });
});

describe("isRemoteEnv", () => {
  it("is true only for SSH; WSL stays a local-process environment", () => {
    expect(isRemoteEnv(LOCAL_WORKSPACE)).toBe(false);
    expect(isRemoteEnv(wsl)).toBe(false);
    expect(isRemoteEnv(ssh)).toBe(true);
  });
});

describe("useWorkspaceEnvStore", () => {
  it("sets an SSH env without touching WSL preferences", () => {
    useWorkspaceEnvStore.getState().setEnv(ssh);
    expect(useWorkspaceEnvStore.getState().env).toEqual(ssh);
    expect(currentWorkspaceScopeKey()).toBe("ssh:host-1");
    useWorkspaceEnvStore.getState().setEnv(LOCAL_WORKSPACE);
  });
});

describe("sshHome", () => {
  it("calls ssh_home with the Rust `id` argument", async () => {
    mocks.invoke.mockClear();
    mocks.invoke.mockResolvedValueOnce("/home/me");
    await expect(sshHome("host-1")).resolves.toBe("/home/me");
    expect(mocks.invoke).toHaveBeenCalledWith("ssh_home", { id: "host-1" });
  });
});

describe("workspaceFallbackRoot", () => {
  it("keeps the launch directory for local and WSL workspaces", () => {
    expect(
      workspaceFallbackRoot(LOCAL_WORKSPACE, "/work/app", "/home/me"),
    ).toBe("/work/app");
    expect(workspaceFallbackRoot(wsl, "/work/app", "/home/me")).toBe(
      "/work/app",
    );
    expect(workspaceFallbackRoot(LOCAL_WORKSPACE, null, "/home/me")).toBe(
      "/home/me",
    );
  });

  it("never leaks the local launch directory into an SSH workspace", () => {
    // Observed bug: launching from a project directory rooted the remote
    // explorer at /home/me/project/app, which the transport rejected as an
    // unauthorized remote path.
    expect(workspaceFallbackRoot(ssh, "/home/me/project/app", "/home/me")).toBe(
      "/home/me",
    );
    expect(workspaceFallbackRoot(ssh, "/home/me/project/app", null)).toBe(null);
  });
});
