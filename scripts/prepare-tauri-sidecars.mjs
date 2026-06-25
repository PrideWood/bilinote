#!/usr/bin/env node
import { closeSync, copyFileSync, chmodSync, mkdirSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const sidecarDir = path.join(projectDir, "src-tauri", "sidecars");
const targetTriple = getTargetTriple();

const binaries = [
  { name: "node", env: "TAURI_NODE_BIN", fallback: process.execPath },
  { name: "ffmpeg", env: "TAURI_FFMPEG_BIN" },
  { name: "yt-dlp", env: "TAURI_YT_DLP_BIN" },
  { name: "whisper-cli", env: "TAURI_WHISPER_CLI_BIN" }
];

mkdirSync(sidecarDir, { recursive: true });

for (const binary of binaries) {
  const source = resolveBinary(binary);
  const target = path.join(sidecarDir, `${binary.name}-${targetTriple}${process.platform === "win32" ? ".exe" : ""}`);
  copyFileSync(source, target);
  chmodSync(target, statSync(target).mode | 0o755);
  console.log(`${binary.name}: ${source} -> ${path.relative(projectDir, target)}`);
  warnIfNotPortable(binary.name, source, target);
}

function resolveBinary(binary) {
  const configured = process.env[binary.env];
  const source = configured || binary.fallback || commandPath(binary.name);
  if (!source) {
    throw new Error(`Cannot find ${binary.name}. Set ${binary.env} to an executable path.`);
  }
  return realpathSync(source);
}

function commandPath(command) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.split(/\r?\n/).find(Boolean);
}

function getTargetTriple() {
  const result = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("Cannot determine Rust host target. Install Rust/Cargo first.");
  }
  const host = result.stdout.match(/^host:\s*(.+)$/m)?.[1]?.trim();
  if (!host) {
    throw new Error("Cannot parse Rust host target from rustc -vV.");
  }
  return host;
}

function warnIfNotPortable(name, source, target) {
  if (source.includes("/opt/homebrew/")) {
    console.warn(`  warning: ${name} was copied from Homebrew and may depend on /opt/homebrew dylibs.`);
  }

  const header = readHeader(target);
  if (header.startsWith("#!") && header.includes("/opt/homebrew/")) {
    console.warn(`  warning: ${name} is a script with a Homebrew shebang; use ${envName(name)} for a standalone binary before distributing.`);
  }
}

function readHeader(filePath) {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(256);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function envName(name) {
  return `TAURI_${name.toUpperCase().replace(/-/g, "_")}_BIN`;
}
