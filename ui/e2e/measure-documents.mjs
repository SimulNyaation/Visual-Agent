// 문서 창을 연 상태에서 앱이 쓰는 메모리를 잰다 (SPEC-20261118-document-window AC17).
// 앱 자신과 화면 부품(WebView2)만 센다. 셸은 뺀다. 값은 작업 관리자의 "메모리(개인 작업 집합)"과 같은 항목이다.
// 사용: node e2e/measure-documents.mjs [기다리는 초=15]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

const waitSeconds = Number(process.argv[2] ?? 15);
const settle = () => new Promise((done) => setTimeout(done, waitSeconds * 1000));

function privateWorkingSetMb(filter) {
  const command =
    `$ids = @(Get-CimInstance Win32_Process | Where-Object { ${filter} } | ForEach-Object { $_.ProcessId }); ` +
    `$rows = @(Get-CimInstance Win32_PerfRawData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess }); ` +
    `[math]::Round((($rows | Measure-Object WorkingSetPrivate -Sum).Sum) / 1MB, 1)`;
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim());
}

const sandbox = createSandbox();
const project = sandbox.project("sample");
writeFileSync(join(project, "readme.md"), "# 문서\n\n" + "본문 문단입니다. **굵게** `코드`\n\n".repeat(200));
writeFileSync(join(project, "diagram.md"), "# 그림\n\n```mermaid\ngraph TD\n  A --> B\n  B --> C\n```\n");
sandbox.seedSettings([project]);
const app = await launchApp(sandbox, { VA_HIDE_SHELLS: "pwsh" });
try {
  const { page } = app;
  const dataDir = sandbox.dataDir.replaceAll("'", "''");
  const measure = () =>
    privateWorkingSetMb(
      `$_.ProcessId -eq ${app.pid} -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.Contains('${dataDir}'))`,
    );
  const file = (name) => page.locator(`[role="treeitem"][aria-label="${name}"]`);
  await file("readme.md").waitFor();
  await settle();
  const closed = measure();

  await file("readme.md").click();
  await waitUntil(async () => (await page.locator(".doc__markdown h1").count()) === 1, "마크다운 문서가 열림");
  await settle();
  const markdown = measure();

  await file("diagram.md").click();
  await waitUntil(async () => (await page.locator(".doc__diagram svg").count()) === 1, "머메이드 그림이 그려짐", 20000);
  await settle();
  const diagram = measure();

  console.log(`measured at                         : ${new Date().toISOString()}`);
  console.log(`wait before each measure            : ${waitSeconds} s`);
  console.log(`1 project, 1 terminal (cmd), no document window : ${closed} MB`);
  console.log(`+ markdown document open            : ${markdown} MB  (${(markdown - closed).toFixed(1)} MB more)`);
  console.log(`+ mermaid diagram drawn             : ${diagram} MB  (${(diagram - markdown).toFixed(1)} MB more)`);
} finally {
  await app.close();
  sandbox.dispose();
}
