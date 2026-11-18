// 실제 앱 창과 실제 셸로 터미널 이름의 인수 기준을 확인한다. 실행: npm run e2e (먼저 앱을 빌드해야 한다)
// 에이전트 대신 시험용 프로그램(claude.exe라는 이름으로 복사한 것)을 실행한다. 이 프로그램은 F2·F3·F4를 받으면 터미널 제목을 알려 준다.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

// PowerShell은 넣은 명령을 사용자의 명령 기록 파일에 남긴다. 그래서 명령 프롬프트로 띄운다
const CMD_ONLY = { VA_HIDE_SHELLS: "pwsh" };

describe("터미널 이름", () => {
  let sandbox;
  let app;
  let page;
  let alpha;
  let beta;

  /** 줄에 보이는 글자 (닫기 버튼 제외) */
  const rowTexts = () => page.locator(".agentrow__select").evaluateAll((items) => items.map((item) => item.innerText.replace(/\s*\n\s*/g, " | ").trim()));
  const rowLabels = () => page.locator(".agentrow__select").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
  const waitRows = (texts, timeoutMs = 3000) =>
    waitUntil(async () => JSON.stringify(await rowTexts()) === JSON.stringify(texts), `터미널 줄이 ${JSON.stringify(texts)}가 됨`, timeoutMs);
  const waitText = (part) =>
    waitUntil(async () => (await page.locator(".termview .xterm-rows").innerText()).includes(part), `터미널에 "${part}"가 보임`);
  const type = async (text) => {
    await page.locator(".termview").click();
    await page.keyboard.type(text);
  };
  const run = async (command) => {
    await type(command);
    await page.keyboard.press("Enter");
  };
  /** 시험용 에이전트를 실행하고 줄에 에이전트로 표시될 때까지 기다린다 */
  const startAgent = async (texts) => {
    await run(".\\claude.exe");
    await waitText("FAKE AGENT READY");
    await waitRows(texts);
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
    await waitText(">");
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC1 에이전트를 실행하지 않은 동안에는 셸에 넣는 명령으로 이름이 바뀌지 않는다", async () => {
    assert.deepEqual(await rowTexts(), ["cmd 1"]);
    await run("echo hello there");
    await waitText("hello there");
    await run("title Not A Topic");
    await run("echo done-1");
    await waitText("done-1");
    assert.deepEqual(await rowTexts(), ["cmd 1"]);
  });

  test("AC1 AC4 에이전트를 실행한 직후에는 에이전트 이름만 표시된다. 실행 명령과 에이전트가 보낸 자기 이름은 이름이 되지 않는다", async () => {
    await startAgent(["Claude Code | cmd 1"]);
    assert.deepEqual(await rowLabels(), ["cmd 1, Claude Code 실행 중"]);
  });

  test("AC2 AC5 첫 질문을 넣고 Enter를 누르면 3초 안에 그 질문이 줄 이름이 되고, 에이전트와 터미널 이름이 함께 보인다", async () => {
    await type("로그인이 안 돼요  고쳐 주세요");
    assert.deepEqual(await rowTexts(), ["Claude Code | cmd 1"], "보내기 전에는 바뀌지 않는다");
    await page.keyboard.press("Enter");
    await waitRows(["로그인이 안 돼요 고쳐 주세요 | Claude Code · cmd 1"]);
    assert.equal(await page.locator(".agentrow__dot--running").count(), 1);
    app.screenshot("AC2-AC5-first-question-name.png");
  });

  test("AC9 /로 시작하는 에이전트 명령과 빈 입력, 다음 질문으로는 이름이 바뀌지 않는다", async () => {
    await page.keyboard.press("Enter");
    await type("/help");
    await page.keyboard.press("Enter");
    await type("another message");
    await page.keyboard.press("Enter");
    await waitText("last key: ENTER");
    assert.deepEqual(await rowTexts(), ["로그인이 안 돼요 고쳐 주세요 | Claude Code · cmd 1"]);
  });

  test("AC3 에이전트가 주제를 터미널 제목으로 알려 주면 3초 안에 주제가 이름이 되고, 주제가 바뀌면 따라 바뀐다", async () => {
    await page.keyboard.press("F2");
    await waitRows(["Fix login error | Claude Code · cmd 1"]);
    app.screenshot("AC3-topic-name.png");
    await page.keyboard.press("F3");
    await waitRows(["Translate README | Claude Code · cmd 1"]);
  });

  test("AC4 주제가 아닌 제목(폴더 경로)은 이름으로 쓰지 않는다", async () => {
    await page.keyboard.press("F4");
    await page.keyboard.press("ArrowUp");
    await waitText("last key: UP");
    assert.deepEqual(await rowTexts(), ["Translate README | Claude Code · cmd 1"]);
  });

  test("AC10 닫기 버튼과 읽어 주는 이름은 계속 터미널의 원래 이름으로 가리킨다", async () => {
    assert.deepEqual(await rowLabels(), ["cmd 1, Claude Code 실행 중"]);
    assert.equal(await page.getByRole("button", { name: "cmd 1 닫기" }).count(), 1);
  });

  test("AC6 AC8 이름이 길면 줄 끝에서 잘리고 마우스를 올리면 전체가 보인다. 터미널마다 제 이름을 갖는다", async () => {
    await page.getByRole("button", { name: "새 터미널" }).click();
    await waitRows(["Translate README | Claude Code · cmd 1", "cmd 2"]);
    await waitText(">");
    await startAgent(["Translate README | Claude Code · cmd 1", "Claude Code | cmd 2"]);
    const long = "아주 긴 이름이 되는 첫 질문입니다 ".repeat(6).trim();
    await type(long);
    await page.keyboard.press("Enter");
    await waitRows(["Translate README | Claude Code · cmd 1", `${long} | Claude Code · cmd 2`]);

    const sizes = await page.locator(".agentrow").evaluateAll((items) =>
      items.map((item) => {
        const title = item.querySelector(".agentrow__title");
        return { height: item.getBoundingClientRect().height, cut: title.scrollWidth > title.clientWidth, overflow: getComputedStyle(title).textOverflow };
      }),
    );
    assert.equal(sizes[0].cut, false, "짧은 이름은 잘리지 않는다");
    assert.equal(sizes[1].cut, true, "긴 이름은 줄 끝에서 잘린다");
    assert.equal(sizes[1].overflow, "ellipsis");
    assert.equal(sizes[1].height, sizes[0].height, "긴 이름이어도 줄의 높이는 같다");
    assert.equal(await page.locator(".agentrow__select").nth(1).getAttribute("title"), long);
    const sidebar = await page.locator(".sidebar").evaluate((element) => element.scrollWidth - element.clientWidth);
    assert.equal(sidebar, 0, "사이드바가 옆으로 넘치지 않는다");
    app.screenshot("AC6-long-name.png");
  });

  test("AC8 다른 터미널과 다른 프로젝트 탭을 보고 온 뒤에도 이름이 표시되어 있다", async () => {
    await page.locator(".agentrow__select").first().click();
    await page.getByRole("tab", { name: "beta" }).click();
    await waitRows(["cmd 1"], 8000);
    await page.getByRole("tab", { name: "alpha" }).click();
    await waitUntil(async () => (await rowTexts())[0] === "Translate README | Claude Code · cmd 1" && (await rowTexts()).length === 2, "돌아오면 이름이 그대로임");
  });

  test("AC7 에이전트를 끝내면 3초 안에 원래 이름으로 돌아가고, 다시 실행하면 이름이 새로 정해진다", async () => {
    await page.locator(".agentrow__select").first().click();
    await page.locator(".termview").click();
    await page.keyboard.press("Control+C");
    await waitUntil(async () => (await rowTexts())[0] === "cmd 1", "첫째 줄이 터미널의 원래 이름으로 돌아감", 3000);

    await run(".\\claude.exe");
    await waitText("FAKE AGENT READY");
    await waitUntil(async () => (await rowTexts())[0] === "Claude Code | cmd 1", "다시 실행한 직후에는 에이전트 이름만 보임", 3000);
    await type("second talk");
    await page.keyboard.press("Enter");
    await waitUntil(async () => (await rowTexts())[0] === "second talk | Claude Code · cmd 1", "새 첫 질문이 이름이 됨", 3000);
  });
});
