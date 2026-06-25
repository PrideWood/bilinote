#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const port = Number(process.env.PORT || 3001);
const appDataDir =
  process.env.BILINOTE_DATA_DIR ||
  process.env.APP_DATA_DIR ||
  path.join(os.homedir(), "Library", "Application Support", "BiliNote AI");
const logDir = path.join(appDataDir, "logs");
const logPath = path.join(logDir, "local-service.log");

mkdirSync(logDir, { recursive: true });

if (await isHealthy(port)) {
  openApp(port);
  process.exit(0);
}

const serverPath = path.join(projectDir, "dist-server", "server.js");
if (!existsSync(serverPath)) {
  console.error("Missing dist-server/server.js. Run npm run build before starting the local app.");
  process.exit(1);
}

const logFd = openSync(logPath, "a");
const child = spawn(process.execPath, [serverPath], {
  cwd: projectDir,
  detached: true,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    BILINOTE_DATA_DIR: appDataDir
  },
  stdio: ["ignore", logFd, logFd]
});
child.unref();
closeSync(logFd);

const started = await waitForHealth(port);
if (!started) {
  console.error(`BiliNote AI did not start. Check log: ${logPath}`);
  process.exit(1);
}

openApp(port);

async function waitForHealth(targetPort) {
  for (let index = 0; index < 40; index += 1) {
    if (await isHealthy(targetPort)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function isHealthy(targetPort) {
  try {
    const response = await fetch(`http://127.0.0.1:${targetPort}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function openApp(targetPort) {
  spawn("open", [`http://127.0.0.1:${targetPort}/`], {
    detached: true,
    stdio: "ignore"
  }).unref();
}
