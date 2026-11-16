// 파일 칸을 실제 마우스와 실제 키보드로 확인한다.
// files.e2e.mjs는 화면 안으로 입력을 넣어 주는 방식이라, 사용자의 입력이 앱 창을 거쳐 같은 곳에 도달하는지는 여기서 따로 확인한다.
// 커서와 키보드를 쓰므로 품질 게이트에는 넣지 않는다. 실행: npm run e2e:mouse (도는 동안 마우스와 키보드를 건드리지 않는다)
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createSandbox, keys, launchApp, mouse, waitUntil } from "./harness.mjs";

const TOP_STRIP = 4;

describe("파일 칸 (실제 마우스·키보드)", () => {
  let sandbox;
  let app;
  let page;
  let alpha;

  const row = (path) => page.locator(`[role=treeitem][data-path="${path}"]`);

  /** 화면 안 요소의 가운데를 화면 좌표로 바꾼다 */
  async function screenPoint(locator) {
    const box = await locator.boundingBox();
    const info = app.info();
    const scale = info.dpi / 96;
    const strip = info.zoomed ? 0 : TOP_STRIP;
    return {
      x: info.client.left + (box.x + Math.min(box.width / 2, 70)) * scale,
      y: info.client.top + (strip + box.y + box.height / 2) * scale,
    };
  }
  async function click(path, action = "click") {
    const spot = await screenPoint(row(path));
    mouse(app.pid, action, spot.x, spot.y);
  }

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    mkdirSync(join(alpha, "inbox"));
    for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) writeFileSync(join(alpha, name), name);

    app = await launchApp(sandbox);
    page = app.page;
    page.setDefaultTimeout(8000);
    const { work } = app.info();
    app.place(work.left + 120, work.top + 80, 1100, 800);
    app.pickNext(alpha);
    await page.getByRole("button", { name: "폴더 선택" }).click();
    await row("a.txt").waitFor();
  });

  after(async () => {
    await app?.close();
    sandbox?.dispose();
  });

  test("AC10 AC18 실제 클릭으로 선택하고, F2로 이름을 바꾼다", async () => {
    await click("a.txt");
    await page.locator('[data-path="a.txt"][aria-selected=true]').waitFor();

    keys(app.pid, "F2");
    await page.getByRole("textbox", { name: "새 이름" }).waitFor();
    keys(app.pid, "7,Enter");

    await waitUntil(() => existsSync(join(alpha, "7.txt")), "이름이 7.txt로 바뀜");
    assert.equal(existsSync(join(alpha, "a.txt")), false);
    assert.equal(readFileSync(join(alpha, "7.txt"), "utf8"), "a.txt");
  });

  test("AC11 실제 화살표 키로 선택이 움직이고 폴더가 펼쳐진다", async () => {
    await click("b.txt");
    keys(app.pid, "Down");
    await page.locator('[data-path="c.txt"][aria-selected=true]').waitFor();
    keys(app.pid, "Up,Up,Up");
    await page.locator('[data-path="inbox"][aria-selected=true]').waitFor();
    keys(app.pid, "Right");
    await page.locator('[data-path="inbox"][aria-expanded=true]').waitFor();
    keys(app.pid, "Left");
    await page.locator('[data-path="inbox"][aria-expanded=false]').waitFor();
  });

  test("AC29 AC23 실제 Ctrl+C, Ctrl+V로 복사하고 Ctrl+Z로 되돌린다", async () => {
    await click("b.txt");
    keys(app.pid, "Ctrl+C,Ctrl+V");
    await waitUntil(() => existsSync(join(alpha, "b - 복사본.txt")), "사본이 생김");

    keys(app.pid, "Ctrl+Z");
    await waitUntil(() => !existsSync(join(alpha, "b - 복사본.txt")), "되돌려짐");
    await page.getByText("되돌림: b - 복사본.txt를 붙여넣은 것").waitFor();
  });

  test("AC30 실제 Ctrl+X로 잘라내고 폴더를 클릭한 뒤 Ctrl+V로 옮긴다", async () => {
    await click("c.txt");
    keys(app.pid, "Ctrl+X");
    await page.locator('[data-path="c.txt"].filerow--cut').waitFor();

    await click("inbox");
    keys(app.pid, "Ctrl+V");
    await waitUntil(() => existsSync(join(alpha, "inbox", "c.txt")), "inbox로 옮겨짐");
    assert.equal(existsSync(join(alpha, "c.txt")), false);
  });

  test("AC17 AC20 실제 우클릭으로 메뉴가 뜨고, 메뉴를 클릭해 새 파일을 만든다", async () => {
    await click("d.txt", "rightclick");
    await page.getByRole("menu").waitFor();
    assert.equal(await page.getByRole("menuitem").count(), 7);

    const item = await screenPoint(page.getByRole("menuitem", { name: "새 파일", exact: true }));
    mouse(app.pid, "click", item.x, item.y);
    await page.getByRole("textbox", { name: "새 파일 이름" }).waitFor();
    keys(app.pid, "9,Enter");
    await waitUntil(() => existsSync(join(alpha, "9")), "새 파일이 만들어짐");
  });

  test("AC21 실제 Delete 키와 확인 버튼 클릭으로 지운다", async () => {
    await click("d.txt");
    keys(app.pid, "Delete");
    const dialog = page.getByRole("alertdialog", { name: "지우기 확인" });
    await dialog.waitFor();

    const cancel = await screenPoint(dialog.getByRole("button", { name: "취소" }));
    mouse(app.pid, "click", cancel.x, cancel.y);
    await dialog.waitFor({ state: "detached" });
    assert.equal(existsSync(join(alpha, "d.txt")), true);

    keys(app.pid, "Delete");
    await dialog.waitFor();
    const confirm = await screenPoint(dialog.getByRole("button", { name: "확인" }));
    mouse(app.pid, "click", confirm.x, confirm.y);
    await waitUntil(() => !existsSync(join(alpha, "d.txt")), "지워짐");
    assert.equal(readdirSync(sandbox.trashDir).some((name) => name.endsWith("d.txt")), true);
  });

  test("AC12 실제 마우스로 파일을 끌어 폴더에 놓으면 옮겨진다", async () => {
    const from = await screenPoint(row("b.txt"));
    const to = await screenPoint(row("inbox"));
    mouse(app.pid, "drag", from.x, from.y, Math.round(to.x - from.x), Math.round(to.y - from.y));

    await waitUntil(() => existsSync(join(alpha, "inbox", "b.txt")), "inbox로 옮겨짐");
    assert.equal(existsSync(join(alpha, "b.txt")), false);
  });
});
