import { describe, expect, it } from "vitest";
import {
  formatSshTarget,
  reduceConnection,
  validateRemoteDir,
  validateSshHostInput,
} from "./connect";
import type { SshConnectionState, SshHostInput, SshProbeResult } from "./types";

function probe(over: Partial<SshProbeResult>): SshProbeResult {
  return {
    ok: false,
    kind: "failed",
    message: "boom",
    home: null,
    ...over,
  };
}

function hostInput(over: Partial<SshHostInput> = {}): SshHostInput {
  return {
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

describe("reduceConnection", () => {
  const idle: SshConnectionState = { status: "idle" };

  it("moves from idle through probing to connected", () => {
    const probing = reduceConnection(idle, {
      type: "probe-started",
      hostId: "h1",
    });
    expect(probing).toEqual({ status: "probing", hostId: "h1" });
    const connected = reduceConnection(probing, {
      type: "probe-result",
      hostId: "h1",
      result: probe({ ok: true, kind: "ok", home: "/home/me" }),
    });
    expect(connected).toEqual({
      status: "connected",
      hostId: "h1",
      home: "/home/me",
    });
  });

  it("maps every probe failure kind onto a connection status", () => {
    const cases = [
      "auth-needed",
      "host-key-untrusted",
      "unreachable",
      "missing-binary",
      "failed",
    ] as const;
    for (const kind of cases) {
      const state = reduceConnection(
        { status: "probing", hostId: "h1" },
        {
          type: "probe-result",
          hostId: "h1",
          result: probe({ kind, message: kind }),
        },
      );
      expect(state).toEqual({ status: kind, hostId: "h1", message: kind });
    }
  });

  it("treats an unknown probe kind as failed", () => {
    const state = reduceConnection(
      { status: "probing", hostId: "h1" },
      {
        type: "probe-result",
        hostId: "h1",
        result: probe({ kind: "wat" as never }),
      },
    );
    expect(state.status).toBe("failed");
  });

  it("ignores a stale result for another host while probing", () => {
    const probing: SshConnectionState = { status: "probing", hostId: "h1" };
    expect(
      reduceConnection(probing, {
        type: "probe-result",
        hostId: "h2",
        result: probe({ ok: true, kind: "ok" }),
      }),
    ).toBe(probing);
  });

  it("resets to idle", () => {
    expect(
      reduceConnection(
        { status: "connected", hostId: "h1", home: null },
        {
          type: "reset",
        },
      ),
    ).toEqual({ status: "idle" });
  });
});

describe("formatSshTarget", () => {
  it("prefixes the user when present", () => {
    expect(
      formatSshTarget({ host: "example.com", user: "me", port: null }),
    ).toBe("me@example.com");
    expect(
      formatSshTarget({ host: "example.com", user: null, port: null }),
    ).toBe("example.com");
  });

  it("adds a port only when it differs from the default", () => {
    expect(formatSshTarget({ host: "example.com", user: null, port: 22 })).toBe(
      "example.com",
    );
    expect(
      formatSshTarget({ host: "example.com", user: null, port: 2222 }),
    ).toBe("example.com:2222");
    expect(
      formatSshTarget({ host: "example.com", user: "me", port: 2222 }),
    ).toBe("me@example.com:2222");
  });
});

describe("validateRemoteDir", () => {
  it("accepts absolute POSIX paths", () => {
    expect(validateRemoteDir("/")).toBeNull();
    expect(validateRemoteDir("/home/me/project")).toBeNull();
    expect(validateRemoteDir("/srv/app/../app2")).toBeNull();
  });

  it("rejects empty, relative and control-character paths", () => {
    expect(validateRemoteDir("")).not.toBeNull();
    expect(validateRemoteDir("   ")).not.toBeNull();
    expect(validateRemoteDir("home/me")).not.toBeNull();
    expect(validateRemoteDir("~/project")).not.toBeNull();
    expect(validateRemoteDir("/home/me\nproject")).not.toBeNull();
  });

  it("rejects .. segments that climb above the root", () => {
    expect(validateRemoteDir("/..")).not.toBeNull();
    expect(validateRemoteDir("/home/../../etc")).not.toBeNull();
  });
});

describe("validateSshHostInput", () => {
  it("accepts a minimal valid host", () => {
    expect(validateSshHostInput(hostInput())).toEqual({});
  });

  it("requires a display name and a host", () => {
    expect(validateSshHostInput(hostInput({ label: " " })).label).toBeDefined();
    expect(validateSshHostInput(hostInput({ host: " " })).host).toBeDefined();
  });

  it("rejects a host with spaces or a leading dash", () => {
    expect(
      validateSshHostInput(hostInput({ host: "my server" })).host,
    ).toBeDefined();
    expect(
      validateSshHostInput(hostInput({ host: "-oProxyCommand" })).host,
    ).toBeDefined();
  });

  it("keeps the user out of the host and accepts bracketed IPv6", () => {
    expect(
      validateSshHostInput(hostInput({ host: "me@example.com" })).host,
    ).toBeDefined();
    expect(
      validateSshHostInput(hostInput({ host: "bad_host!$" })).host,
    ).toBeDefined();
    expect(
      validateSshHostInput(hostInput({ host: "[2001:db8::1]" })).host,
    ).toBeUndefined();
    expect(
      validateSshHostInput(hostInput({ host: "ssh-config-alias" })).host,
    ).toBeUndefined();
  });

  it("validates the optional user field", () => {
    expect(
      validateSshHostInput(hostInput({ user: "-root" })).user,
    ).toBeDefined();
    expect(
      validateSshHostInput(hostInput({ user: "bad user" })).user,
    ).toBeDefined();
    expect(
      validateSshHostInput(hostInput({ user: "deploy.user_1" })).user,
    ).toBeUndefined();
  });

  it("bounds the port range", () => {
    for (const port of [0, 70000, 3.5]) {
      expect(validateSshHostInput(hostInput({ port })).port).toBeDefined();
    }
    expect(
      validateSshHostInput(hostInput({ port: 2222 })).port,
    ).toBeUndefined();
  });

  it("validates optional fields", () => {
    expect(
      validateSshHostInput(hostInput({ identityFile: "id_ed25519" }))
        .identityFile,
    ).toBeDefined();
    expect(
      validateSshHostInput(
        hostInput({ identityFile: "/home/me/.ssh/id_ed25519" }),
      ).identityFile,
    ).toBeUndefined();
    expect(
      validateSshHostInput(hostInput({ identityFile: "~/.ssh/id_ed25519" }))
        .identityFile,
    ).toBeUndefined();
    expect(
      validateSshHostInput(hostInput({ defaultDir: "relative" })).defaultDir,
    ).toBeDefined();
    expect(
      validateSshHostInput(hostInput({ remoteShell: "bash" })).remoteShell,
    ).toBeDefined();
    expect(
      validateSshHostInput(hostInput({ remoteShell: "/bin/bash" })).remoteShell,
    ).toBeUndefined();
  });

  it("treats empty optional strings as absent", () => {
    expect(
      validateSshHostInput(
        hostInput({
          identityFile: "",
          defaultDir: " ",
          remoteShell: "",
        }),
      ),
    ).toEqual({});
  });
});
