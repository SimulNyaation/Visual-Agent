// 이 컴퓨터에 설치된 실제 에이전트(Claude Code, Codex)를 앱의 터미널에서 실행해, 줄에 이름이 뜨는지 본다 (SPEC-20261116-terminal AC7, AC21, AC22).
// 에이전트에게 일을 시키지는 않는다. 첫 화면이 뜨면 스크린샷을 찍고 Esc나 Ctrl+C로 끝낸다.
// 실제 계정과 설치 상태에 따라 결과가 달라지므로 품질 게이트에는 넣지 않는다.
// 사용: VA_EVIDENCE_DIR=<폴더> node e2e/real-agents-check.mjs
import { createSandbox, descendants, launchApp, waitUntil } from "./harness.mjs";

const sandbox = createSandbox();
const project = sandbox.project("agent-check");
sandbox.seedSettings([project]);
const app = await launchApp(sandbox);
const page = app.page;
const label = () => page.locator(".agentrow__select").first().getAttribute("aria-label");
const text = () => page.locator(".termview .xterm-rows").innerText();

try {
  const { work } = app.info();
  app.place(work.left + 60, work.top + 40, 1280, 820);
  await waitUntil(async () => (await text()).includes(">"), "셸이 준비됨", 20000);

  for (const [command, name, shot] of [
    ["claude", "Claude Code", "AC21-real-claude-code.png"],
    ["codex", "Codex", "AC21-real-codex.png"],
  ]) {
    await page.locator(".termview").click();
    await page.keyboard.type(command);
    await page.keyboard.press("Enter");
    const started = Date.now();
    try {
      await waitUntil(async () => (await label()) === `PowerShell 1, ${name} 실행 중`, `${name}가 줄에 표시됨`, 20000);
    } catch (error) {
      console.log(`${name}: 줄에 표시되지 않음 (${error.message}). 실행된 프로그램: ${descendants(app.pid).map((item) => item.name).join(", ")}`);
      console.log(`  터미널 내용: ${JSON.stringify((await text()).slice(0, 300))}`);
      continue;
    }
    console.log(`${name}: ${Date.now() - started}ms 만에 줄에 "${await label()}" 표시. 실행된 프로그램: ${descendants(app.pid).map((item) => item.name).join(", ")}`);
    await new Promise((done) => setTimeout(done, 6000));
    console.log(`  첫 화면 (앞부분): ${JSON.stringify((await text()).split("\n").filter((line) => line.trim() !== "").slice(0, 6))}`);
    app.screenshot(shot);

    // 처음 여는 폴더에서는 "이 폴더를 믿습니까"를 묻는다. 그 화면은 Esc로, 그 밖의 화면은 Ctrl+C로 끝난다
    const stopping = Date.now();
    await waitUntil(async () => {
      await page.keyboard.press("Escape");
      await new Promise((done) => setTimeout(done, 300));
      if ((await label()) === "PowerShell 1") return true;
      await page.keyboard.press("Control+C");
      await new Promise((done) => setTimeout(done, 700));
      return (await label()) === "PowerShell 1";
    }, `${name}를 끝내면 줄에서 이름이 사라짐`, 20000);
    console.log(`  끝낸 뒤 ${Date.now() - stopping}ms 만에 줄이 "${await label()}"로 돌아옴`);
  }
} finally {
  await app.close();
  sandbox.dispose();
}
