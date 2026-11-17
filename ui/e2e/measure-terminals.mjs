// 터미널을 띄운 상태에서 앱이 쓰는 메모리를 재고, 실행 중인 Orca와 비교한다 (SPEC-20261116-terminal AC31).
// 앱 쪽은 앱 자신과 화면 부품(WebView2)만 센다. 셸과 그 안에서 실행한 프로그램, 콘솔 프로그램(conhost)은 뺀다.
// Orca는 지금 실행 중인 것을 그대로 잰다. 이름이 orca로 시작하는 프로그램만 세므로 Orca의 셸도 빠진다.
// Orca 쪽 조건(프로젝트 하나, 터미널 같은 개수, 에이전트 없음)은 사람이 맞춰 두어야 한다.
// 값은 작업 관리자의 "메모리(개인 작업 집합)"과 같은 항목이다.
// 사용: node e2e/measure-terminals.mjs [터미널 수=3] [기다리는 초=30]
import { execFileSync } from "node:child_process";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

const terminals = Number(process.argv[2] ?? 3);
const waitSeconds = Number(process.argv[3] ?? 30);

function powershell(command) {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
}

/** 프로그램 번호들의 개인 작업 집합 합계 (MB) */
function privateWorkingSetMb(filter) {
  return JSON.parse(
    powershell(
      `$ids = @(Get-CimInstance Win32_Process | Where-Object { ${filter} } | ForEach-Object { $_.ProcessId }); ` +
        `$rows = @(Get-CimInstance Win32_PerfRawData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess }); ` +
        `ConvertTo-Json -Compress @{ count = $ids.Count; mb = [math]::Round((($rows | Measure-Object WorkingSetPrivate -Sum).Sum) / 1MB, 1) }`,
    ),
  );
}

const sandbox = createSandbox();
const project = sandbox.project("sample");
sandbox.seedSettings([project]);
const app = await launchApp(sandbox);
try {
  const rows = app.page.locator(".agentrow");
  await waitUntil(async () => (await rows.count()) === 1, "첫 터미널이 뜸");
  for (let count = 2; count <= terminals; count++) {
    await app.page.getByRole("button", { name: "새 터미널" }).click();
    await waitUntil(async () => (await rows.count()) === count, `터미널 ${count}개가 뜸`);
  }
  await new Promise((done) => setTimeout(done, waitSeconds * 1000));

  const dataDir = sandbox.dataDir.replaceAll("'", "''");
  const ours = privateWorkingSetMb(
    `$_.ProcessId -eq ${app.pid} -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.Contains('${dataDir}'))`,
  );
  const shells = privateWorkingSetMb(`$_.ParentProcessId -eq ${app.pid} -and $_.Name -ne 'msedgewebview2.exe'`);
  const orca = privateWorkingSetMb(`$_.Name -match '^orca'`);

  console.log(`measured at        : ${new Date().toISOString()}`);
  console.log(`wait before measure: ${waitSeconds} s`);
  console.log(`Visual-Agent       : ${ours.mb} MB  (${ours.count} processes: 1 app + ${ours.count - 1} WebView2), 1 project, ${terminals} terminals (PowerShell 7), no agents`);
  console.log(`  not counted      : ${shells.mb} MB  (${shells.count} processes: shells and their console hosts)`);
  if (orca.count === 0) {
    console.log("Orca               : not running");
  } else {
    console.log(`Orca               : ${orca.mb} MB  (${orca.count} processes named orca*), state as currently open on this PC`);
    console.log(`Visual-Agent / Orca: ${Math.round((ours.mb / orca.mb) * 1000) / 10} %`);
  }
} finally {
  await app.close();
  sandbox.dispose();
}
