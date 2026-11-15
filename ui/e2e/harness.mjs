// 실제 Visual-Agent.exe를 띄워 조작하는 도구 모음.
// 개인 설정을 건드리지 않도록 매번 임시 폴더를 설정 폴더로 쓴다.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const exePath = join(repoRoot, "build", "dist", "Visual-Agent", "Visual-Agent.exe");
const probeScript = join(repoRoot, "scripts", "window-probe.ps1");
const captureScript = join(repoRoot, "scripts", "capture-window.ps1");
const evidenceDir = process.env.VA_EVIDENCE_DIR;

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function powershell(args) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
    { encoding: "utf8" },
  ).trim();
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

/** 테스트용 폴더 묶음: 설정 폴더와 프로젝트로 쓸 폴더들 */
export function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "va-e2e-"));
  const dataDir = join(root, "data");
  mkdirSync(dataDir);
  return {
    root,
    dataDir,
    project(...parts) {
      const folder = join(root, "projects", ...parts);
      mkdirSync(folder, { recursive: true });
      return folder;
    },
    dispose() {
      // 화면 부품이 캐시 파일을 놓을 때까지 잠깐 걸릴 수 있다
      rmSync(root, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
    },
  };
}

/** 설정 폴더를 쓰는 프로세스(앱과 그 화면 부품) 수 */
export function countProcessesUsing(dataDir) {
  const escaped = dataDir.replaceAll("'", "''");
  const output = powershell([
    "-Command",
    `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') -and $_.Name -ne 'powershell.exe' }).Count`,
  ]);
  return Number(output);
}

export async function launchApp(sandbox) {
  if (!existsSync(exePath)) {
    throw new Error(`${exePath} 가 없습니다. 먼저 "npm run build"로 앱을 빌드하세요.`);
  }
  const debugPort = await freePort();
  const child = spawn(exePath, [], {
    env: {
      ...process.env,
      VA_DATA_DIR: sandbox.dataDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
    stdio: "ignore",
  });
  const exited = new Promise((done) => child.once("exit", done));

  let browser;
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
      break;
    } catch (error) {
      if (Date.now() > deadline) throw new Error("앱 화면에 연결하지 못했습니다.", { cause: error });
      await pause(200);
    }
  }

  let page;
  while (!page) {
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes("/index.html"));
    if (!page) {
      if (Date.now() > deadline) throw new Error("앱 화면(index.html)을 찾지 못했습니다.");
      await pause(200);
    }
  }
  await page.waitForSelector(".titlebar");

  // 폴더 선택 창 대신, 다음에 고를 폴더를 요청에 실어 보낸다
  const picks = [];
  await page.route("**/api/tabs", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && picks.length > 0) {
      await route.continue({ postData: JSON.stringify({ path: picks.shift() }) });
    } else {
      await route.continue();
    }
  });

  const probe = (action, extra = []) =>
    JSON.parse(powershell(["-File", probeScript, "-ProcessId", String(child.pid), "-Action", action, ...extra]));

  return {
    page,
    pid: child.pid,
    /** 다음에 "폴더 선택 창에서 고를" 폴더를 정해 둔다 */
    pickNext: (folder) => picks.push(folder),
    info: () => probe("info"),
    hit: (x, y) => probe("hit", ["-X", String(Math.round(x)), "-Y", String(Math.round(y))]).hit,
    /** 창 버튼(최소화 8, 최대화 9, 닫기 20)을 누른 것과 같은 신호를 보낸다 */
    clickCaption: (code) => probe("ncclick", ["-Hit", String(code)]),
    restore: () => probe("restore"),
    /** 떠 있는 폴더 선택 창의 제목. 없으면 undefined */
    dialogTitle() {
      const result = probe("dialog");
      return result.open ? String.fromCharCode(...result.titleCodes) : undefined;
    },
    closeDialog: () => probe("closedialog"),
    /** 창을 정해진 자리와 크기로 옮긴다 (화면 좌표) */
    place: (x, y, width, height) => probe("place", ["-X", String(x), "-Y", String(y), "-Width", String(width), "-Height", String(height)]),
    screenshot(name) {
      if (!evidenceDir) return;
      powershell(["-File", captureScript, "-ProcessId", String(child.pid), "-Out", join(evidenceDir, name)]);
    },
    waitForExit: () => exited,
    /** 닫기 신호를 보내고 끝날 때까지 기다린다 */
    async close() {
      if (child.exitCode === null) {
        try {
          probe("close");
        } catch {
          child.kill();
        }
      }
      await exited;
      await browser.close().catch(() => undefined);
    },
  };
}

export async function waitUntil(check, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`시간 안에 조건이 맞지 않았습니다: ${message}`);
    await pause(150);
  }
}
