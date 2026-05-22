import { describe, expect, it } from "vitest";
import { buildRemoteSshUrl } from "./remote-ssh-url";

describe("buildRemoteSshUrl", () => {
  it("builds a vscode remote-ssh url with host and path", () => {
    expect(
      buildRemoteSshUrl({ editor: "vscode", sshHost: "my-devbox", path: "/home/dev/app" }),
    ).toBe("vscode://vscode-remote/ssh-remote+my-devbox/home/dev/app");
  });

  it("builds a cursor remote-ssh url using the cursor scheme", () => {
    expect(buildRemoteSshUrl({ editor: "cursor", sshHost: "my-devbox", path: "/srv/code" })).toBe(
      "cursor://vscode-remote/ssh-remote+my-devbox/srv/code",
    );
  });

  it("includes user@host when sshUser is provided", () => {
    expect(
      buildRemoteSshUrl({
        editor: "vscode",
        sshHost: "10.0.0.5",
        sshUser: "dev",
        path: "/workspace",
      }),
    ).toBe("vscode://vscode-remote/ssh-remote+dev%4010.0.0.5/workspace");
  });

  it("encodes path segments with spaces and unicode", () => {
    expect(
      buildRemoteSshUrl({ editor: "vscode", sshHost: "h", path: "/home/dev/My Project" }),
    ).toBe("vscode://vscode-remote/ssh-remote+h/home/dev/My%20Project");
  });

  it("returns null when sshHost is blank", () => {
    expect(buildRemoteSshUrl({ editor: "vscode", sshHost: "  ", path: "/x" })).toBeNull();
  });

  it("returns null when path is not absolute", () => {
    expect(buildRemoteSshUrl({ editor: "vscode", sshHost: "h", path: "relative/path" })).toBeNull();
  });

  it("ignores blank sshUser", () => {
    expect(buildRemoteSshUrl({ editor: "vscode", sshHost: "h", sshUser: "  ", path: "/p" })).toBe(
      "vscode://vscode-remote/ssh-remote+h/p",
    );
  });
});
