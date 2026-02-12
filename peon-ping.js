// peon-ping OpenCode plugin
// Maps OpenCode events to peon.sh hook events so the same bash/python
// pipeline drives sound playback for both Claude Code and OpenCode.

import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const PEON_DIR = join(homedir(), ".config", "opencode", "plugins", "peon-ping");
const PEON_SH = join(PEON_DIR, "peon.sh");

/**
 * Spawn peon.sh with a JSON payload on stdin, just like Claude Code hooks do.
 * The CLAUDE_PEON_DIR env var tells peon.sh where to find config/packs/state.
 */
function firePeon(payload) {
  const child = spawn("bash", [PEON_SH], {
    env: { ...process.env, CLAUDE_PEON_DIR: PEON_DIR },
    stdio: ["pipe", "ignore", "ignore"],
    detached: true,
  });
  child.stdin.write(JSON.stringify(payload));
  child.stdin.end();
  child.unref();
  child.on("error", () => {});
}

export const PeonPingPlugin = async ({ directory }) => {
  // Track sessions we've already greeted so we only fire SessionStart once
  const greetedSessions = new Set();
  // Track status transitions for detecting prompt submit / task complete
  let lastStatus = "";

  return {
    event: async ({ event }) => {
      const cwd = directory || "";

      if (event.type === "session.created") {
        const sid = event.properties?.id || "";
        if (!greetedSessions.has(sid)) {
          greetedSessions.add(sid);
          firePeon({
            hook_event_name: "SessionStart",
            session_id: sid,
            cwd,
          });
        }
      }

      // session.status tracks the session lifecycle
      if (event.type === "session.status") {
        const status = event.properties?.status || "";
        const sid = event.properties?.sessionID || "";

        // "running" means user just submitted a prompt
        if (status === "running" && lastStatus !== "running") {
          firePeon({
            hook_event_name: "UserPromptSubmit",
            session_id: sid,
            cwd,
          });
        }

        // "idle" after running means task completed
        if (status === "idle" && lastStatus === "running") {
          firePeon({
            hook_event_name: "Stop",
            session_id: sid,
            cwd,
          });
        }

        lastStatus = status;
      }

      // session.idle fires when session becomes idle (backup for Stop)
      if (event.type === "session.idle") {
        const sid = event.properties?.sessionID || event.properties?.id || "";
        // Only fire if we didn't already catch it via status transition
        if (lastStatus !== "idle") {
          firePeon({
            hook_event_name: "Stop",
            session_id: sid,
            cwd,
          });
          lastStatus = "idle";
        }
      }

      if (event.type === "permission.asked") {
        const sid = event.properties?.sessionID || "";
        firePeon({
          hook_event_name: "PermissionRequest",
          session_id: sid,
          cwd,
        });
      }

      if (event.type === "session.error") {
        const sid = event.properties?.sessionID || event.properties?.id || "";
        firePeon({
          hook_event_name: "Stop",
          session_id: sid,
          cwd,
        });
      }
    },
  };
};
