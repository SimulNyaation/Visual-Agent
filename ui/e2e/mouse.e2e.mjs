// 실제 마우스 입력으로 창 끌기·더블클릭·크기 조절을 확인한다.
// 커서를 몇 초 동안 움직이므로 품질 게이트에는 넣지 않는다. 실행: npm run e2e:mouse
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createSandbox, launchApp, waitUntil } from "./harness.mjs";

const mouseScript = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "scripts", "mouse-probe.ps1");

function mouse(pid, action, x, y, dx = 0, dy = 0) {
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", mouseScript, "-ProcessId", String(pid), "-Action", action,
      "-X", String(Math.round(x)), "-Y", String(Math.round(y)), "-DX", String(dx), "-DY", String(dy)],
    { encoding: "utf8" },
  ).trim();
  const result = JSON.parse(output);
  assert.ok(result.ok, `마우스 입력을 보내지 못했습니다: ${result.reason}`);
}

describe("창 다루기 (실제 마우스)", () => {
  let sandbox;
  let app;
  /** 제목 표시줄에서 탭도 버튼도 없는 빈 곳의 화면 좌표 */
  let emptySpot;

  before(async () => {
    sandbox = createSandbox();
    app = await launchApp(sandbox);
    app.pickNext(sandbox.project("alpha"));
    await app.page.getByRole("button", { name: "폴더 선택" }).click();
    await app.page.getByRole("tab", { name: "alpha" }).waitFor();

    // 실행할 때마다 같은 자리에서 시작하도록 화면 안쪽에 창을 놓는다
    const { work } = app.info();
    app.place(work.left + 120, work.top + 80, 1100, 700);

    const { client, dpi } = app.info();
    const scale = dpi / 96;
    const add = await app.page.locator(".titlebar__add").boundingBox();
    emptySpot = { x: client.left + (add.x + add.width + 60) * scale, y: client.top + 24 * scale };
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC15 제목 표시줄의 빈 곳을 끌면 창이 따라 움직인다", () => {
    const before = app.info().window;
    mouse(app.pid, "drag", emptySpot.x, emptySpot.y, 120, 80);
    const moved = app.info().window;
    assert.deepEqual(
      { dx: moved.left - before.left, dy: moved.top - before.top, width: moved.right - moved.left, height: moved.bottom - moved.top },
      { dx: 120, dy: 80, width: before.right - before.left, height: before.bottom - before.top },
    );
    emptySpot = { x: emptySpot.x + 120, y: emptySpot.y + 80 };
  });

  test("AC15 빈 곳을 더블클릭하면 최대화되고, 다시 더블클릭하면 원래 크기로 돌아온다", async () => {
    const before = app.info();
    mouse(app.pid, "doubleclick", emptySpot.x, emptySpot.y);
    const maximized = await waitUntil(() => { const info = app.info(); return info.zoomed ? info : undefined; }, "더블클릭으로 최대화됨");

    const scale = maximized.dpi / 96;
    const add = await app.page.locator(".titlebar__add").boundingBox();
    mouse(app.pid, "doubleclick", maximized.client.left + (add.x + add.width + 60) * scale, maximized.client.top + 20 * scale);
    const restored = await waitUntil(() => { const info = app.info(); return info.zoomed ? undefined : info; }, "더블클릭으로 원래 크기가 됨");
    assert.deepEqual(restored.window, before.window);
  });

  test("AC15 프로젝트 탭 위에서 끌면 창은 움직이지 않는다", async () => {
    const { client, dpi, window: before } = app.info();
    const scale = dpi / 96;
    const tab = await app.page.getByRole("tab", { name: "alpha" }).boundingBox();
    mouse(app.pid, "drag", client.left + (tab.x + tab.width / 2) * scale, client.top + (4 + tab.y + tab.height / 2) * scale, 100, 60);
    assert.deepEqual(app.info().window, before);
  });

  test("AC17 오른쪽 가장자리를 끌면 창 폭이 바뀌고, 위쪽 가장자리를 끌면 높이가 바뀐다", () => {
    const first = app.info();
    mouse(app.pid, "drag", first.client.right + 2, (first.client.top + first.client.bottom) / 2, 100, 0);
    const wider = app.info();
    assert.equal(wider.window.right - wider.window.left, first.window.right - first.window.left + 100);
    assert.equal(wider.window.left, first.window.left);

    mouse(app.pid, "drag", (wider.client.left + wider.client.right) / 2 - 200, wider.client.top + 1, 0, 60);
    const shorter = app.info();
    assert.equal(shorter.window.bottom - shorter.window.top, wider.window.bottom - wider.window.top - 60);
    assert.equal(shorter.window.bottom, wider.window.bottom);
  });

  test("AC17 오른쪽 아래 모서리를 끌면 폭과 높이가 함께 바뀐다", () => {
    const first = app.info();
    mouse(app.pid, "drag", first.client.right + 2, first.client.bottom + 2, -80, -50);
    const smaller = app.info();
    assert.equal(smaller.window.right - smaller.window.left, first.window.right - first.window.left - 80);
    assert.equal(smaller.window.bottom - smaller.window.top, first.window.bottom - first.window.top - 50);
  });

  test("AC18 창을 화면 왼쪽 끝으로 끌면 화면 절반 크기로 붙는다", async () => {
    const { work } = app.info();
    const start = emptySpotNow(app);
    mouse(app.pid, "drag", start.x, start.y, work.left - start.x, 200 - start.y + work.top);
    const snapped = await waitUntil(() => {
      const info = app.info();
      const width = info.client.right - info.client.left;
      return Math.abs(width - (work.right - work.left) / 2) <= 2 ? info : undefined;
    }, "창이 화면 절반 폭으로 붙음");
    // Windows는 붙인 창 둘레에 1px 테두리를 그리므로 그만큼의 차이는 허용한다
    const offsets = {
      left: snapped.client.left - work.left,
      top: snapped.client.top - work.top,
      bottom: work.bottom - snapped.client.bottom,
    };
    for (const [edge, offset] of Object.entries(offsets)) {
      assert.ok(offset >= 0 && offset <= 1, `${edge} 가장자리가 화면 끝에서 ${offset}px 떨어져 있다 (${JSON.stringify(offsets)})`);
    }
  });
});

function emptySpotNow(app) {
  const { client, dpi } = app.info();
  const scale = dpi / 96;
  // 탭 하나(alpha)와 + 버튼 오른쪽의 빈 곳
  return { x: Math.round(client.left + 260 * scale), y: Math.round(client.top + 24 * scale) };
}
