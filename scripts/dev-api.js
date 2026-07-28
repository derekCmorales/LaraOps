#!/usr/bin/env node
// Cross-platform replacement for dev-api.sh
const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const apiDir = path.join(root, "api");
const isWin = process.platform === "win32";
const venvDir = path.join(apiDir, ".venv");
const bin = isWin ? path.join(venvDir, "Scripts") : path.join(venvDir, "bin");
const pythonExe = path.join(bin, isWin ? "python.exe" : "python");
const uvicornExe = path.join(bin, isWin ? "uvicorn.exe" : "uvicorn");
const python3 = isWin ? "python" : "python3";

const run = (cmd, opts = {}) =>
  execSync(cmd, { stdio: "inherit", cwd: apiDir, ...opts });

if (!fs.existsSync(venvDir)) {
  run(`${python3} -m venv .venv`);
  run(`"${pythonExe}" -m pip install -e ".[dev]"`);
}

spawn(uvicornExe, ["app.main:app", "--reload", "--port", "8000"], {
  cwd: apiDir,
  stdio: "inherit",
  shell: false,
}).on("exit", (code) => process.exit(code ?? 0));
