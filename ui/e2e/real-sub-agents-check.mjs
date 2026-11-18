// 이 컴퓨터의 실제 Claude Code를 앱의 터미널에서 실행해, 하위 에이전트 하나를 부리게 하고 터미널 줄이 어떻게 바뀌는지 적는다
// (SPEC-20261118-sub-agents AC11). Claude Code 설정에 Visual-Agent 훅이 들어 있어야 한다 (node scripts/claude-hooks.mjs install).
// 사용자의 계정으로 실제 요청이 나가므로 품질 게이트에는 넣지 않는다. 질문은 하나만 보낸다.
// 사용: VA_EVIDENCE_DIR=<폴더> VA_HOOK_LOG=<훅이 받은 내용을 적을 파일> node e2e/real-sub-agents-check.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

const QUESTION = "Explore 하위 에이전트 하나만 써서 이 폴더에 파일이 몇 개인지 세어 줘. 다른 일은 하지 마.";

const sandbox = createSandbox();
const project = sandbox.project("sub-agent-check");
writeFileSync(join(project, "a.txt"), "a\n");
writeFileSync(join(project, "b.txt"), "b\n");
sandbox.seedSettings([project]);
// PowerShell은 넣은 명령을 사용자의 명령 기록 파일에 남긴다. 그래서 명령 프롬프트로 띄운다
const app = await launchApp(sandbox, { VA_HIDE_SHELLS: "pwsh" });
const page = app.page;
const text = () => page.locator(".termview .xterm-rows").innerText();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const read = () =>
  page.locator(".agentrow").first().evaluate((item) => ({
    status: item.querySelector(".agentrow__status")?.textContent ?? null,
    subs: [...item.querySelectorAll(".subagent")].map((sub) => sub.textContent),
  }));

const started = Date.now();
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s`;
let last = "";
let shot = false;
let sawSub = false;
async function note(what) {
  const now = await read();
  const line = JSON.stringify(now);
  if (now.subs.length > 0) sawSub = true;
  if (now.subs.length > 0 && !shot) {
    shot = true;
    app.screenshot("AC11-real-claude-code.png");
  }
  if (line !== last || what) console.log(`${stamp()}  ${what ? `[${what}] ` : ""}상태=${now.status ?? "없음"}  하위 에이전트=${JSON.stringify(now.subs)}`);
  last = line;
  return now;
}
async function watch(ms, done = () => false) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (done(await note())) return true;
    await sleep(200);
  }
  return false;
}

try {
  const { work } = app.info();
  app.place(work.left + 60, work.top + 40, 1280, 820);
  await waitUntil(async () => (await text()).includes(">"), "셸이 준비됨", 20000);
  await page.locator(".termview").click();
  await page.keyboard.type("claude");
  await page.keyboard.press("Enter");
  await note("claude 실행");

  // 처음 여는 폴더에서는 "이 폴더를 믿습니까"를 묻는다. "Yes"가 골라져 있을 때 Enter를 누른다
  await waitUntil(async () => /trust|❯|>/i.test(await text()) && (await read()).status !== null, "Claude Code가 뜸", 30000);
  await sleep(1500);
  for (let tries = 0; tries < 4 && /trust/i.test(await text()); tries++) {
    const chosen = (await text()).split("\n").find((line) => line.includes("❯")) ?? "";
    await page.keyboard.press(/yes/i.test(chosen) ? "Enter" : "ArrowDown");
    await sleep(800);
  }
  await watch(6000);
  await note("질문을 넣기 시작");
  await page.keyboard.type(QUESTION, { delay: 20 });
  await note("질문을 다 넣음");
  await page.keyboard.press("Enter");
  await note("질문을 보냄");

  // 하위 에이전트가 보였다가 사라지고 입력 대기(또는 끝남)가 될 때까지, 길어도 3분
  const finished = await watch(180000, (now) => sawSub && now.subs.length === 0 && now.status !== "작업 중" && now.status !== "허락 대기");
  await note(finished ? "답을 마침" : "3분 안에 끝나지 않음");
  await watch(5000);
  app.screenshot("AC11-real-claude-code-after.png");
  console.log(`\n답 (터미널 화면의 끝부분):\n${(await text()).split("\n").filter((line) => line.trim() !== "").slice(-14).join("\n")}`);
} finally {
  await page.locator(".termview").click().catch(() => undefined);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Control+C").catch(() => undefined);
    await sleep(500);
  }
  await app.close();
  sandbox.dispose();
}
