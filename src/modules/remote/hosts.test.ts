import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SshHost } from "./types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { describeProbe, normalizeSshHostInput, useSshHosts } from "./hosts";

function host(id = "h1", over: Partial<SshHost> = {}): SshHost {
  return {
    id,
    label: "Work",
    host: "example.com",
    port: null,
    user: null,
    identityFile: null,
    defaultDir: null,
    remoteShell: null,
    ...over,
  };
}

const input = {
  label: " Work ",
  host: " example.com ",
  port: 2222,
  user: " me ",
  identityFile: "",
  defaultDir: "/home/me",
  remoteShell: null,
};

beforeEach(() => {
  mocks.invoke.mockReset();
  useSshHosts.setState({
    hosts: [],
    hydrated: false,
    backendAvailable: true,
    loading: false,
    error: null,
  });
});

describe("useSshHosts", () => {
  it("hydrates from the backend", async () => {
    mocks.invoke.mockResolvedValue([host()]);
    await useSshHosts.getState().hydrate();
    expect(mocks.invoke).toHaveBeenCalledWith("ssh_hosts_list");
    expect(useSshHosts.getState().hosts).toEqual([host()]);
    expect(useSshHosts.getState().hydrated).toBe(true);
    expect(useSshHosts.getState().backendAvailable).toBe(true);
  });

  it("hydrates only once unless forced", async () => {
    mocks.invoke.mockResolvedValue([host()]);
    await useSshHosts.getState().hydrate();
    await useSshHosts.getState().hydrate();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await useSshHosts.getState().hydrate(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("tolerates a missing backend instead of throwing", async () => {
    mocks.invoke.mockRejectedValue(
      new Error("command ssh_hosts_list not found"),
    );
    await expect(useSshHosts.getState().hydrate()).resolves.toBeUndefined();
    const state = useSshHosts.getState();
    expect(state.hosts).toEqual([]);
    expect(state.hydrated).toBe(true);
    expect(state.backendAvailable).toBe(false);
    expect(state.error).toContain("not found");
  });

  it("fills optional fields the backend omits for None", async () => {
    mocks.invoke.mockResolvedValue([
      { id: "h1", label: "Bare", host: "example.com" },
    ]);
    await useSshHosts.getState().hydrate();
    expect(useSshHosts.getState().hosts).toEqual([
      host("h1", { label: "Bare" }),
    ]);
  });

  it("adds a host with normalized optional fields", async () => {
    mocks.invoke.mockResolvedValue(host("h2"));
    const saved = await useSshHosts.getState().add(input);
    expect(mocks.invoke).toHaveBeenCalledWith("ssh_host_add", {
      host: {
        label: "Work",
        host: "example.com",
        port: 2222,
        user: "me",
        identityFile: null,
        defaultDir: "/home/me",
        remoteShell: null,
      },
    });
    expect(saved).toEqual(host("h2"));
    expect(useSshHosts.getState().hosts).toEqual([host("h2")]);
  });

  it("returns null and records the error when an add fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("disk full"));
    expect(await useSshHosts.getState().add(input)).toBeNull();
    expect(useSshHosts.getState().error).toContain("disk full");
  });

  it("replaces the matching host on update", async () => {
    useSshHosts.setState({ hosts: [host("h1"), host("h2")] });
    const updated = host("h2", { label: "Renamed" });
    mocks.invoke.mockResolvedValue(updated);
    expect(await useSshHosts.getState().update(updated)).toEqual(updated);
    expect(useSshHosts.getState().hosts.map((h) => h.label)).toEqual([
      "Work",
      "Renamed",
    ]);
  });

  it("removes a host", async () => {
    useSshHosts.setState({ hosts: [host("h1"), host("h2")] });
    mocks.invoke.mockResolvedValue(undefined);
    expect(await useSshHosts.getState().remove("h1")).toBe(true);
    expect(useSshHosts.getState().hosts.map((h) => h.id)).toEqual(["h2"]);
  });

  it("probes a host and degrades a missing backend to failed", async () => {
    mocks.invoke.mockResolvedValueOnce({
      ok: true,
      kind: "ok",
      message: "",
      home: "/home/me",
    });
    expect(await useSshHosts.getState().probe("h1")).toEqual({
      ok: true,
      kind: "ok",
      message: "",
      home: "/home/me",
    });
    mocks.invoke.mockRejectedValueOnce(
      new Error("command ssh_probe not found"),
    );
    const failed = await useSshHosts.getState().probe("h1");
    expect(failed.ok).toBe(false);
    expect(failed.kind).toBe("failed");
    expect(failed.message).toContain("not found");
  });

  it("finds a host by id", () => {
    useSshHosts.setState({ hosts: [host("h1")] });
    expect(useSshHosts.getState().get("h1")?.label).toBe("Work");
    expect(useSshHosts.getState().get("missing")).toBeUndefined();
  });
});

describe("normalizeSshHostInput", () => {
  it("trims strings and turns blanks into null", () => {
    expect(
      normalizeSshHostInput({
        label: " Work ",
        host: " example.com ",
        port: null,
        user: " ",
        identityFile: "",
        defaultDir: null,
        remoteShell: " ",
      }),
    ).toEqual({
      label: "Work",
      host: "example.com",
      port: null,
      user: null,
      identityFile: null,
      defaultDir: null,
      remoteShell: null,
    });
  });
});

describe("describeProbe", () => {
  it("guides the user to a terminal when authentication is required", () => {
    for (const kind of ["auth-needed", "host-key-untrusted"] as const) {
      expect(
        describeProbe({ ok: false, kind, message: "", home: null }),
      ).toContain("Open a terminal tab");
    }
  });

  it("reports the home directory when connected", () => {
    expect(
      describeProbe({
        ok: true,
        kind: "ok",
        message: "",
        home: "/home/me",
      }),
    ).toContain("/home/me");
  });
});
