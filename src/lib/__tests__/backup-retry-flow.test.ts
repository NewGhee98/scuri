import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSyncQueue } from "../sync-queue";

const source = readFileSync(new URL("../../components/layouts-app.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("layouts-app.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = "";
let resumeHandler = "";
function collect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "retryPhotoBackup") handler = node.initializer!.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "watchBackupResume") resumeHandler = node.arguments[0].getText(ast);
  ts.forEachChild(node, collect);
}
collect(ast);
const compiled = ts.transpileModule(`const retry = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness() {
  let feedback: Record<string, string> = {};
  const scope = {
    workspaceRef: { current: { capture: () => () => true } }, projectId: "project",
    setBackupFeedback: (update: (value: typeof feedback) => typeof feedback) => { feedback = update(feedback); },
    templateUserRef: { current: { id: "owner" } as { id: string } | null }, isProjectCloudConfigured: () => true,
    setIsOnline: vi.fn(), navigator: { onLine: true }, photoBackupStatus: {},
    getValidDriveToken: vi.fn((): string | null => "fresh-token"), connectGoogleDrive: vi.fn(),
    persistActiveProject: () => [{ id: "project", updatedAt: "v1" }],
    backupQueueRef: { current: null as ProjectSyncQueue | null },
    syncQueueRef: { current: { setEnabled: vi.fn(), enqueue: vi.fn() } },
  };
  const retry = new Function("scope", `with (scope) { ${compiled}; return retry; }`)(scope) as () => Promise<void>;
  return { scope, retry, feedback: () => feedback.project };
}

afterEach(() => vi.useRealTimers());
describe("real Retry backup action", () => {
  it("automatically resumes the pending project on return, or explains that expired Drive access must reconnect", async () => {
    vi.useFakeTimers(); const h = harness();
    const push = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(true);
    const queue = new ProjectSyncQueue(push, 0); h.scope.backupQueueRef.current = queue;
    queue.setEnabled(true); queue.enqueue("project", "v1"); await vi.advanceTimersByTimeAsync(0);
    const scope = { ...h.scope, activeProjectRef: { current: { id: "project", updatedAt: "latest" } },
      projectsRef: { current: [] }, isProjectDirty: () => true, projectHasUnbackedAssets: () => true, setDriveExpiry: vi.fn() };
    const js = ts.transpileModule(`const resume = ${resumeHandler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const resume = new Function("scope", `with (scope) { ${js}; return resume; }`)(scope) as () => void;
    resume(); await vi.advanceTimersByTimeAsync(1);
    expect(push).toHaveBeenCalledTimes(2); expect(push.mock.calls[0][1].signal.aborted).toBe(true);
    expect(h.feedback()).toContain("Resuming backup");
    h.scope.getValidDriveToken.mockReturnValue(null); resume(); await vi.advanceTimersByTimeAsync(1);
    expect(scope.setDriveExpiry).toHaveBeenCalledWith(0); expect(push).toHaveBeenCalledTimes(2);
    expect(h.feedback()).toContain("Reconnect Google Drive");
    queue.stop();
  });
  it("restarts the actual queue and visibly acknowledges the click", async () => {
    vi.useFakeTimers(); const h = harness();
    const push = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(true);
    const queue = new ProjectSyncQueue(push, 0); h.scope.backupQueueRef.current = queue;
    queue.setEnabled(true); queue.enqueue("older-project", "v1"); await vi.advanceTimersByTimeAsync(0);
    await h.retry(); await vi.advanceTimersByTimeAsync(1);
    expect(h.feedback()).toContain("Restarting backup");
    expect(push.mock.calls.map(([id]) => id)).toEqual(["older-project", "project"]);
    expect(h.scope.connectGoogleDrive).not.toHaveBeenCalled();
    queue.stop();
  });

  it("uses actual token validity after reopening and reconnects rejected access", async () => {
    const h = harness(); h.scope.getValidDriveToken.mockReturnValue(null);
    await h.retry(); expect(h.scope.connectGoogleDrive).toHaveBeenCalledOnce();
    h.scope.getValidDriveToken.mockReturnValue("unexpired-but-revoked");
    h.scope.photoBackupStatus = { "project:photo": { needsReconnect: true } };
    await h.retry(); expect(h.scope.connectGoogleDrive).toHaveBeenCalledTimes(2);
  });

  it("explains signed-out, offline, and unavailable-worker conditions inside the activity panel", async () => {
    const h = harness(); h.scope.templateUserRef.current = null;
    await h.retry(); expect(h.feedback()).toContain("Sign in by email");
    h.scope.templateUserRef.current = { id: "owner" }; h.scope.navigator.onLine = false;
    await h.retry(); expect(h.feedback()).toContain("offline");
    h.scope.navigator.onLine = true;
    await h.retry(); expect(h.feedback()).toContain("starting up");
    expect(h.scope.connectGoogleDrive).not.toHaveBeenCalled();
  });
});
