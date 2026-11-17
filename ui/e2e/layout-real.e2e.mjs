// 크기 조절을 실제 마우스로 확인한다 (SPEC-20261117-resize-panes).
// layout.e2e.mjs는 화면 안으로 입력을 넣어 주는 방식이라, 사용자의 마우스가 앱 창을 거쳐 경계에 닿는지는 여기서 따로 확인한다.
// 커서를 쓰므로 품질 게이트에는 넣지 않는다. 실행: npm run e2e:mouse (도는 동안 마우스와 키보드를 건드리지 않는다)
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createSandbox, launchApp, mouse, waitUntil } from "./harness.mjs";

const TOP_STRIP = 4;

describe("크기 조절 (실제 마우스)", () => {
  let sandbox;
  let app;
  let page;

  const box = (selector) => page.locator(selector).boundingBox();
  /** 화면 안의 위치를 화면 좌표로 바꾼다 */
  function screenPoint(x, y) {
    const info = app.info();
    const scale = info.dpi / 96;
    const strip = info.zoomed ? 0 : TOP_STRIP;
    return { x: info.client.left + x * scale, y: info.client.top + (strip + y) * scale, scale };
  }
  async function sidebarEdge() {
    const sidebar = await box(".sidebar");
    return screenPoint(sidebar.x + sidebar.width - 1, sidebar.y + 300);
  }
  async function paneEdge() {
    const files = await box('section[aria-label="파일 칸"]');
    return screenPoint(files.x + 100, files.y + 1);
  }

  before(async () => {
    sandbox = createSandbox();
    sandbox.seedSettings([sandbox.project("alpha")]);
    app = await launchApp(sandbox, { VA_HIDE_SHELLS: "pwsh" });
    page = app.page;
    page.setDefaultTimeout(8000);
    const { work } = app.info();
    app.place(work.left + 60, work.top + 40, 1280, 820);
    await page.locator(".agentrow").first().waitFor();
    await waitUntil(async () => (await page.locator(".termview .xterm-rows").innerText()).includes(">"), "셸이 준비됨", 15000);
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC2 AC13 사이드바 경계를 실제 마우스로 터미널 위까지 끌면 너비가 따라 바뀌고, 글자가 선택되지 않는다", async () => {
    const edge = await sidebarEdge();
    mouse(app.pid, "drag", edge.x, edge.y, Math.round(140 * edge.scale), Math.round(60 * edge.scale));
    await waitUntil(async () => Math.abs((await box(".sidebar")).width - 380) <= 3, "사이드바가 380px쯤이 됨");
    assert.equal(await page.evaluate(() => String(window.getSelection())), "");
    assert.equal(await page.locator(".termview .xterm-selection div").count(), 0, "터미널의 글자가 선택되지 않는다");
  });

  test("AC6 칸 경계를 실제 마우스로 위로 끌면 에이전트 칸이 작아지고 파일 칸이 커진다", async () => {
    const before = { agents: await box('section[aria-label="에이전트 칸"]'), files: await box('section[aria-label="파일 칸"]') };
    const edge = await paneEdge();
    mouse(app.pid, "drag", edge.x, edge.y, Math.round(20 * edge.scale), Math.round(-100 * edge.scale));
    await waitUntil(async () => Math.abs((await box('section[aria-label="에이전트 칸"]')).height - (before.agents.height - 100)) <= 3, "에이전트 칸이 100px쯤 작아짐");
    const files = await box('section[aria-label="파일 칸"]');
    assert.ok(Math.abs(files.height - (before.files.height + 100)) <= 3, `파일 칸 높이 ${files.height}`);
  });

  test("AC10 경계를 실제로 더블클릭하면 처음 값으로 돌아간다", async () => {
    const side = await sidebarEdge();
    mouse(app.pid, "doubleclick", side.x, side.y);
    await waitUntil(async () => (await box(".sidebar")).width === 240, "사이드바가 240px로 돌아감");

    const panes = await paneEdge();
    mouse(app.pid, "doubleclick", panes.x, panes.y);
    await waitUntil(async () => {
      const agents = await box('section[aria-label="에이전트 칸"]');
      const files = await box('section[aria-label="파일 칸"]');
      return Math.abs(agents.height - files.height) <= 1;
    }, "두 칸의 높이가 같아짐");
  });
});
