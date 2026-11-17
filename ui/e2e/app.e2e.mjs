// 실제 앱 창으로 인수 기준을 확인한다. 실행: npm run e2e (먼저 앱을 빌드해야 한다)
// 여기서는 마우스 커서를 움직이지 않는다. 창 버튼과 창 끌기는 신호를 보내 확인하므로,
// 사용자의 실제 클릭이 같은 곳에 도달하는지는 npm run e2e:mouse (caption.e2e.mjs, mouse.e2e.mjs)로 따로 확인한다.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { countProcessesUsing, createSandbox, launchApp, waitUntil } from "./harness.mjs";

const HT = { top: 12, topLeft: 13, topRight: 14, left: 10, right: 11, bottom: 15, bottomLeft: 16, bottomRight: 17, minimize: 8, maximize: 9, close: 20 };

const tabLabels = (page) => page.locator("[role=tab]").allTextContents();
const selectedTab = (page) => page.locator("[role=tab][aria-selected=true]").textContent();
/** 사이드바 맨 위에 표시된 프로젝트 이름 */
const sidebarText = (page) => page.locator(".sidebar__name").innerText();
const workAreaText = (page) => page.locator(".workarea").innerText();

async function addProject(app, folder, button) {
  const before = (await tabLabels(app.page)).length;
  app.pickNext(folder);
  await app.page.getByRole("button", { name: button }).click();
  await waitUntil(async () => (await tabLabels(app.page)).length === before + 1, `탭이 ${before + 1}개가 됨`);
}

describe("앱 뼈대", () => {
  let sandbox;
  let app;
  let alpha;
  let beta;

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    beta = sandbox.project("beta");
    app = await launchApp(sandbox);
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC1 앱 창: 제목 표시줄 한 줄, 그 안에 탭 줄, 작업 표시줄 이름", async () => {
    const info = app.info();
    assert.equal(info.title, "Visual-Agent");

    const titlebar = await app.page.locator(".titlebar").boundingBox();
    assert.equal(titlebar.y, 0);
    assert.equal(titlebar.height, 40);
    const strip = await app.page.locator(".tabstrip").boundingBox();
    assert.ok(strip.y >= titlebar.y && strip.y + strip.height <= titlebar.y + titlebar.height, "탭 줄이 제목 표시줄 안에 있다");
    app.screenshot("AC2-folder-picker-screen.png");
  });

  test("AC2 폴더 선택을 누르면 Windows 폴더 선택 창이 뜨고, 취소하면 화면이 그대로다", async () => {
    await app.page.getByRole("button", { name: "폴더 선택" }).click();
    const title = await waitUntil(() => app.dialogTitle(), "폴더 선택 창이 뜸");
    assert.equal(title, "프로젝트 폴더 선택");

    app.closeDialog();
    await waitUntil(() => app.dialogTitle() === undefined, "폴더 선택 창이 닫힘");
    await app.page.getByRole("region", { name: "프로젝트 폴더 선택" }).waitFor();
    assert.deepEqual(await tabLabels(app.page), []);
  });

  test("AC2 열린 프로젝트가 없으면 폴더 선택 화면, 폴더를 고르면 탭과 사이드바에 폴더 이름", async () => {
    await app.page.getByRole("region", { name: "프로젝트 폴더 선택" }).waitFor();
    assert.deepEqual(await tabLabels(app.page), []);

    await addProject(app, alpha, "폴더 선택");

    assert.deepEqual(await tabLabels(app.page), ["alpha"]);
    assert.equal((await sidebarText(app.page)).trim(), "alpha");
  });

  test("AC1 제목 표시줄 아래 왼쪽에 하이어라키 사이드바, 오른쪽에 작업 영역", async () => {
    const titlebar = await app.page.locator(".titlebar").boundingBox();
    const sidebar = await app.page.locator(".sidebar").boundingBox();
    const workarea = await app.page.locator(".workarea").boundingBox();
    assert.equal(sidebar.y, titlebar.height);
    assert.equal(sidebar.x, 0);
    assert.equal(workarea.x, sidebar.width);
    assert.equal(workarea.y, sidebar.y);
    app.screenshot("AC1-app-window.png");
  });

  test("AC3 프로젝트 추가(+)로 두 번째 탭이 생기고 선택된다", async () => {
    await addProject(app, beta, "프로젝트 추가");
    assert.deepEqual(await tabLabels(app.page), ["alpha", "beta"]);
    assert.equal(await selectedTab(app.page), "beta");
    app.screenshot("AC3-second-tab.png");
  });

  test("AC4 탭을 누르면 사이드바와 작업 영역이 그 프로젝트 것으로 바뀐다", async () => {
    assert.equal((await sidebarText(app.page)).trim(), "beta");
    await app.page.locator('.agentrow__select[aria-current="true"]').waitFor();
    app.screenshot("AC4-tab-beta.png");

    await app.page.getByRole("tab", { name: "alpha" }).click();
    await waitUntil(async () => (await selectedTab(app.page)) === "alpha", "alpha 탭이 선택됨");

    assert.equal((await sidebarText(app.page)).trim(), "alpha");
    await app.page.locator('.agentrow__select[aria-current="true"]').waitFor();
    app.screenshot("AC4-tab-alpha.png");
  });

  test("AC6 이미 열린 폴더를 다시 고르면 새 탭 없이 기존 탭이 선택된다", async () => {
    app.pickNext(beta);
    await app.page.getByRole("button", { name: "프로젝트 추가" }).click();
    await waitUntil(async () => (await selectedTab(app.page)) === "beta", "beta 탭이 선택됨");
    assert.deepEqual(await tabLabels(app.page), ["alpha", "beta"]);
  });

  test("AC9 누를 수 있는 것은 프로젝트 탭, 탭 닫기, 프로젝트 추가, 사이드바 두 칸의 제목, 터미널과 그 버튼들, 파일 칸뿐이다", async () => {
    await app.page.locator(".termview .xterm").waitFor();
    const pressable = await app.page.evaluate(() =>
      [...document.querySelectorAll("button, a, input, select, textarea, summary, [role='button'], [role='link'], [role='menuitem'], [tabindex], [contenteditable]")]
        .map((element) => element.getAttribute("aria-label") ?? element.textContent ?? "")
        .sort(),
    );
    // 사이드바의 두 칸과 파일 칸은 SPEC-20261116-file-explorer에서, 터미널과 터미널 줄·새 터미널은 SPEC-20261116-terminal에서 추가됐다.
    // 프로젝트 폴더가 비어 있어 파일 줄은 없다
    assert.deepEqual(
      pressable,
      [
        "alpha",
        "alpha 탭 닫기",
        "beta",
        "beta 탭 닫기",
        "프로젝트 추가",
        "▾에이전트",
        "새 터미널",
        "PowerShell 1",
        "PowerShell 1 닫기",
        "터미널 입력",
        "▾파일",
        "파일",
      ].sort(),
    );
  });

  test("AC11 화면이 기린 테마 색으로 그려진다", async () => {
    const colors = await app.page.evaluate(() => {
      const css = (selector, property) => getComputedStyle(document.querySelector(selector)).getPropertyValue(property);
      return {
        body: css("body", "background-color"),
        titlebar: css(".titlebar", "background-color"),
        sidebar: css(".sidebar", "background-color"),
        text: css("body", "color"),
      };
    });
    assert.deepEqual(colors, {
      body: "rgb(30, 26, 22)",      // --bg-1 #1E1A16
      titlebar: "rgb(38, 33, 27)",  // --bg-2 #26211B
      sidebar: "rgb(38, 33, 27)",
      text: "rgb(233, 223, 201)",   // --text-1 #E9DFC9
    });
  });

  test("AC15 제목 표시줄의 빈 곳은 창을 끄는 곳이고, 탭과 버튼은 아니다", async () => {
    const regions = await app.page.evaluate(() => {
      const region = (selector) => getComputedStyle(document.querySelector(selector)).getPropertyValue("app-region");
      const titlebar = document.querySelector(".titlebar").getBoundingClientRect();
      const add = document.querySelector(".titlebar__add").getBoundingClientRect();
      const caption = parseFloat(getComputedStyle(document.querySelector(".titlebar")).getPropertyValue("--caption-width"));
      return {
        titlebar: region(".titlebar"),
        tabstrip: region(".tabstrip"),
        add: region(".titlebar__add"),
        emptyWidth: titlebar.width - caption - add.right,
      };
    });
    assert.equal(regions.titlebar, "drag");
    assert.equal(regions.tabstrip, "no-drag");
    assert.equal(regions.add, "no-drag");
    assert.ok(regions.emptyWidth >= 96, `창을 끌 빈 곳이 ${regions.emptyWidth}px 남아 있다`);
  });

  test("AC17 창의 네 가장자리와 네 모서리가 크기 조절 영역이다", async () => {
    const { client, dpi } = app.info();
    const scale = dpi / 96;
    const midX = (client.left + client.right) / 2;
    const midY = (client.top + client.bottom) / 2;
    const hits = {
      top: app.hit(midX, client.top + 1),
      topLeft: app.hit(client.left + 2, client.top + 1),
      topRight: app.hit(client.right - 3, client.top + 1),
      left: app.hit(client.left - 3, midY),
      right: app.hit(client.right + 2, midY),
      bottom: app.hit(midX, client.bottom + 2),
      bottomLeft: app.hit(client.left - 3, client.bottom + 2),
      bottomRight: app.hit(client.right + 2, client.bottom + 2),
    };
    assert.deepEqual(hits, { top: HT.top, topLeft: HT.topLeft, topRight: HT.topRight, left: HT.left, right: HT.right, bottom: HT.bottom, bottomLeft: HT.bottomLeft, bottomRight: HT.bottomRight });

    // AC16·AC18: 창 버튼 영역은 마우스 입력을 아래로 넘기지 않고(-1이 아님) 직접 최소화·최대화·닫기 버튼이라고 답한다
    const buttonY = client.top + 24 * scale;
    const buttons = {
      minimize: app.hitCaption(client.right - 115 * scale, buttonY),
      maximize: app.hitCaption(client.right - 69 * scale, buttonY),
      close: app.hitCaption(client.right - 23 * scale, buttonY),
    };
    assert.deepEqual(buttons, { minimize: HT.minimize, maximize: HT.maximize, close: HT.close });
  });

  test("AC16 최대화하면 화면에 가득 차되 잘리지 않고 작업 표시줄을 가리지 않는다. 다시 누르면 원래 크기", async () => {
    const before = app.info();
    assert.equal(before.zoomed, false);

    app.clickCaption(HT.maximize);
    const maximized = await waitUntil(() => { const info = app.info(); return info.zoomed ? info : undefined; }, "창이 최대화됨");
    assert.deepEqual(maximized.client, maximized.work, "창 안쪽이 작업 표시줄을 뺀 화면 영역과 정확히 같다");
    // 화면 내용도 최대화된 창 크기에 맞게 다시 그려진다
    const expectedWidth = Math.round((maximized.client.right - maximized.client.left) / (maximized.dpi / 96));
    await waitUntil(async () => (await app.page.evaluate(() => window.innerWidth)) === expectedWidth, "화면 내용이 최대화된 창 폭에 맞춰짐");
    const add = await app.page.locator(".titlebar__add").boundingBox();
    assert.ok(add.y >= 0 && add.height > 0, "최대화해도 제목 표시줄이 화면 위로 잘리지 않는다");
    await app.page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await new Promise((done) => setTimeout(done, 700)); // 창 최대화 애니메이션이 끝난 뒤에 캡처한다
    app.screenshot("AC16-maximized.png");

    app.clickCaption(HT.maximize);
    const restored = await waitUntil(() => { const info = app.info(); return info.zoomed ? undefined : info; }, "창이 원래 크기로 돌아옴");
    assert.deepEqual(restored.window, before.window);
  });

  test("AC16 최소화 버튼을 누르면 창이 작업 표시줄로 내려간다", async () => {
    app.clickCaption(HT.minimize);
    await waitUntil(() => app.info().iconic, "창이 최소화됨");
    app.restore();
    await waitUntil(() => !app.info().iconic, "창이 다시 올라옴");
  });

  test("AC5 탭을 닫으면 사라지고 옆 탭이 선택된다", async () => {
    await app.page.getByRole("button", { name: "beta 탭 닫기" }).click();
    await waitUntil(async () => (await tabLabels(app.page)).length === 1, "탭이 1개가 됨");
    assert.equal(await selectedTab(app.page), "alpha");
  });

  test("AC5 마지막 탭을 닫으면 폴더 선택 화면이 표시된다", async () => {
    await app.page.getByRole("button", { name: "alpha 탭 닫기" }).click();
    await app.page.getByRole("region", { name: "프로젝트 폴더 선택" }).waitFor();
    assert.deepEqual(await tabLabels(app.page), []);
    app.screenshot("AC5-last-tab-closed.png");
  });

  test("AC7 종료했다가 다시 실행하면 탭이 같은 순서로 열리고 마지막에 보던 탭이 선택되어 있다", async () => {
    await addProject(app, alpha, "폴더 선택");
    await addProject(app, beta, "프로젝트 추가");
    await app.page.getByRole("tab", { name: "alpha" }).click();
    await waitUntil(async () => (await selectedTab(app.page)) === "alpha", "alpha 탭이 선택됨");

    await app.close();
    app = await launchApp(sandbox);

    await waitUntil(async () => (await tabLabels(app.page)).length === 2, "탭 2개가 복원됨");
    assert.deepEqual(await tabLabels(app.page), ["alpha", "beta"]);
    assert.equal(await selectedTab(app.page), "alpha");
    assert.equal((await sidebarText(app.page)).trim(), "alpha");
    app.screenshot("AC7-after-restart.png");
  });

  test("AC8 다시 실행했을 때 폴더가 없어진 탭은 안내가 표시되고 닫을 수 있으며, 다른 탭은 정상이다", async () => {
    await app.close();
    rmSync(beta, { recursive: true, force: true });
    app = await launchApp(sandbox);
    await waitUntil(async () => (await tabLabels(app.page)).length === 2, "탭 2개가 복원됨");

    await app.page.getByRole("tab", { name: "beta" }).click();
    await waitUntil(async () => (await workAreaText(app.page)).includes("폴더를 찾을 수 없습니다"), "없어진 폴더 안내가 표시됨");
    app.screenshot("AC8-missing-folder.png");

    await app.page.getByRole("tab", { name: "alpha" }).click();
    await waitUntil(async () => !(await workAreaText(app.page)).includes("폴더를 찾을 수 없습니다"), "alpha 탭은 정상");

    await app.page.getByRole("button", { name: "beta 탭 닫기" }).click();
    await waitUntil(async () => (await tabLabels(app.page)).length === 1, "없어진 폴더의 탭이 닫힘");
  });

  test("AC16·AC12 닫기 버튼을 누르면 앱이 종료되고 관련 프로세스가 하나도 남지 않는다", async () => {
    assert.ok(countProcessesUsing(sandbox.dataDir) > 1, "실행 중에는 앱과 화면 부품 프로세스가 있다");

    app.clickCaption(HT.close);
    await app.waitForExit();
    await waitUntil(() => countProcessesUsing(sandbox.dataDir) === 0, "관련 프로세스가 모두 끝남", 15000);
  });
});
