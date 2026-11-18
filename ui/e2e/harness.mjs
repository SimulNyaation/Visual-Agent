// 실제 Visual-Agent.exe를 띄워 조작하는 도구 모음.
// 개인 설정을 건드리지 않도록 매번 임시 폴더를 설정 폴더로 쓴다.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const exePath = join(repoRoot, "build", "dist", "Visual-Agent", "Visual-Agent.exe");
/** 에이전트 대신 실행하는 시험용 프로그램. 화면 전체를 쓰고, 받은 키를 파일에 적는다 */
const fakeAgentPath = join(repoRoot, "build", "core", "va_fake_agent.exe");
const hookProgramPath = join(repoRoot, "build", "core", "va-hook.exe");
const probeScript = join(repoRoot, "scripts", "window-probe.ps1");
const captureScript = join(repoRoot, "scripts", "capture-window.ps1");
const mouseScript = join(repoRoot, "scripts", "mouse-probe.ps1");
const keyScript = join(repoRoot, "scripts", "key-probe.ps1");
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

/** 실제 마우스 입력을 보낸다 (화면 좌표). 커서 아래가 앱 창이 아니면 누르지 않고 실패한다 */
export function mouse(pid, action, x, y, dx = 0, dy = 0) {
  const result = JSON.parse(powershell([
    "-File", mouseScript, "-ProcessId", String(pid), "-Action", action,
    "-X", String(Math.round(x)), "-Y", String(Math.round(y)), "-DX", String(dx), "-DY", String(dy),
  ]));
  if (!result.ok) throw new Error(`마우스 입력을 보내지 못했습니다: ${result.reason}`);
}

/** 실제 키보드 입력을 보낸다. 예: "F2,2,Enter", "Ctrl+C". 앱 창이 맨 앞이 아니면 누르지 않고 실패한다 */
export function keys(pid, combos) {
  const result = JSON.parse(powershell(["-File", keyScript, "-ProcessId", String(pid), "-Keys", combos]));
  if (!result.ok) throw new Error(`키보드 입력을 보내지 못했습니다: ${result.reason}`);
}

/** 실제 키보드로 글자를 친다. 한글 입력 상태와 상관없이 그 글자가 들어간다. 앱 창이 맨 앞이 아니면 치지 않고 실패한다 */
export function typeText(pid, text) {
  const result = JSON.parse(powershell(["-File", keyScript, "-ProcessId", String(pid), "-Text", text]));
  if (!result.ok) throw new Error(`키보드 입력을 보내지 못했습니다: ${result.reason}`);
}

/** Windows 클립보드의 글자를 읽거나 바꾼다 (실제 입력 테스트 전용) */
export const clipboard = {
  read: () => powershell(["-Command", "Get-Clipboard -Raw"]),
  write: (text) => powershell(["-Command", `Set-Clipboard -Value '${text.replaceAll("'", "''")}'`]),
};

/** 앱이 띄운 프로그램들(셸과 그 안에서 실행된 것). 화면 부품은 뺀다 */
export function descendants(pid) {
  const output = powershell([
    "-Command",
    `$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name; ` +
      `$found = @(); $queue = @(${pid}); ` +
      `while ($queue.Count -gt 0) { $next = @($all | Where-Object { $queue -contains $_.ParentProcessId -and $_.Name -ne 'msedgewebview2.exe' }); $found += $next; $queue = @($next | ForEach-Object { $_.ProcessId }) }; ` +
      `ConvertTo-Json -Compress @($found | ForEach-Object { @{ pid = $_.ProcessId; name = $_.Name.ToLower() } })`,
  ]);
  return JSON.parse(output || "[]");
}

/** 그 번호의 프로그램 가운데 아직 실행 중인 것 */
export function stillRunning(processes) {
  if (processes.length === 0) return [];
  const alive = powershell([
    "-Command",
    `ConvertTo-Json -Compress @(Get-Process -Id ${processes.map((item) => item.pid).join(",")} -ErrorAction SilentlyContinue | ForEach-Object { @{ pid = $_.Id; name = ($_.ProcessName + '.exe').ToLower() } })`,
  ]);
  const now = JSON.parse(alive || "[]");
  // 번호는 다시 쓰일 수 있으므로 이름까지 같은 것만 센다
  return processes.filter((item) => now.some((other) => other.pid === item.pid && other.name === item.name));
}

/** 테스트용 폴더 묶음: 설정 폴더와 프로젝트로 쓸 폴더들 */
export function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "va-e2e-"));
  const dataDir = join(root, "data");
  mkdirSync(dataDir);
  return {
    root,
    dataDir,
    /** 앱이 지운 것을 실제 휴지통 대신 보내는 폴더 */
    trashDir: join(root, "trash"),
    project(...parts) {
      const folder = join(root, "projects", ...parts);
      mkdirSync(folder, { recursive: true });
      return folder;
    },
    /** 앱을 띄우기 전에 개인 설정 파일을 써 둔다 (이전에 쓰던 것처럼) */
    seedSettings(folders, extra = {}) {
      const tabs = folders.map((path, index) => ({ id: `t${index + 1}`, path }));
      const settings = { version: 1, tabs, activeId: tabs[0]?.id ?? "", nextId: tabs.length + 1, ...extra };
      writeFileSync(join(dataDir, "state.json"), JSON.stringify(settings));
    },
    /** 시험용 프로그램을 그 이름으로 폴더에 넣어 둔다. 예: fakeAgent(alpha, "claude.exe") */
    fakeAgent(folder, name) {
      if (!existsSync(fakeAgentPath)) throw new Error(`${fakeAgentPath} 가 없습니다. 먼저 "npm run build"로 앱을 빌드하세요.`);
      copyFileSync(fakeAgentPath, join(folder, name));
    },
    /** Claude Code의 훅이 실행하는 프로그램(va-hook.exe)을 폴더에 넣어 둔다. 시험용 프로그램이 숫자 키를 받으면 이것을 실행한다 */
    hookProgram(folder) {
      if (!existsSync(hookProgramPath)) throw new Error(`${hookProgramPath} 가 없습니다. 먼저 "npm run build"로 앱을 빌드하세요.`);
      copyFileSync(hookProgramPath, join(folder, "va-hook.exe"));
    },
    dispose() {
      // 앱이 끝난 뒤에도 화면 부품(WebView2)이 캐시 파일을 한동안 더 쓰는 경우가 있어(특히 앱을 띄우자마자 닫았을 때) 잠깐씩 쉬며 다시 해 본다.
      // rmSync의 다시 하기 기능은 쉬는 시간이 매번 길어져 몇 분씩 멈출 수 있으므로 쓰지 않는다.
      // 끝내 지우지 못한 것은 앱의 결함이 아니므로 테스트를 실패시키지 않고 알리기만 한다
      const deadline = Date.now() + 15000;
      for (;;) {
        try {
          rmSync(root, { recursive: true, force: true });
          return;
        } catch (error) {
          if (Date.now() > deadline) {
            console.warn(`임시 폴더를 지우지 못했습니다 (${error.code}): ${root}`);
            return;
          }
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
        }
      }
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

/** extraEnv: 앱에 더 넘길 환경 변수. 예: { VA_HIDE_SHELLS: "pwsh" } (PowerShell 7이 없는 컴퓨터처럼 띄운다) */
export async function launchApp(sandbox, extraEnv = {}) {
  if (!existsSync(exePath)) {
    throw new Error(`${exePath} 가 없습니다. 먼저 "npm run build"로 앱을 빌드하세요.`);
  }
  const debugPort = await freePort();
  const child = spawn(exePath, [], {
    env: {
      ...process.env,
      VA_DATA_DIR: sandbox.dataDir,
      VA_TRASH_DIR: sandbox.trashDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
      ...extraEnv,
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
    /** 창 버튼 영역이 그 점을 무엇이라고 답하는지 (최소화 8, 최대화 9, 닫기 20) */
    hitCaption: (x, y) => probe("hit", ["-Caption", "-X", String(Math.round(x)), "-Y", String(Math.round(y))]).hit,
    /** 창 버튼 영역에 누름 신호를 보낸다. 실제 클릭이 버튼까지 도달하는지는 caption.e2e.mjs가 확인한다 */
    clickCaption: (code) => probe("ncclick", ["-Caption", "-Hit", String(code)]),
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
    /** 앱이 끝날 때까지 기다린다. 시간 안에 끝나지 않으면 실패한다 */
    waitForExit: (timeoutMs = 10000) =>
      Promise.race([
        exited,
        pause(timeoutMs).then(() => {
          throw new Error(`앱이 ${timeoutMs / 1000}초 안에 종료되지 않았습니다`);
        }),
      ]),
    /** 창에 닫기 신호만 보낸다 (닫기 버튼, Alt+F4와 같은 신호). 끝나기를 기다리지 않는다 */
    requestClose: () => probe("close"),
    exited: () => child.exitCode !== null,
    /** 닫기 신호를 보내고 끝날 때까지 기다린다 */
    async close() {
      if (child.exitCode === null) {
        try {
          probe("close");
        } catch {
          child.kill();
        }
      }
      if (child.exitCode === null) {
        await Promise.race([exited, pause(5000)]);
        if (child.exitCode === null) child.kill();
      }
      await exited;
      // 앱이 이미 끝났으면 화면과의 연결을 끊는 일이 끝나지 않을 때가 있어, 오래 기다리지 않는다
      await Promise.race([browser.close().catch(() => undefined), pause(3000)]);
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
