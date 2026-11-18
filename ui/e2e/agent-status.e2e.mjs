// 실제 앱 창과 실제 셸로 에이전트 상태의 인수 기준을 확인한다. 실행: npm run e2e (먼저 앱을 빌드해야 한다)
// 에이전트 대신 시험용 프로그램(claude.exe라는 이름으로 복사한 것)을 실행한다.
// 이 프로그램은 w를 받으면 4초, e를 받으면 1초 동안 0.2초마다 진행 표시를 그린다 (에이전트가 작업하는 모습).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

// PowerShell은 넣은 명령을 사용자의 명령 기록 파일에 남긴다. 그래서 명령 프롬프트로 띄운다
const CMD_ONLY = { VA_HIDE_SHELLS: "pwsh" };

describe("에이전트 상태", () => {
  let sandbox;
  let app;
  let page;
  let alpha;
  let beta;

  /** 줄마다 보이는 상태 글자. 없으면 null */
  const statuses = () =>
    page.locator(".agentrow").evaluateAll((items) => items.map((item) => item.querySelector(".agentrow__status")?.textContent ?? null));
  const waitStatuses = (expected, timeoutMs) =>
    waitUntil(async () => JSON.stringify(await statuses()) === JSON.stringify(expected), `상태가 ${JSON.stringify(expected)}가 됨`, timeoutMs);
  const waitText = (part, timeoutMs = 8000) =>
    waitUntil(async () => (await page.locator(".termview .xterm-rows").innerText()).includes(part), `터미널에 "${part}"가 보임`, timeoutMs);
  const row = (index) => page.locator(".agentrow__select").nth(index);
  const attention = (name) => page.getByRole("tab", { name }).locator(".tab__attention").count();
  const focusTerminal = () => page.locator(".termview").click();
  const startAgent = async () => {
    await focusTerminal();
    await page.keyboard.type(".\\claude.exe");
    await page.keyboard.press("Enter");
    await waitText("FAKE AGENT READY");
  };
  /** 지켜보는 동안 상태가 한 번도 달라지지 않는지 */
  const staysFor = async (expected, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      assert.deepEqual(await statuses(), expected);
      await page.waitForTimeout(100);
    }
  };

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    beta = sandbox.project("beta");
    sandbox.fakeAgent(alpha, "claude.exe");
    sandbox.seedSettings([alpha, beta]);
    app = await launchApp(sandbox, CMD_ONLY);
    page = app.page;
    page.setDefaultTimeout(8000);
    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 1280, 820);
    await page.getByRole("tab", { name: "alpha" }).click();
    await waitText(">");
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC1 에이전트가 없는 터미널 줄에는 상태가 없고, 에이전트를 실행하면 입력 대기가 된다", async () => {
    assert.deepEqual(await statuses(), [null]);
    await startAgent();
    await waitStatuses(["입력 대기"], 6000);
    assert.equal(await page.locator(".agentrow__dot--waiting").count(), 1);
    assert.equal(await row(0).getAttribute("aria-label"), "cmd 1, Claude Code 실행 중");
  });

  test("AC4 글자를 넣거나 앱 창의 크기를 바꾸는 것만으로는 작업 중이 되지 않는다", async () => {
    await focusTerminal();
    for (const key of ["a", "b", "c", "d", "Backspace", "ArrowUp"]) {
      await page.keyboard.press(key);
      await staysFor(["입력 대기"], 200);
    }
    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 1100, 760);
    await staysFor(["입력 대기"], 1500);
    app.place(work.left + 60, work.top + 40, 1280, 820);
    await staysFor(["입력 대기"], 1500);
  });

  test("AC2 AC3 에이전트가 작업을 시작하면 3초 안에 작업 중이 되고, 멈추면 4초 안에 입력 대기가 된다", async () => {
    await focusTerminal();
    await page.keyboard.press("w");
    await waitStatuses(["작업 중"], 3000);
    const dot = await page.locator(".agentrow__dot").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { animation: style.animationName, color: style.backgroundColor };
    });
    assert.equal(dot.animation, "agent-working", "작업 중인 동안 점이 깜빡인다");
    assert.equal(dot.color, "rgb(217, 164, 65)"); // --ochre
    assert.equal(await row(0).getAttribute("aria-describedby").then((id) => page.locator(`#${id}`).innerText()), "작업 중");
    app.screenshot("AC2-working.png");

    await waitText("work done", 8000);
    const stoppedAt = Date.now();
    await waitStatuses(["입력 대기"], 4000);
    assert.ok(Date.now() - stoppedAt < 4000);
    // 보고 있는 터미널에서 마친 작업은 끝남을 거치지 않는다
    assert.equal(await attention("alpha"), 0);
  });

  test("AC5 AC6 보고 있지 않은 터미널이 작업을 마치면 끝남이 되고 프로젝트 탭에 점이 생기며, 눌러 보면 입력 대기가 된다", async () => {
    await page.getByRole("button", { name: "새 터미널" }).click();
    await waitStatuses(["입력 대기", null]);
    await row(0).click();
    await focusTerminal();
    await page.keyboard.press("w");
    await waitStatuses(["작업 중", null], 3000);
    await row(1).click();

    await waitStatuses(["끝남", null], 10000);
    assert.equal(await page.locator(".agentrow__dot--finished").count(), 1);
    assert.equal(await attention("alpha"), 1);
    app.screenshot("AC5-finished-unseen.png");

    await row(0).click();
    await waitStatuses(["입력 대기", null], 2000);
    assert.equal(await attention("alpha"), 0);
  });

  test("AC5 3초보다 짧은 화면 갱신은 끝남으로 치지 않는다", async () => {
    await focusTerminal();
    await page.keyboard.press("e");
    await row(1).click();
    // 1초짜리 갱신이 끝나고 조용해질 때까지 지켜본다. 그동안 한 번도 끝남이 되지 않는다
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      assert.notEqual((await statuses())[0], "끝남");
      assert.equal(await attention("alpha"), 0);
      await page.waitForTimeout(150);
    }
    assert.deepEqual(await statuses(), ["입력 대기", null]);
  });

  test("AC6 다른 프로젝트 탭에 끝남이 있으면 그 탭에 점이 표시되고, 그 탭으로 가서 그 터미널을 보면 사라진다", async () => {
    await row(0).click();
    await focusTerminal();
    await page.keyboard.press("w");
    await waitStatuses(["작업 중", null], 3000);
    await page.getByRole("tab", { name: "beta" }).click();
    await waitStatuses([null]);
    assert.equal(await attention("alpha"), 0);

    await waitUntil(async () => (await attention("alpha")) === 1, "alpha 탭에 점이 생김", 10000);
    assert.equal(await attention("beta"), 0);
    assert.equal(await page.getByRole("tab", { name: "alpha" }).getAttribute("aria-description"), "작업을 마친 에이전트가 있습니다");
    app.screenshot("AC6-project-tab-dot.png");

    await page.getByRole("tab", { name: "alpha" }).click();
    await waitStatuses(["입력 대기", null], 3000);
    assert.equal(await attention("alpha"), 0);
  });

  test("AC7 상태는 이름이 정해진 줄에도 표시되고, 사이드바가 가장 좁을 때도 잘리지 않는다", async () => {
    await focusTerminal();
    await page.keyboard.press("F2");
    await waitUntil(async () => (await row(0).innerText()).includes("Fix login error"), "줄 이름이 주제로 바뀜", 3000);
    const before = await page.locator(".agentrow").first().boundingBox();
    await page.keyboard.press("w");
    await waitStatuses(["작업 중", null], 3000);
    const during = await page.locator(".agentrow").first().boundingBox();
    assert.equal(during.height, before.height, "상태가 바뀌어도 줄의 높이는 같다");

    // 사이드바를 가장 좁게(180px) 줄인다
    const sidebar = await page.locator(".sidebar").boundingBox();
    await page.mouse.move(sidebar.x + sidebar.width, sidebar.y + sidebar.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, sidebar.y + sidebar.height / 2 + 20, { steps: 6 });
    await page.mouse.up();
    assert.equal((await page.locator(".sidebar").boundingBox()).width, 180);
    const fit = await page.locator(".agentrow").first().evaluate((item) => {
      const status = item.querySelector(".agentrow__status");
      const close = item.querySelector(".agentrow__close");
      const rect = status.getBoundingClientRect();
      return { whole: status.scrollWidth <= status.clientWidth, beforeClose: rect.right <= close.getBoundingClientRect().left + 1, inside: rect.left >= item.getBoundingClientRect().left };
    });
    assert.deepEqual(fit, { whole: true, beforeClose: true, inside: true });
    app.screenshot("AC7-narrow-sidebar.png");
    await page.mouse.dblclick(180, sidebar.y + sidebar.height / 2);
    await waitStatuses(["입력 대기", null], 10000);
  });

  test("AC8 에이전트를 끝내면 상태가 사라지고, 다시 실행하면 처음부터 다시 정해진다", async () => {
    await focusTerminal();
    await page.keyboard.press("Control+C");
    await waitStatuses([null, null], 3000);
    await startAgent();
    await waitStatuses(["입력 대기", null], 6000);
    assert.equal(await attention("alpha"), 0);
  });
});
