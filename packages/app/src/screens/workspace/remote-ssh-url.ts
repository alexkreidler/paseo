export type RemoteSshEditor = "vscode" | "cursor";

interface BuildRemoteSshUrlInput {
  editor: RemoteSshEditor;
  sshHost: string;
  sshUser?: string | null;
  path: string;
}

function encodePosixPath(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment.length === 0 ? "" : encodeURIComponent(segment)))
    .join("/");
}

/**
 * Builds a Remote-SSH deep link for VS Code or Cursor.
 *
 * Format: <scheme>://vscode-remote/ssh-remote+<authority><path>
 * Cursor uses the same `vscode-remote` authority as VS Code; only the scheme differs.
 */
export function buildRemoteSshUrl(input: BuildRemoteSshUrlInput): string | null {
  const sshHost = input.sshHost.trim();
  const path = input.path.trim();
  if (!sshHost || !path.startsWith("/")) {
    return null;
  }
  const sshUser = input.sshUser?.trim() ?? "";
  const authority = sshUser.length > 0 ? `${sshUser}@${sshHost}` : sshHost;
  const encodedAuthority = encodeURIComponent(authority);
  const encodedPath = encodePosixPath(path);
  const scheme = input.editor === "cursor" ? "cursor" : "vscode";
  return `${scheme}://vscode-remote/ssh-remote+${encodedAuthority}${encodedPath}`;
}
