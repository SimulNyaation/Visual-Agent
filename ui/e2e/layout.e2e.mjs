// 실제 앱 창에서 크기 조절(사이드바 너비, 에이전트 칸·파일 칸의 높이 비율)의 인수 기준을 확인한다 (SPEC-20261117-resize-panes).
// 실행: npm run e2e (먼저 앱을 빌드해야 한다). 마우스 입력은 화면 안으로 넣어 준다. 실제 커서로 하는 확인은 layout-real.e2e.mjs
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

// 명령을 넣는 테스트는 PowerShell 7이 없는 컴퓨터처럼 띄워 명령 프롬프트를 쓴다 (PowerShell은 넣은 명령을 사용자의 명령 기록 파일에 남긴다)
const CMD_ONLY = { VA_HIDE_SHELLS: "pwsh" };
const PANE_MIN = 86;

function tools(app) {
  const { page } = app;
  const box = (selector) => page.locator(selector).boundingBox();
  const sidebarSplitter = () => page.getByRole("separator", { name: "사이드바 너비 조절" });
  const paneSplitter = () => page.getByRole("separator", { name: "에이전트 칸과 파일 칸의 높이 조절" });
  return {
    sidebarSplitter,
    paneSplitter,
    sidebar: () => box(".sidebar"),
    workArea: () => box(".workarea"),
    agents: () => box('section[aria-label="에이전트 칸"]'),
    files: () => box('section[aria-label="파일 칸"]'),
    windowWidth: () => page.evaluate(() => window.innerWidth),
    /** 사이드바 경계를 가로 위치 x까지 끈다 */
    async dragSidebarTo(x) {
      const sidebar = await box(".sidebar");
      const y = sidebar.y + sidebar.height / 2;
      await page.mouse.move(sidebar.x + sidebar.width, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 40, { steps: 8 });
      await page.mouse.up();
    },
    /** 칸 경계를 세로 위치 y까지 끈다 */
    async dragPanesTo(y) {
      const files = await box('section[aria-label="파일 칸"]');
      const x = files.x + files.width / 2;
      await page.mouse.move(x, files.y + 1);
      await page.mouse.down();
      await page.mouse.move(x + 30, y, { steps: 8 });
      await page.mouse.up();
    },
    saved: (sandbox) => JSON.parse(readFileSync(join(sandbox.dataDir, "state.json"), "utf8")).layout,
  };
}

const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} (기대 ${expected} ± ${tolerance})`);

describe("크기 조절", () => {
  let sandbox;
  let app;
  let page;
  let ui;
  let alpha;
  let beta;

  const start = async () => {
    app = await launchApp(sandbox, CMD_ONLY);
    page = app.page;
    page.setDefaultTimeout(8000);
    ui = tools(app);
    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 1280, 820);
    await page.locator(".agentrow").first().waitFor();
  };

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    beta = sandbox.project("beta");
    for (const name of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt"]) writeFileSync(join(alpha, name), name);
    sandbox.fakeAgent(alpha, "claude.exe");
    sandbox.seedSettings([alpha, beta]);
    await start();
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC10-처음 값 처음에는 사이드바가 240px이고 두 칸의 높이가 같다", async () => {
    assert.equal((await ui.sidebar()).width, 240);
    near((await ui.agents()).height, (await ui.files()).height, 1, "두 칸의 높이");
  });

  test("AC1 AC5 경계에 마우스를 올리면 커서가 조절 모양으로 바뀌고 경계가 강조된다", async () => {
    const look = (locator) =>
      locator.evaluate((element) => ({
        cursor: getComputedStyle(element).cursor,
        band: getComputedStyle(element, "::after").backgroundColor,
      }));
    const ochre = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--ochre)";
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });

    const idle = await look(ui.sidebarSplitter());
    assert.equal(idle.cursor, "col-resize");
    assert.notEqual(idle.band, ochre, "올리기 전에는 강조되지 않는다");

    const sidebar = await ui.sidebar();
    await page.mouse.move(sidebar.x + sidebar.width, sidebar.y + 200);
    await waitUntil(async () => (await look(ui.sidebarSplitter())).band === ochre, "사이드바 경계가 강조됨");
    app.screenshot("AC1-sidebar-boundary-hover.png");

    assert.equal((await look(ui.paneSplitter())).cursor, "row-resize");
    const files = await ui.files();
    await page.mouse.move(files.x + 100, files.y + 1);
    await waitUntil(async () => (await look(ui.paneSplitter())).band === ochre, "칸 경계가 강조됨");
    app.screenshot("AC5-pane-boundary-hover.png");
    await page.mouse.move(files.x + 100, files.y + 60);
  });

  test("AC2 AC13 사이드바 경계를 끌면 너비가 따라 바뀌고 작업 영역이 그만큼 달라지며, 터미널 위를 지나가도 끊기지 않고 글자가 선택되지 않는다", async () => {
    const before = { sidebar: await ui.sidebar(), work: await ui.workArea() };

    // 끄는 도중에도 따라 바뀐다 (놓기 전)
    const y = before.sidebar.y + before.sidebar.height / 2;
    await page.mouse.move(before.sidebar.width, y);
    await page.mouse.down();
    await page.mouse.move(300, y, { steps: 4 });
    await waitUntil(async () => (await ui.sidebar()).width === 300, "놓기 전에 너비가 300이 됨");
    // 작업 영역의 터미널 한가운데까지 끌고 간다
    await page.mouse.move(420, y + 100, { steps: 6 });
    await page.mouse.up();

    const after = { sidebar: await ui.sidebar(), work: await ui.workArea() };
    assert.equal(after.sidebar.width, 420);
    near(after.work.width, before.work.width - 180, 1, "작업 영역 너비");
    near(after.work.x, 420, 1, "작업 영역의 왼쪽 끝");
    assert.equal(await page.evaluate(() => String(window.getSelection())), "", "끄는 동안 글자가 선택되지 않는다");
    assert.equal(await page.locator(".termview .xterm-selection div").count(), 0, "터미널의 글자도 선택되지 않는다");
    assert.equal(ui.saved(sandbox).sidebarWidth, 420);
  });

  test("AC3 사이드바는 180px보다 좁아지지 않고, 작업 영역이 320px보다 좁아질 만큼 넓어지지 않는다", async () => {
    await ui.dragSidebarTo(20);
    assert.equal((await ui.sidebar()).width, 180);

    const width = await ui.windowWidth();
    await ui.dragSidebarTo(width - 5);
    assert.equal((await ui.sidebar()).width, width - 320);
    near((await ui.workArea()).width, 320, 1, "작업 영역 너비");
    app.screenshot("AC3-sidebar-widest.png");

    // 그 상태에서 앱 창을 가장 작게 줄여도 작업 영역 320px는 남는다
    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 640, 500);
    await waitUntil(async () => (await ui.windowWidth()) <= 640, "창이 줄어듦");
    near((await ui.workArea()).width, 320, 1, "가장 작은 창에서의 작업 영역 너비");
    assert.ok((await ui.sidebar()).width >= 180);
    app.place(work.left + 60, work.top + 40, 1280, 820);
    await waitUntil(async () => (await ui.windowWidth()) > 1000, "창이 다시 커짐");

    await ui.dragSidebarTo(260);
    assert.equal((await ui.sidebar()).width, 260);
  });

  test("AC4 사이드바 너비가 바뀌면 터미널이 새 너비에 맞게 다시 맞춰진다", async () => {
    const size = async () => {
      const match = /size (\d+)x(\d+)/.exec(await page.locator(".termview .xterm-rows").innerText());
      return match ? Number(match[1]) : null;
    };
    await page.locator(".termview").click();
    await page.keyboard.type(".\\claude.exe");
    await page.keyboard.press("Enter");
    await waitUntil(async () => (await size()) !== null, "시험용 프로그램이 크기를 적음");
    const columns = await size();

    await ui.dragSidebarTo(560);
    // 시험용 프로그램은 키를 받을 때마다 크기를 다시 적는다
    const narrower = await waitUntil(async () => {
      await page.locator(".termview").click();
      await page.keyboard.press("r");
      const now = await size();
      return now !== null && now < columns ? now : null;
    }, "프로그램이 더 좁은 가로 글자 수를 받음");
    // 300px 좁아졌으므로 글자 30칸 넘게 줄어든다
    assert.ok(columns - narrower >= 30, `가로 글자 수 ${columns} → ${narrower}`);

    // 터미널이 작업 영역을 채운다 (빈 띠가 글자 두 칸 폭보다 좁다)
    const term = await page.locator(".termview").boundingBox();
    const screen = await page.locator(".termview .xterm-screen").boundingBox();
    assert.ok(screen.width <= term.width, "내용이 잘리지 않는다");
    assert.ok(term.width - screen.width < 40, `오른쪽 빈 띠 ${term.width - screen.width}px`);

    await page.keyboard.press("q");
    await ui.dragSidebarTo(260);
  });

  test("AC6 칸 경계를 위아래로 끌면 한 칸이 커지는 만큼 다른 칸이 작아진다", async () => {
    const before = { agents: await ui.agents(), files: await ui.files() };
    await ui.dragPanesTo(before.files.y - 120);
    const after = { agents: await ui.agents(), files: await ui.files() };
    near(after.agents.height, before.agents.height - 120, 2, "에이전트 칸 높이");
    near(after.files.height, before.files.height + 120, 2, "파일 칸 높이");
    near(after.agents.height + after.files.height, before.agents.height + before.files.height, 1, "두 칸 높이의 합");
    assert.ok(ui.saved(sandbox).agentShare < 0.5);
    app.screenshot("AC6-panes-resized.png");
  });

  test("AC7 어느 칸도 제목 줄과 항목 두 줄보다 작아지지 않는다", async () => {
    await ui.dragPanesTo(0);
    near((await ui.agents()).height, PANE_MIN, 1, "가장 작은 에이전트 칸");
    assert.equal(await page.locator(".agentrow").first().isVisible(), true);

    await ui.dragPanesTo(5000);
    near((await ui.files()).height, PANE_MIN, 1, "가장 작은 파일 칸");
    const files = await ui.files();
    const second = await page.locator("[role=treeitem]").nth(1).boundingBox();
    assert.ok(second.y + second.height <= files.y + files.height + 1, "파일 칸에 항목 두 줄이 보인다");
    app.screenshot("AC7-smallest-file-pane.png");
  });

  test("AC8 앱 창의 높이를 바꾸면 두 칸이 그 비율대로 함께 늘거나 줄어든다", async () => {
    const agents = await ui.agents();
    const files = await ui.files();
    await ui.dragPanesTo(agents.y + (agents.height + files.height) * 0.3);
    const share = async () => {
      const a = await ui.agents();
      const f = await ui.files();
      return { share: a.height / (a.height + f.height), total: a.height + f.height };
    };
    const tall = await share();
    near(tall.share, 0.3, 0.01, "끌어 놓은 비율");

    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 1280, 560);
    await waitUntil(async () => (await share()).total < tall.total - 200, "창이 낮아짐");
    const short = await share();
    near(short.share, tall.share, 0.01, "낮아진 창에서의 비율");

    app.place(work.left + 60, work.top + 40, 1280, 820);
    await waitUntil(async () => (await share()).total > short.total + 200, "창이 다시 높아짐");
    near((await share()).share, tall.share, 0.01, "다시 높아진 창에서의 비율");
  });

  test("AC9 한 칸을 접으면 다른 칸이 남는 자리를 모두 쓰고 경계가 없어지며, 다시 펼치면 접기 전의 비율로 돌아온다", async () => {
    const before = { agents: await ui.agents(), files: await ui.files() };
    await page.getByRole("button", { name: "에이전트", exact: true }).click();
    assert.equal(await ui.paneSplitter().count(), 0);
    near((await ui.files()).height, before.agents.height + before.files.height - 31, 2, "접힌 뒤의 파일 칸 높이");

    await page.getByRole("button", { name: "에이전트", exact: true }).click();
    assert.equal(await ui.paneSplitter().count(), 1);
    near((await ui.agents()).height, before.agents.height, 1, "다시 펼친 에이전트 칸 높이");

    await page.getByRole("button", { name: "파일", exact: true }).click();
    assert.equal(await ui.paneSplitter().count(), 0);
    await page.getByRole("button", { name: "파일", exact: true }).click();
    near((await ui.files()).height, before.files.height, 1, "다시 펼친 파일 칸 높이");
  });

  test("AC14 경계에 포커스를 두고 방향키를 누르면 조금씩 움직인다", async () => {
    await ui.sidebarSplitter().focus();
    await page.keyboard.press("ArrowRight");
    assert.equal((await ui.sidebar()).width, 276);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    assert.equal((await ui.sidebar()).width, 244);
    assert.equal(await ui.sidebarSplitter().getAttribute("aria-valuenow"), "244");
    // 위·아래 키는 세로 경계를 움직이지 않는다
    await page.keyboard.press("ArrowDown");
    assert.equal((await ui.sidebar()).width, 244);

    const before = await ui.agents();
    await ui.paneSplitter().focus();
    await page.keyboard.press("ArrowDown");
    near((await ui.agents()).height, before.height + 16, 1, "아래 키를 누른 뒤의 에이전트 칸 높이");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    near((await ui.agents()).height, before.height - 16, 1, "위 키를 두 번 누른 뒤의 에이전트 칸 높이");
    await waitUntil(() => ui.saved(sandbox).sidebarWidth === 244, "방향키로 바꾼 값도 기억됨");
  });

  test("AC11 바꾼 너비와 비율은 모든 프로젝트 탭에 똑같이 적용되고, 앱을 다시 켜도 그대로다", async () => {
    await ui.dragSidebarTo(330);
    const before = { sidebar: (await ui.sidebar()).width, agents: (await ui.agents()).height, files: (await ui.files()).height };
    assert.equal(before.sidebar, 330);

    await page.getByRole("tab", { name: "beta" }).click();
    await page.locator('.sidebar__name:text-is("beta")').waitFor();
    assert.equal((await ui.sidebar()).width, 330);
    near((await ui.agents()).height, before.agents, 1, "다른 탭의 에이전트 칸 높이");
    await page.getByRole("tab", { name: "alpha" }).click();

    await waitUntil(() => ui.saved(sandbox).sidebarWidth === 330, "기억됨");
    await app.close();
    await start();
    assert.equal((await ui.sidebar()).width, 330);
    near((await ui.agents()).height, before.agents, 1, "다시 켠 뒤의 에이전트 칸 높이");
    near((await ui.files()).height, before.files, 1, "다시 켠 뒤의 파일 칸 높이");
  });

  test("AC10 경계를 더블클릭하면 처음 값으로 돌아간다", async () => {
    // 경계는 자리를 차지하지 않는 선이라, 선 위의 위치를 직접 더블클릭한다
    const sidebar = await ui.sidebar();
    await page.mouse.dblclick(sidebar.x + sidebar.width - 1, sidebar.y + 300);
    assert.equal((await ui.sidebar()).width, 240);
    const files = await ui.files();
    await page.mouse.dblclick(files.x + 100, files.y + 1);
    near((await ui.agents()).height, (await ui.files()).height, 1, "두 칸의 높이");
    await waitUntil(() => {
      const saved = ui.saved(sandbox);
      return saved.sidebarWidth === 240 && saved.agentShare === 0.5;
    }, "처음 값이 기억됨");
  });
});

describe("크기 조절: 개인 설정 파일", () => {
  let sandbox;
  let app;

  const open = async (extra) => {
    sandbox = createSandbox();
    const alpha = sandbox.project("alpha");
    sandbox.seedSettings([alpha], extra);
    app = await launchApp(sandbox, CMD_ONLY);
    app.page.setDefaultTimeout(8000);
    await app.page.locator(".agentrow").first().waitFor();
    return tools(app);
  };
  const close = async () => {
    await app?.close();
    sandbox?.dispose();
    app = undefined;
  };
  after(close);

  test("AC12 크기 값이 없는 이전 판의 설정 파일로 켜면 처음 값으로 뜨고 프로젝트 탭은 그대로 열린다", async () => {
    const ui = await open({ defaultShell: "cmd" });
    assert.equal((await ui.sidebar()).width, 240);
    near((await ui.agents()).height, (await ui.files()).height, 1, "두 칸의 높이");
    assert.equal(await app.page.getByRole("tab", { name: "alpha" }).count(), 1);
    await close();
  });

  test("AC12 크기 값이 깨져 있거나 한계를 벗어나 있어도 앱이 켜지고 한계 안의 값으로 뜬다", async () => {
    let ui = await open({ layout: { sidebarWidth: 5, agentShare: "half" } });
    assert.equal((await ui.sidebar()).width, 180);
    near((await ui.agents()).height, (await ui.files()).height, 1, "두 칸의 높이");
    assert.equal(await app.page.getByRole("tab", { name: "alpha" }).count(), 1);
    await close();

    ui = await open({ layout: { sidebarWidth: 99999, agentShare: 0.999 } });
    const width = await ui.windowWidth();
    assert.equal((await ui.sidebar()).width, width - 320, "작업 영역 320px는 남는다");
    near((await ui.files()).height, PANE_MIN, 1, "파일 칸은 가장 작은 높이로 남는다");
    assert.equal(await app.page.getByRole("tab", { name: "alpha" }).count(), 1);
    await close();

    ui = await open({ layout: "broken" });
    assert.equal((await ui.sidebar()).width, 240);
    await close();
  });
});
