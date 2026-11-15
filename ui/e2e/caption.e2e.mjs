// 창 버튼(최소화·최대화·닫기)을 실제 마우스 클릭으로 확인한다.
// 창에 신호를 직접 보내는 방식은 사용자의 클릭과 다른 길로 전달되어 결함을 놓친 적이 있다.
// 커서를 움직이므로 품질 게이트에는 넣지 않는다. 실행: npm run e2e:mouse
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { countProcessesUsing, createSandbox, launchApp, mouse, waitUntil } from "./harness.mjs";

const BUTTON_WIDTH = 46;
const TITLE_BAR_HEIGHT = 40;
const TOP_STRIP = 4;

/** 창 버튼 가운데의 화면 좌표. index: 0 최소화, 1 최대화, 2 닫기 */
function buttonCenter(info, index) {
  const scale = info.dpi / 96;
  const strip = info.zoomed ? 0 : TOP_STRIP;
  return {
    x: info.client.right - (BUTTON_WIDTH * (3 - index) - BUTTON_WIDTH / 2) * scale,
    y: info.client.top + (strip + TITLE_BAR_HEIGHT / 2) * scale,
  };
}

describe("창 버튼 (실제 마우스 클릭)", () => {
  let sandbox;
  let app;

  before(async () => {
    sandbox = createSandbox();
    app = await launchApp(sandbox);
    const { work } = app.info();
    app.place(work.left + 120, work.top + 80, 1100, 700);
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC16 최대화 버튼을 클릭하면 화면에 가득 차고, 다시 클릭하면 원래 크기로 돌아온다", async () => {
    const before = app.info();
    const first = buttonCenter(before, 1);
    mouse(app.pid, "click", first.x, first.y);
    const maximized = await waitUntil(() => { const info = app.info(); return info.zoomed ? info : undefined; }, "클릭으로 최대화됨");
    assert.deepEqual(maximized.client, maximized.work, "창 안쪽이 작업 표시줄을 뺀 화면 영역과 정확히 같다");

    const second = buttonCenter(maximized, 1);
    mouse(app.pid, "click", second.x, second.y);
    const restored = await waitUntil(() => { const info = app.info(); return info.zoomed ? undefined : info; }, "클릭으로 원래 크기가 됨");
    assert.deepEqual(restored.window, before.window);
  });

  test("AC16 최소화 버튼을 클릭하면 창이 작업 표시줄로 내려간다", async () => {
    const spot = buttonCenter(app.info(), 0);
    mouse(app.pid, "click", spot.x, spot.y);
    await waitUntil(() => app.info().iconic, "클릭으로 최소화됨");
    app.restore();
    await waitUntil(() => !app.info().iconic, "창이 다시 올라옴");
  });

  test("AC16 창 버튼 위에서 끌어도 창은 움직이지 않는다", () => {
    const before = app.info();
    const spot = buttonCenter(before, 0);
    mouse(app.pid, "drag", spot.x, spot.y, -150, 90);
    const after = app.info();
    assert.equal(after.iconic, false);
    assert.deepEqual(after.window, before.window);
  });

  test("AC16·AC12 닫기 버튼을 클릭하면 앱이 종료되고 관련 프로세스가 남지 않는다", async () => {
    const spot = buttonCenter(app.info(), 2);
    mouse(app.pid, "click", spot.x, spot.y);
    await app.waitForExit();
    await waitUntil(() => countProcessesUsing(sandbox.dataDir) === 0, "관련 프로세스가 모두 끝남", 15000);
  });
});
