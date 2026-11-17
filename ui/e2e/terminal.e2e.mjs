// 실제 앱 창과 실제 셸로 터미널의 인수 기준을 확인한다. 실행: npm run e2e (먼저 앱을 빌드해야 한다)
// 입력은 화면 안으로 넣어 주는 방식이다. 사용자의 실제 키보드·마우스 입력과 실제 클립보드는 terminal-real.e2e.mjs가 따로 확인한다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createSandbox, descendants, launchApp, stillRunning, waitUntil } from "./harness.mjs";

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/** 터미널을 다루는 도구 모음 */
function tools(app) {
  const { page } = app;
  const rows = () => page.locator(".agentrow__select");
  return {
    rowLabels: () => rows().evaluateAll((items) => items.map((item) => item.getAttribute("aria-label"))),
    row: (name) => page.locator(`.agentrow__select[aria-label="${name}"]`),
    selected: () => page.locator('.agentrow__select[aria-current="true"]').getAttribute("aria-label"),
    waitRows: (labels) =>
      waitUntil(
        async () => JSON.stringify(await rows().evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")))) === JSON.stringify(labels),
        `터미널 줄이 ${JSON.stringify(labels)}가 됨`,
      ),
    /** 작업 영역에 보이는 터미널의 글자 */
    text: () => page.locator(".termview .xterm-rows").innerText(),
    waitText: (part, timeoutMs = 8000) =>
      waitUntil(async () => (await page.locator(".termview .xterm-rows").innerText()).includes(part), `터미널에 "${part}"가 보임`, timeoutMs),
    /** 터미널을 누르고 명령을 넣는다 */
    async run(command) {
      await page.locator(".termview").click();
      await page.keyboard.type(command);
      await page.keyboard.press("Enter");
    },
    async key(name) {
      await page.keyboard.press(name);
    },
    newTerminal: () => page.getByRole("button", { name: "새 터미널" }).click(),
    dialog: () => page.getByRole("alertdialog", { name: "닫기 확인" }),
  };
}

// PowerShell은 넣은 명령을 사용자의 명령 기록 파일에 남긴다. 그래서 명령을 넣는 테스트는 PowerShell 7이 없는 컴퓨터처럼 띄워 명령 프롬프트를 쓴다
const CMD_ONLY = { VA_HIDE_SHELLS: "pwsh" };

describe("터미널", () => {
  let sandbox;
  let app;
  let page;
  let term;
  let alpha;
  let beta;

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    beta = sandbox.project("beta");
    sandbox.fakeAgent(alpha, "claude.exe");
    sandbox.fakeAgent(alpha, "codex.exe");
    sandbox.seedSettings([alpha, beta]);
    app = await launchApp(sandbox, CMD_ONLY);
    page = app.page;
    page.setDefaultTimeout(8000);
    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 1280, 820);
    term = tools(app);
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC1 AC14 프로젝트 탭을 열면 터미널 하나가 그 폴더에서 떠 있고, 에이전트 칸에 한 줄이 있다", async () => {
    await term.waitRows(["cmd 1"]);
    assert.equal(await term.selected(), "cmd 1");
    await term.waitText(`${alpha}>`);

    await term.run("echo %CD%> where.txt");
    await waitUntil(() => read(join(alpha, "where.txt")).trim() === alpha, "터미널의 시작 위치가 프로젝트 폴더임");
    app.screenshot("AC1-terminal-on-open.png");
  });

  test("AC4-반대 보지 않은 탭의 터미널은 아직 뜨지 않았다 (AS4)", async () => {
    const shells = descendants(app.pid).filter((item) => item.name === "cmd.exe");
    assert.equal(shells.length, 1, "떠 있는 셸은 지금 보고 있는 탭의 것 하나뿐이다");
  });

  test("AC5 AC6 AC13 명령의 결과가 표시되고, 한글이 깨지지 않으며, 만든 파일이 파일 칸에 나타난다", async () => {
    await term.run("echo 결과는 한글입니다");
    await term.waitText("결과는 한글입니다\n");

    await term.run("echo 내용> 한글파일.txt");
    await page.locator('[role=treeitem][data-path="한글파일.txt"]').waitFor({ timeout: 3000 });
    await term.run("dir /b");
    await waitUntil(async () => (await term.text()).split("\n").some((line) => line.trim() === "한글파일.txt"), "한글 파일 이름이 목록에 바르게 보임");
    app.screenshot("AC6-korean.png");

    await term.run("del 한글파일.txt");
    await page.locator('[role=treeitem][data-path="한글파일.txt"]').waitFor({ state: "detached", timeout: 3000 });
  });

  test("AC12 터미널은 글자 폭이 같은 글꼴과 기린 테마 색으로 그려진다", async () => {
    const style = await page.evaluate(() => {
      const rowsStyle = getComputedStyle(document.querySelector(".termview .xterm-rows"));
      const widths = ["i", "W", "0"].map((char) => {
        const probe = document.createElement("span");
        probe.style.fontFamily = rowsStyle.fontFamily;
        probe.style.fontSize = rowsStyle.fontSize;
        probe.style.position = "absolute";
        probe.textContent = char.repeat(20);
        document.body.appendChild(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return width;
      });
      return {
        font: rowsStyle.fontFamily,
        widths,
        background: getComputedStyle(document.querySelector(".termview .xterm-scrollable-element")).backgroundColor,
        text: rowsStyle.color,
      };
    });
    assert.match(style.font, /Cascadia Mono|Consolas/);
    assert.equal(new Set(style.widths).size, 1, `i, W, 0의 폭이 같다: ${style.widths}`);
    assert.equal(style.background, "rgb(30, 26, 22)"); // --bg-1
    assert.equal(style.text, "rgb(233, 223, 201)"); // --text-1
  });

  test("AC7 AC21 화면 전체를 쓰는 프로그램이 색·테두리까지 바르게 그려지고, 키가 전달되며, 에이전트로 표시된다", async () => {
    await term.run(".\\claude.exe keys.log");
    await term.waitText("FAKE AGENT READY");
    // 3초 안에 줄에 에이전트 이름이 나타난다
    await waitUntil(async () => (await term.rowLabels())[0] === "cmd 1, Claude Code 실행 중", "줄에 Claude Code가 표시됨", 3000);
    assert.equal(await page.locator(".agentrow__dot--running").count(), 1);

    const lines = (await term.text()).split("\n");
    assert.equal(lines[0], `┌${"─".repeat(30)}┐`, "테두리 윗줄");
    assert.equal(lines[1].trimEnd(), "  FAKE AGENT READY", "둘째 줄의 글자가 셋째 칸에서 시작한다");
    assert.equal(lines[4], `└${"─".repeat(30)}┘`, "테두리 아랫줄");
    // 다른 화면으로 바뀌었으므로 앞서 친 명령은 보이지 않는다
    assert.ok(!lines.join("\n").includes("where.txt"));

    const colors = await page.evaluate(() => {
      const spans = [...document.querySelectorAll(".termview .xterm-rows span")];
      const colorOf = (text) => getComputedStyle(spans.find((span) => span.textContent.includes(text))).color;
      return { ready: colorOf("FAKE AGENT READY"), border: colorOf("┌") };
    });
    assert.equal(colors.ready, "rgb(143, 166, 90)"); // --term-green
    assert.equal(colors.border, "rgb(217, 164, 65)"); // --term-yellow
    app.screenshot("AC7-AC21-full-screen-agent.png");

    await term.key("ArrowUp");
    await term.waitText("last key: UP");
    await term.key("ArrowDown");
    await term.waitText("last key: DOWN");
    await term.key("Enter");
    await term.waitText("last key: ENTER");
    await term.key("Escape");
    await term.waitText("last key: ESC");
  });

  test("AC8 앱 창 크기를 바꾸면 터미널이 다시 맞춰지고, 안의 프로그램이 새 크기를 안다", async () => {
    // 화면을 다시 그리는 순간에는 글자가 잠깐 비어 있을 수 있어, 보일 때까지 기다린다
    const sizeOf = () =>
      waitUntil(async () => (await term.text()).match(/size\s+(\d+)x(\d+)/)?.slice(1).map(Number), "프로그램이 아는 크기가 보임");
    const [columns, rows] = await sizeOf();
    assert.ok(columns > 100 && rows > 30, `처음 크기 ${columns}x${rows}`);

    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 900, 600);
    // 시험용 프로그램은 키를 받을 때마다 크기를 다시 적는다
    await waitUntil(async () => {
      await term.key("r");
      const [nowColumns, nowRows] = await sizeOf();
      return nowColumns < columns && nowRows < rows;
    }, "터미널이 작아진 크기를 앎");

    const [smallColumns] = await sizeOf();
    const fits = await page.evaluate(() => {
      const view = document.querySelector(".termview").getBoundingClientRect();
      const screen = document.querySelector(".termview .xterm-screen").getBoundingClientRect();
      return { view: view.width, screen: screen.width };
    });
    assert.ok(fits.screen <= fits.view, "글자 화면이 작업 영역 안에 들어간다");
    assert.ok(fits.view - fits.screen < 40, "남는 폭이 글자 두세 개보다 작다");
    assert.ok(smallColumns > 50);

    app.place(work.left + 60, work.top + 40, 1280, 820);
    await waitUntil(async () => {
      await term.key("r");
      return (await sizeOf())[0] === columns;
    }, "원래 크기로 돌아옴");
  });

  test("AC7 AC22 Ctrl+C가 프로그램에 전달되어 에이전트가 끝나면, 줄에서 이름이 사라지고 원래 화면으로 돌아온다", async () => {
    await page.keyboard.press("Control+C");
    await waitUntil(async () => (await term.rowLabels())[0] === "cmd 1", "줄이 셸 이름으로 돌아옴", 3000);
    assert.equal(await page.locator(".agentrow__dot--running").count(), 0);
    await term.waitText("where.txt");
    assert.ok(!(await term.text()).includes("FAKE AGENT READY"));
    assert.deepEqual(read(join(alpha, "keys.log")).split("\n").filter((line) => line !== "r"), ["UP", "DOWN", "ENTER", "ESC", "CTRL+C", ""]);
  });

  test("AC10 선택한 글자가 없을 때의 Ctrl+C는 실행 중인 프로그램을 멈춘다", async () => {
    await term.run("ping -n 300 127.0.0.1 > nul & echo finished> ping-done.txt");
    await waitUntil(() => descendants(app.pid).some((item) => item.name === "ping.exe"), "ping이 실행 중");
    await page.keyboard.press("Control+C");
    await waitUntil(() => !descendants(app.pid).some((item) => item.name === "ping.exe"), "ping이 멈춤");
    await term.run("echo after> after.txt");
    await waitUntil(() => existsSync(join(alpha, "after.txt")), "멈춘 뒤 다음 명령이 실행됨");
  });

  test("AC10 글자를 끌어 선택하고 Ctrl+C를 누르면 복사되고, 붙여넣은 글자는 터미널에 들어간다", async () => {
    // 실제 클립보드는 건드리지 않고, 화면이 클립보드에 쓰려는 내용만 받아 둔다 (실제 클립보드는 terminal-real.e2e.mjs)
    await page.evaluate(() => {
      window.copied = [];
      navigator.clipboard.writeText = async (text) => {
        window.copied.push(text);
      };
    });
    await term.run("cls");
    await term.run("echo COPY-THIS-TOKEN");
    await term.waitText("\nCOPY-THIS-TOKEN");

    const line = page.locator(".termview .xterm-rows > div", { hasText: /^COPY-THIS-TOKEN\s*$/ });
    const box = await line.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Control+C");
    await waitUntil(() => page.evaluate(() => window.copied.length === 1), "복사됨");
    assert.equal(await page.evaluate(() => window.copied[0]), "COPY-THIS-TOKEN");
    // 복사한 Ctrl+C는 멈춤 신호로 넘어가지 않았다 (^C가 찍히지 않음)
    assert.ok(!(await term.text()).includes("^C"));

    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "echo pasted> pasted.txt\r\n");
      document.querySelector(".termview textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await waitUntil(() => read(join(alpha, "pasted.txt")).trim() === "pasted", "붙여넣은 명령이 실행됨");
  });

  test("AC9 지난 출력은 위로 스크롤해 다시 볼 수 있고, 최근 5,000줄까지 남는다", async () => {
    await term.run("cls");
    await term.run("for /L %i in (1,1,6000) do @echo line-%i");
    await term.waitText("line-6000", 60000);

    const box = await page.locator(".termview").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await waitUntil(async () => !(await term.text()).includes("line-6000"), "위로 스크롤하면 앞의 출력이 보임");

    // 스크롤 막대를 맨 위까지 끌어 올린다
    const slider = await page.locator(".termview .scrollbar.vertical .slider").boundingBox();
    await page.mouse.move(slider.x + slider.width / 2, slider.y + slider.height / 2);
    await page.mouse.down();
    await page.mouse.move(slider.x + slider.width / 2, box.y - 200, { steps: 10 });
    await page.mouse.up();
    const top = await waitUntil(async () => {
      const first = (await term.text()).split("\n")[0].trim();
      const number = /^line-\d+$/.test(first) ? Number(first.slice(5)) : 0;
      return number > 0 && number < 3000 ? number : 0;
    }, "맨 위까지 스크롤됨");
    // 6,000줄 가운데 최근 5,000줄과 화면에 보이던 줄만 남는다
    assert.ok(top > 900 && top < 1010, `맨 위에 남은 줄: line-${top}`);
    app.screenshot("AC9-scrolled-to-top.png");
    await term.run("cls");
  });

  test("AC15 AC16 AC23 새 터미널(+)로 하나 더 띄우고, 줄을 눌러 오가면 가려져 있던 동안의 출력도 보인다", async () => {
    await term.run("cls");
    await term.newTerminal();
    await term.waitRows(["cmd 1", "cmd 2"]);
    assert.equal(await term.selected(), "cmd 2");
    await term.waitText(`${alpha}>`);
    assert.ok(!(await term.text()).includes("line-6000"), "새 터미널에는 앞 터미널의 내용이 없다");

    // 두 번째 터미널에서 Codex를 실행해 둔다. 첫 번째 터미널에는 표시가 없다
    await term.run(".\\codex.exe");
    await term.waitText("FAKE AGENT READY");
    await term.waitRows(["cmd 1", "cmd 2, Codex 실행 중"]);
    app.screenshot("AC14-AC23-two-terminals.png");

    // 첫 번째 터미널로 가서 3초 뒤에 출력이 나오는 명령을 넣고 바로 두 번째로 돌아온다
    await term.row("cmd 1").click();
    assert.equal(await term.selected(), "cmd 1");
    await term.run("ping -n 3 127.0.0.1 > nul & echo hidden-output-arrived");
    await term.row("cmd 2, Codex 실행 중").click();
    await term.waitText("FAKE AGENT READY");
    assert.ok(!(await term.text()).includes("hidden-output"));

    await waitUntil(() => !descendants(app.pid).some((item) => item.name === "ping.exe"), "가려진 터미널의 명령이 끝남", 15000);
    await term.row("cmd 1").click();
    await term.waitText("\nhidden-output-arrived", 3000);
  });

  test("AC20 AC2-일부 프로젝트 탭을 바꾸면 그 프로젝트의 터미널로 바뀌고, 다른 탭의 터미널은 계속 실행되며, 돌아오면 그대로다", async () => {
    await page.getByRole("tab", { name: "beta" }).click();
    // beta 탭을 처음 보는 순간 터미널 하나가 뜬다
    await term.waitRows(["cmd 1"]);
    await term.waitText(`${beta}>`);
    await term.run("echo %CD%> where.txt");
    await waitUntil(() => read(join(beta, "where.txt")).trim() === beta, "beta의 터미널은 beta 폴더에서 시작함");
    assert.ok(descendants(app.pid).some((item) => item.name === "codex.exe"), "alpha 탭의 에이전트는 계속 실행 중이다");

    await page.getByRole("tab", { name: "alpha" }).click();
    await term.waitRows(["cmd 1", "cmd 2, Codex 실행 중"]);
    assert.equal(await term.selected(), "cmd 1");
    await term.waitText("hidden-output-arrived");
    await term.row("cmd 2, Codex 실행 중").click();
    await term.waitText("FAKE AGENT READY");

    // 다시 가도 beta의 터미널이 또 뜨지 않는다
    await page.getByRole("tab", { name: "beta" }).click();
    await term.waitRows(["cmd 1"]);
    await term.waitText("where.txt");
    await page.getByRole("tab", { name: "alpha" }).click();
    await term.waitRows(["cmd 1", "cmd 2, Codex 실행 중"]);
  });

  test("AC11 10만 줄이 한꺼번에 출력되어도 앱이 멈추지 않고, 도중에 프로젝트 탭을 바꿀 수 있다", async () => {
    await term.row("cmd 1").click();
    await term.run("cls");
    await term.run("for /L %i in (1,1,100000) do @echo row-%i");
    await term.waitText("row-", 5000);

    // 출력이 쏟아지는 동안 탭을 바꾸고 돌아온다
    let slowest = 0;
    for (const name of ["beta", "alpha", "beta", "alpha"]) {
      const started = Date.now();
      await page.getByRole("tab", { name }).click();
      await waitUntil(async () => (await page.locator("[role=tab][aria-selected=true]").textContent()) === name, `${name} 탭으로 바뀜`, 3000);
      slowest = Math.max(slowest, Date.now() - started);
    }
    assert.ok(slowest < 1500, `탭 전환에 가장 오래 걸린 시간 ${slowest}ms`);
    assert.ok(!(await term.text()).includes("row-100000"), "탭을 바꾸는 동안에도 출력은 아직 진행 중이었다");

    await term.waitText("row-100000", 180000);
    const lines = (await term.text()).split("\n").map((line) => line.trim()).filter((line) => line.startsWith("row-"));
    assert.equal(lines.at(-1), "row-100000");
    assert.equal(lines.at(-2), "row-99999", "마지막 줄들이 빠짐없이 차례로 있다");
  });

  test("AC17 실행 중인 프로그램이 있는 터미널의 닫기(×)는 확인 창을 먼저 띄우고, 확인하면 프로그램도 끝난다", async () => {
    const agent = descendants(app.pid).filter((item) => item.name === "codex.exe");
    assert.equal(agent.length, 1);

    await page.getByRole("button", { name: "cmd 2 닫기" }).click();
    await term.dialog().waitFor();
    assert.equal(await term.dialog().locator(".dialog__text").innerText(), "실행 중인 프로그램이 있습니다. 닫으면 종료됩니다");
    app.screenshot("AC17-close-confirm.png");

    await term.dialog().getByRole("button", { name: "취소" }).click();
    await term.dialog().waitFor({ state: "detached" });
    assert.deepEqual(await term.rowLabels(), ["cmd 1", "cmd 2, Codex 실행 중"]);
    assert.equal(stillRunning(agent).length, 1);

    await page.getByRole("button", { name: "cmd 2 닫기" }).click();
    await term.dialog().getByRole("button", { name: "닫기" }).click();
    await term.waitRows(["cmd 1"]);
    await waitUntil(() => stillRunning(agent).length === 0, "터미널에서 돌던 프로그램이 끝남");
    assert.equal(await term.selected(), "cmd 1");
  });

  test("AC18 AC19 exit로 셸이 끝나면 터미널이 닫히고, 하나도 없으면 안내와 새 터미널 버튼이 표시된다", async () => {
    await term.run("exit");
    await term.waitRows([]);
    await waitUntil(async () => (await page.locator(".workarea").innerText()).includes("터미널이 없습니다"), "작업 영역에 안내가 표시됨");
    assert.equal(await page.getByRole("region", { name: "에이전트 칸" }).locator(".pane__empty").innerText(), "터미널이 없습니다");
    app.screenshot("AC19-no-terminal.png");

    // 다른 탭에 다녀와도 저절로 다시 뜨지 않는다 (AS6)
    await page.getByRole("tab", { name: "beta" }).click();
    await term.waitRows(["cmd 1"]);
    await page.getByRole("tab", { name: "alpha" }).click();
    await term.waitRows([]);

    await page.locator(".workarea").getByRole("button", { name: "새 터미널" }).click();
    await term.waitRows(["cmd 1"]);
    await term.waitText(`${alpha}>`);
  });

  test("AC24 셸을 고르는 버튼과 목록은 없다. AC2 앱을 다시 켜면 탭마다 새 터미널 하나만 뜬다", async () => {
    assert.equal(await page.getByRole("button", { name: "셸 고르기" }).count(), 0);
    assert.equal(await page.getByRole("menu").count(), 0);

    await term.newTerminal();
    await term.newTerminal();
    await term.waitRows(["cmd 1", "cmd 2", "cmd 3"]);
    const before = descendants(app.pid);

    await app.close();
    assert.equal(stillRunning(before).length, 0, "앱을 닫으면 터미널의 셸이 모두 끝난다");

    app = await launchApp(sandbox, CMD_ONLY);
    page = app.page;
    page.setDefaultTimeout(8000);
    term = tools(app);
    // 터미널 세 개를 띄워 둔 채 닫았지만, 다시 켜면 새 터미널 하나만 뜬다. 이전 내용은 없다
    await term.waitRows(["cmd 1"]);
    await term.waitText(`${alpha}>`);
    assert.ok(!(await term.text()).includes("row-100000"));
  });

  test("AC30 열쇠 없이는 터미널에 글자를 넣거나 내용을 읽을 수 없다", async () => {
    const statuses = await page.evaluate(async () => {
      const post = (path, body, headers = {}) =>
        window.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }).then((response) => response.status);
      return {
        input: await post("/api/terminals/p1/input", { data: "echo hacked> hacked.txt\r" }),
        events: await post("/api/terminals/events", { version: 0 }),
        open: await post("/api/tabs/t1/terminals", {}),
        close: await post("/api/terminals/p1/close", { force: true }),
        quit: await post("/api/app/quit", { confirm: true }),
        wrongKey: await post("/api/terminals/events", { version: 0 }, { "X-VA-Token": "guess" }),
      };
    });
    assert.deepEqual(statuses, { input: 401, events: 401, open: 401, close: 401, quit: 401, wrongKey: 401 });
    assert.equal(existsSync(join(alpha, "hacked.txt")), false);
    assert.deepEqual(await term.rowLabels(), ["cmd 1"]);
    assert.equal(app.exited(), false);
  });
});

describe("터미널: 뜨는 셸", () => {
  let sandbox;
  let app;
  let alpha;

  const open = async (extraEnv, settings = {}) => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    sandbox.seedSettings([alpha], settings);
    app = await launchApp(sandbox, extraEnv);
    app.page.setDefaultTimeout(8000);
    return tools(app);
  };
  const shellNames = () => descendants(app.pid).map((item) => item.name);

  const close = async () => {
    await app?.close();
    sandbox?.dispose();
    app = undefined;
  };
  after(close);

  test("AC3 터미널은 PowerShell 7로 뜬다", async () => {
    const term = await open({});
    await term.waitRows(["PowerShell 1"]);
    await term.waitText(`PS ${alpha}>`, 15000);
    assert.ok(shellNames().includes("pwsh.exe"), `실행된 셸: ${shellNames()}`);
    app.screenshot("AC3-powershell-7.png");
    await close();
  });

  test("AC3 PowerShell 7이 없는 컴퓨터에서는 명령 프롬프트가 뜬다", async () => {
    const term = await open({ VA_HIDE_SHELLS: "pwsh" });
    await term.waitRows(["cmd 1"]);
    await term.waitText(`${alpha}>`);
    assert.ok(shellNames().includes("cmd.exe"), `실행된 셸: ${shellNames()}`);
    assert.ok(!shellNames().includes("pwsh.exe"));
    await term.newTerminal();
    await term.waitRows(["cmd 1", "cmd 2"]);
    app.screenshot("AC3-cmd-fallback.png");
    await close();
  });

  test("AC26 예전 설정 파일에 기본 셸이 적혀 있어도 PowerShell 7로 뜨고, 탭은 그대로 열린다", async () => {
    const term = await open({}, { defaultShell: "cmd" });
    await term.waitRows(["PowerShell 1"]);
    assert.ok(shellNames().includes("pwsh.exe"));
    assert.equal(await app.page.getByRole("tab", { name: "alpha" }).count(), 1);
    await close();
  });

  test("AC27 띄울 셸이 하나도 없으면 작업 영역에 이유가 표시된다", async () => {
    const term = await open({ VA_HIDE_SHELLS: "pwsh,cmd" });
    await app.page.locator(".workarea [role=alert]").waitFor();
    assert.equal(
      await app.page.locator(".workarea [role=alert]").innerText(),
      "터미널을 띄우지 못했습니다: 이 컴퓨터에서 쓸 수 있는 셸을 찾지 못했습니다",
    );
    assert.deepEqual(await term.rowLabels(), []);
    app.screenshot("AC27-no-shell.png");
    await close();
  });

  test("AC4 폴더를 찾을 수 없는 프로젝트 탭에서는 터미널이 뜨지 않는다", async () => {
    sandbox = createSandbox();
    sandbox.seedSettings([join(sandbox.root, "projects", "gone")]);
    app = await launchApp(sandbox, CMD_ONLY);
    await waitUntil(async () => (await app.page.locator(".workarea").innerText()).includes("폴더를 찾을 수 없습니다"), "없어진 폴더 안내가 표시됨");
    assert.equal(await app.page.locator(".agentrow").count(), 0);
    assert.equal(await app.page.getByRole("button", { name: "새 터미널" }).count(), 0);
    assert.deepEqual(descendants(app.pid), []);
    await close();
  });
});

describe("터미널: 닫을 때", () => {
  let sandbox;
  let app;
  let page;
  let term;
  let alpha;
  let beta;

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    beta = sandbox.project("beta");
    sandbox.fakeAgent(alpha, "claude.exe");
    sandbox.seedSettings([alpha, beta]);
    app = await launchApp(sandbox, CMD_ONLY);
    page = app.page;
    page.setDefaultTimeout(8000);
    term = tools(app);
    await term.waitRows(["cmd 1"]);
    await term.waitText(`${alpha}>`);
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC28 실행 중인 프로그램이 있는 프로젝트 탭을 닫으려 하면 확인 창이 뜨고, 취소하면 닫히지 않는다", async () => {
    await term.run(".\\claude.exe");
    await term.waitRows(["cmd 1, Claude Code 실행 중"]);

    await page.getByRole("button", { name: "alpha 탭 닫기" }).click();
    await term.dialog().waitFor();
    await term.dialog().getByRole("button", { name: "취소" }).click();
    await term.dialog().waitFor({ state: "detached" });
    assert.deepEqual(await page.locator("[role=tab]").allTextContents(), ["alpha", "beta"]);
    assert.ok(descendants(app.pid).some((item) => item.name === "claude.exe"));
  });

  test("AC28 실행 중인 프로그램이 있을 때 앱을 닫으려 하면 확인 창이 뜨고, 취소하면 닫히지 않는다", async () => {
    app.requestClose();
    await term.dialog().waitFor();
    assert.equal(await term.dialog().locator(".dialog__text").innerText(), "실행 중인 프로그램이 있습니다. 닫으면 종료됩니다");
    app.screenshot("AC28-quit-confirm.png");

    await term.dialog().getByRole("button", { name: "취소" }).click();
    await term.dialog().waitFor({ state: "detached" });
    await new Promise((done) => setTimeout(done, 1000));
    assert.equal(app.exited(), false, "취소하면 앱이 닫히지 않는다");
    assert.ok(descendants(app.pid).some((item) => item.name === "claude.exe"));
  });

  test("AC28 AC29 프로젝트 탭 닫기를 확인하면 그 탭의 터미널에서 돌던 것이 모두 끝난다", async () => {
    await page.getByRole("tab", { name: "beta" }).click();
    await term.waitRows(["cmd 1"]);
    const all = descendants(app.pid);
    assert.equal(all.filter((item) => item.name === "cmd.exe").length, 2);

    await page.getByRole("button", { name: "alpha 탭 닫기" }).click();
    await term.dialog().getByRole("button", { name: "닫기" }).click();
    await waitUntil(async () => (await page.locator("[role=tab]").allTextContents()).join() === "beta", "alpha 탭이 닫힘");

    const rest = () => stillRunning(all).map((item) => item.name).sort().join();
    await waitUntil(() => rest() === "cmd.exe,conhost.exe", "alpha의 셸과 에이전트가 끝나고 beta의 셸만 남음");
    await term.waitRows(["cmd 1"]);
  });

  test("AC28 AC29 앱 닫기를 확인하면 앱이 끝나고, 터미널에서 돌던 셸과 프로그램이 하나도 남지 않는다", async () => {
    sandbox.fakeAgent(beta, "claude.exe");
    await term.run(".\\claude.exe");
    await term.waitRows(["cmd 1, Claude Code 실행 중"]);
    await term.newTerminal();
    await term.waitRows(["cmd 1, Claude Code 실행 중", "cmd 2"]);
    await term.run("ping -n 600 127.0.0.1");
    await waitUntil(() => descendants(app.pid).some((item) => item.name === "ping.exe"), "ping이 실행 중");
    const all = descendants(app.pid);
    assert.deepEqual(all.map((item) => item.name).sort(), ["claude.exe", "cmd.exe", "cmd.exe", "conhost.exe", "conhost.exe", "ping.exe"].sort());

    app.requestClose();
    await term.dialog().getByRole("button", { name: "닫기" }).click();
    await app.waitForExit();
    await waitUntil(() => stillRunning(all).length === 0, "터미널에서 돌던 것이 모두 끝남", 10000);
  });

  test("AC28-반대 실행 중인 프로그램이 없으면 묻지 않고 바로 닫힌다 (AS14)", async () => {
    app = await launchApp(sandbox, CMD_ONLY);
    term = tools(app);
    await term.waitRows(["cmd 1"]);
    const all = descendants(app.pid);
    app.requestClose();
    await app.waitForExit();
    await waitUntil(() => stillRunning(all).length === 0, "셸이 끝남");
  });
});
