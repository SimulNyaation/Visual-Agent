// 실제 앱 창과 실제 셸로 하위 에이전트 표시의 인수 기준을 확인한다. 실행: npm run e2e (먼저 앱을 빌드해야 한다)
// 에이전트 대신 시험용 프로그램(claude.exe라는 이름으로 복사한 것)을 실행한다. 이 프로그램은 숫자 키 N을 받으면
// 실제 Claude Code가 훅을 실행하듯이, hookN.json의 내용을 넘겨 실제 훅 프로그램(va-hook.exe)을 실행한다.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

// PowerShell은 넣은 명령을 사용자의 명령 기록 파일에 남긴다. 그래서 명령 프롬프트로 띄운다
const CMD_ONLY = { VA_HIDE_SHELLS: "pwsh" };

// 숫자 키마다 실제 Claude Code가 훅에 넘기는 것과 같은 모양의 내용
const HOOKS = {
  1: { hook_event_name: "UserPromptSubmit", prompt: "로그인 오류를 고쳐 줘" },
  2: { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "Explore", description: "로그인 코드가 어디 있는지 찾기", prompt: "..." } },
  3: { hook_event_name: "SubagentStart", agent_id: "agent-a1", agent_type: "Explore" },
  4: { hook_event_name: "SubagentStart", agent_id: "agent-a2", agent_type: "general-purpose" },
  5: { hook_event_name: "SubagentStop", agent_id: "agent-a1", agent_type: "Explore" },
  6: { hook_event_name: "SubagentStop", agent_id: "agent-a2", agent_type: "general-purpose" },
  7: { hook_event_name: "Stop", background_tasks: [] },
  8: { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm test" } },
};

describe("하위 에이전트", () => {
  let sandbox;
  let app;
  let page;
  let alpha;
  let beta;

  const statuses = () =>
    page.locator(".agentrow").evaluateAll((items) => items.map((item) => item.querySelector(".agentrow__status")?.textContent ?? null));
  /** 터미널 줄마다 그 아래의 하위 에이전트 줄 [설명, 종류] */
  const subRows = () =>
    page.locator(".agentrow").evaluateAll((items) =>
      items.map((item) =>
        [...item.querySelectorAll(".subagent")].map((sub) => [
          sub.querySelector(".subagent__title")?.textContent ?? null,
          sub.querySelector(".subagent__kind")?.textContent ?? null,
        ]),
      ),
    );
  const waitFor = (read, expected, what, timeoutMs = 4000) =>
    waitUntil(async () => JSON.stringify(await read()) === JSON.stringify(expected), `${what}: ${JSON.stringify(expected)}`, timeoutMs);
  const waitStatuses = (expected, timeoutMs) => waitFor(statuses, expected, "상태", timeoutMs);
  const waitSubRows = (expected, timeoutMs) => waitFor(subRows, expected, "하위 에이전트 줄", timeoutMs);
  const waitText = (part, timeoutMs = 8000) =>
    waitUntil(async () => (await page.locator(".termview .xterm-rows").innerText()).includes(part), `터미널에 "${part}"가 보임`, timeoutMs);
  const row = (index) => page.locator(".agentrow__select").nth(index);
  const attention = (name) => page.getByRole("tab", { name }).locator(".tab__attention").count();
  const focusTerminal = () => page.locator(".termview").click();
  const press = async (key) => {
    await focusTerminal();
    await page.keyboard.press(key);
  };
  const startAgent = async () => {
    await focusTerminal();
    await page.keyboard.type(".\\claude.exe");
    await page.keyboard.press("Enter");
    await waitText("FAKE AGENT READY");
  };

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    beta = sandbox.project("beta");
    sandbox.fakeAgent(alpha, "claude.exe");
    sandbox.hookProgram(alpha);
    for (const [key, payload] of Object.entries(HOOKS)) writeFileSync(join(alpha, `hook${key}.json`), JSON.stringify(payload));
    sandbox.seedSettings([alpha, beta]);
    app = await launchApp(sandbox, CMD_ONLY);
    page = app.page;
    page.setDefaultTimeout(8000);
    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 1280, 820);
    await page.getByRole("tab", { name: "alpha" }).click();
    await waitText(">");
    await startAgent();
    await waitStatuses(["입력 대기"], 6000);
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC6 에이전트가 질문을 받았다고 알려 주면 화면이 조용해도 작업 중이고, 다 답했다고 알려 주면 바로 입력 대기가 된다", async () => {
    await press("1");
    await waitStatuses(["작업 중"], 2000);
    // 시험용 프로그램은 아무것도 그리지 않는다. 출력으로 짐작했다면 2.5초 뒤 입력 대기가 됐을 것이다
    const until = Date.now() + 4000;
    while (Date.now() < until) {
      assert.deepEqual(await statuses(), ["작업 중"]);
      await page.waitForTimeout(150);
    }
    await press("7");
    await waitStatuses(["입력 대기"], 2000);
  });

  test("AC1 AC2 AC3 에이전트가 하위 에이전트를 부리면 그 터미널 줄 아래에 설명과 종류가 보이고, 끝나면 사라진다", async () => {
    const before = await page.locator(".agentrow__select").first().boundingBox();
    await press("1");
    await press("2");
    await press("3");
    await waitSubRows([[["로그인 코드가 어디 있는지 찾기", "Explore"]]], 3000);
    await waitStatuses(["작업 중"], 2000);
    // 설명을 알 수 없는 하위 에이전트는 종류만 보인다
    await press("4");
    await waitSubRows([[["로그인 코드가 어디 있는지 찾기", "Explore"], ["general-purpose", null]]], 3000);

    // 하위 에이전트 줄은 터미널 줄 아래에 들여 써서 보이고, 터미널 줄 자체의 높이는 그대로다
    const layout = await page.locator(".agentrow").first().evaluate((item) => {
      const select = item.querySelector(".agentrow__select").getBoundingClientRect();
      const subs = [...item.querySelectorAll(".subagent")].map((sub) => sub.getBoundingClientRect());
      const dot = getComputedStyle(item.querySelector(".subagent__dot"));
      return {
        below: subs.every((sub) => sub.top >= select.bottom - 1),
        indented: subs.every((sub) => sub.left > select.left),
        stacked: subs[1].top >= subs[0].bottom - 1,
        animation: dot.animationName,
        selectHeight: select.height,
      };
    });
    assert.deepEqual({ ...layout, selectHeight: undefined }, { below: true, indented: true, stacked: true, animation: "agent-working", selectHeight: undefined });
    assert.equal(layout.selectHeight, before.height);
    assert.equal(await page.getByRole("list", { name: "cmd 1의 하위 에이전트" }).getByRole("listitem").count(), 2);
    app.screenshot("AC1-sub-agents.png");

    await press("5");
    await waitSubRows([[["general-purpose", null]]], 3000);
    // 답을 마쳤다고 해도(7) 하위 에이전트가 남아 있으면... 뒤에서 도는 것이 없다고 했으므로 함께 치운다
    await press("6");
    await waitSubRows([[]], 3000);
    await press("7");
    await waitStatuses(["입력 대기"], 2000);
  });

  test("AC1 하위 에이전트는 그것을 부린 터미널의 줄에만 붙는다", async () => {
    await page.getByRole("button", { name: "새 터미널" }).click();
    await waitStatuses(["입력 대기", null]);
    await row(0).click();
    await press("3");
    await waitSubRows([[[ "Explore", null ]], []], 3000);
    await press("5");
    await waitSubRows([[], []], 3000);
  });

  test("AC7 사이드바가 가장 좁을 때(180px)도 하위 에이전트 줄이 줄 밖으로 넘치지 않는다", async () => {
    await press("2");
    await press("3");
    await waitSubRows([[["로그인 코드가 어디 있는지 찾기", "Explore"]], []], 3000);
    const sidebar = await page.locator(".sidebar").boundingBox();
    await page.mouse.move(sidebar.x + sidebar.width, sidebar.y + sidebar.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, sidebar.y + sidebar.height / 2 + 20, { steps: 6 });
    await page.mouse.up();
    assert.equal((await page.locator(".sidebar").boundingBox()).width, 180);
    const fit = await page.locator(".agentrow").first().evaluate((item) => {
      const rowBox = item.getBoundingClientRect();
      const sub = item.querySelector(".subagent").getBoundingClientRect();
      const kind = item.querySelector(".subagent__kind").getBoundingClientRect();
      return { inside: sub.left >= rowBox.left && sub.right <= rowBox.right + 1, kindInside: kind.right <= rowBox.right + 1, noScroll: item.scrollWidth <= item.clientWidth };
    });
    assert.deepEqual(fit, { inside: true, kindInside: true, noScroll: true });
    // 잘린 설명은 말풍선으로 다 볼 수 있다
    assert.equal(await page.locator(".subagent").first().getAttribute("title"), "로그인 코드가 어디 있는지 찾기");
    app.screenshot("AC7-narrow-sidebar.png");
    await page.mouse.dblclick(180, sidebar.y + sidebar.height / 2);
    await press("5");
    await waitSubRows([[], []], 3000);
  });

  test("AC5 에이전트가 허락을 물으면 허락 대기가 되고, 터미널에 답을 넣으면 풀린다", async () => {
    await press("1");
    await waitStatuses(["작업 중", null], 2000);
    await press("8");
    await waitStatuses(["허락 대기", null], 2000);
    const dot = await page.locator(".agentrow__dot").first().evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.equal(dot, "rgb(217, 164, 65)"); // --ochre
    assert.equal(await attention("alpha"), 0, "보고 있는 터미널이면 프로젝트 탭에 점이 없다");
    app.screenshot("AC5-asking.png");

    await press("y");
    await waitStatuses(["작업 중", null], 2000);
  });

  test("AC5 다른 프로젝트 탭의 에이전트가 허락을 기다리면 그 탭에 점이 표시된다", async () => {
    await press("8");
    await waitStatuses(["허락 대기", null], 2000);
    await page.getByRole("tab", { name: "beta" }).click();
    await waitStatuses([null]);
    await waitUntil(async () => (await attention("alpha")) === 1, "alpha 탭에 점이 생김", 3000);
    assert.equal(await page.getByRole("tab", { name: "alpha" }).getAttribute("aria-description"), "허락을 기다리는 에이전트가 있습니다");
    app.screenshot("AC5-project-tab-dot.png");

    await page.getByRole("tab", { name: "alpha" }).click();
    await waitStatuses(["허락 대기", null], 3000);
    assert.equal(await attention("alpha"), 0);
    await press("7");
    await waitStatuses(["입력 대기", null], 2000);
  });

  test("AC6 답하는 중에 Esc로 멈추게 하면 작업 중이 풀린다", async () => {
    await press("1");
    await press("3");
    await waitStatuses(["작업 중", null], 2000);
    await press("Escape");
    await waitStatuses(["입력 대기", null], 2000);
    await waitSubRows([[], []], 2000);
  });

  test("AC8 에이전트를 끝내면 하위 에이전트 줄과 상태가 사라진다", async () => {
    await press("3");
    await waitSubRows([[["Explore", null]], []], 3000);
    await press("Control+C");
    await waitStatuses([null, null], 3000);
    await waitSubRows([[], []], 3000);
  });
});
