// 터미널을 실제 마우스, 실제 키보드, 실제 Windows 클립보드로 확인한다.
// terminal.e2e.mjs는 화면 안으로 입력을 넣어 주는 방식이라, 사용자의 입력이 앱 창을 거쳐 터미널까지 도달하는지는 여기서 따로 확인한다.
// 커서와 키보드와 클립보드를 쓰므로 품질 게이트에는 넣지 않는다. 실행: npm run e2e:mouse (도는 동안 마우스와 키보드를 건드리지 않는다)
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { clipboard, createSandbox, descendants, keys, launchApp, mouse, typeText, waitUntil } from "./harness.mjs";

const TOP_STRIP = 4;
const BUTTON_WIDTH = 46;
const TITLE_BAR_HEIGHT = 40;
const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

// PowerShell은 넣은 명령을 사용자의 명령 기록 파일에 남긴다. 그래서 명령을 넣는 테스트는 PowerShell 7이 없는 컴퓨터처럼 띄워 명령 프롬프트를 쓴다
const CMD_ONLY = { VA_HIDE_SHELLS: "pwsh" };

describe("터미널 (실제 마우스·키보드)", () => {
  let sandbox;
  let app;
  let page;
  let alpha;
  let savedClipboard;

  const text = () => page.locator(".termview .xterm-rows").innerText();
  const waitText = async (part) => {
    try {
      await waitUntil(async () => (await text()).includes(part), `터미널에 "${part}"가 보임`);
    } catch (error) {
      const front = app.exited() ? "앱이 끝남" : JSON.stringify(app.info().front ?? "모름");
      throw new Error(`${error.message}\n맨 앞 창: ${front}\n터미널 내용: ${JSON.stringify(await text())}`, { cause: error });
    }
  };
  const rowLabels = () => page.locator(".agentrow__select").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
  const waitRows = (labels) => waitUntil(async () => JSON.stringify(await rowLabels()) === JSON.stringify(labels), `터미널 줄이 ${JSON.stringify(labels)}가 됨`);

  /** 화면 안의 점을 화면 좌표로 바꾼다 */
  function toScreen(x, y) {
    const info = app.info();
    const scale = info.dpi / 96;
    const strip = info.zoomed ? 0 : TOP_STRIP;
    return { x: info.client.left + x * scale, y: info.client.top + (strip + y) * scale };
  }
  async function center(locator) {
    const box = await locator.boundingBox();
    return toScreen(box.x + box.width / 2, box.y + box.height / 2);
  }
  async function click(locator) {
    const spot = await center(locator);
    mouse(app.pid, "click", spot.x, spot.y);
  }
  /** 실제 키보드로 명령을 치고 Enter를 누른다 */
  function run(command) {
    typeText(app.pid, command);
    keys(app.pid, "Enter");
  }

  before(async () => {
    sandbox = createSandbox();
    alpha = sandbox.project("alpha");
    sandbox.fakeAgent(alpha, "claude.exe");
    sandbox.seedSettings([alpha]);
    savedClipboard = clipboard.read();

    app = await launchApp(sandbox, CMD_ONLY);
    page = app.page;
    page.setDefaultTimeout(8000);
    const { work } = app.info();
    app.place(work.left + 120, work.top + 80, 1200, 800);
    await waitRows(["cmd 1"]);
    await waitText(`${alpha}>`);
  });

  after(async () => {
    if (savedClipboard) clipboard.write(savedClipboard);
    await app?.close();
    sandbox?.dispose();
  });

  test("AC5 터미널을 실제로 클릭하고 실제 키보드로 명령을 치면 실행된다", async () => {
    await click(page.locator(".termview"));
    run("echo typed-for-real> typed.txt");
    await waitUntil(() => read(join(alpha, "typed.txt")).trim() === "typed-for-real", "친 명령이 실행됨");
    await waitText("typed.txt");
  });

  test("AC6 실제 키보드로 넣은 한글이 깨지지 않는다", async () => {
    run("echo 한글 입력> 한글.txt");
    await waitUntil(() => existsSync(join(alpha, "한글.txt")), "한글 이름의 파일이 만들어짐");
    await waitText("echo 한글 입력> 한글.txt");
  });

  test("AC7 실제 화살표 키, Enter, Esc, Ctrl+C가 화면 전체를 쓰는 프로그램에 전달된다", async () => {
    run(".\\claude.exe keys.log");
    await waitText("FAKE AGENT READY");
    await waitRows(["cmd 1, Claude Code 실행 중"]);

    // 시험용 프로그램은 한 번에 키 하나씩만 알아보므로, 받은 것을 확인하고 다음 키를 누른다
    for (const [key, name] of [["Up", "UP"], ["Down", "DOWN"], ["Left", "LEFT"], ["Right", "RIGHT"], ["Enter", "ENTER"], ["Escape", "ESC"]]) {
      keys(app.pid, key);
      await waitText(`last key: ${name}`);
    }
    keys(app.pid, "Ctrl+C");
    await waitRows(["cmd 1"]);
    assert.deepEqual(read(join(alpha, "keys.log")).split("\n"), ["UP", "DOWN", "LEFT", "RIGHT", "ENTER", "ESC", "CTRL+C", ""]);
  });

  test("AC10 실제 마우스로 글자를 끌어 선택하고 Ctrl+C를 누르면 Windows 클립보드에 복사된다", async () => {
    run("cls");
    run("echo REAL-COPY-TOKEN");
    await waitText("\nREAL-COPY-TOKEN");
    clipboard.write("not-copied-yet");

    const box = await page.locator(".termview .xterm-rows > div", { hasText: /^REAL-COPY-TOKEN\s*$/ }).boundingBox();
    const from = toScreen(box.x + 1, box.y + box.height / 2);
    mouse(app.pid, "drag", from.x, from.y, Math.round(260 * (app.info().dpi / 96)), 0);
    keys(app.pid, "Ctrl+C");
    await waitUntil(() => clipboard.read().trim() === "REAL-COPY-TOKEN", "선택한 글자가 클립보드에 들어감");
  });

  test("AC10 실제 Ctrl+V를 누르면 Windows 클립보드의 글자가 터미널에 들어간다", async () => {
    clipboard.write("echo pasted-for-real> pasted.txt");
    await click(page.locator(".termview"));
    keys(app.pid, "Ctrl+V");
    await waitText("echo pasted-for-real> pasted.txt");
    keys(app.pid, "Enter");
    await waitUntil(() => read(join(alpha, "pasted.txt")).trim() === "pasted-for-real", "붙여넣은 명령이 실행됨");
  });

  test("AC10 선택한 글자가 없을 때의 실제 Ctrl+C는 실행 중인 프로그램을 멈춘다", async () => {
    run("ping -n 300 127.0.0.1");
    await waitUntil(() => descendants(app.pid).some((item) => item.name === "ping.exe"), "ping이 실행 중");
    keys(app.pid, "Ctrl+C");
    await waitUntil(() => !descendants(app.pid).some((item) => item.name === "ping.exe"), "ping이 멈춤");
  });

  test("AC15 AC16 AC17 새 터미널(+), 터미널 줄, 닫기(×)를 실제로 클릭하면 동작한다", async () => {
    await click(page.getByRole("button", { name: "새 터미널" }));
    await waitRows(["cmd 1", "cmd 2"]);
    await page.locator('.agentrow__select[aria-current="true"][aria-label="cmd 2"]').waitFor();

    // 새 터미널이 뜨면 바로 칠 수 있다 (키보드가 새 터미널에 가 있다)
    await waitText(`${alpha}>`);
    run("echo second> second.txt");
    await waitUntil(() => existsSync(join(alpha, "second.txt")), "새 터미널에서 명령이 실행됨");

    await click(page.locator('.agentrow__select[aria-label="cmd 1"]'));
    await page.locator('.agentrow__select[aria-current="true"][aria-label="cmd 1"]').waitFor();
    await waitText("pasted.txt");

    await click(page.getByRole("button", { name: "cmd 2 닫기" }));
    await waitRows(["cmd 1"]);
  });

  test("AC28 실행 중인 프로그램이 있을 때 창의 닫기 버튼을 실제로 클릭하면 확인 창이 뜨고, 닫기를 클릭하면 앱이 끝난다", async () => {
    await click(page.locator(".termview"));
    run(".\\claude.exe");
    await waitRows(["cmd 1, Claude Code 실행 중"]);
    const running = descendants(app.pid);

    const closeButton = () => {
      const info = app.info();
      const scale = info.dpi / 96;
      return { x: info.client.right - (BUTTON_WIDTH / 2) * scale, y: info.client.top + (TOP_STRIP + TITLE_BAR_HEIGHT / 2) * scale };
    };
    mouse(app.pid, "click", closeButton().x, closeButton().y);
    const dialog = page.getByRole("alertdialog", { name: "닫기 확인" });
    await dialog.waitFor();

    await click(dialog.getByRole("button", { name: "취소" }));
    await dialog.waitFor({ state: "detached" });
    assert.equal(app.exited(), false);

    mouse(app.pid, "click", closeButton().x, closeButton().y);
    await dialog.waitFor();
    await click(dialog.getByRole("button", { name: "닫기" }));
    await app.waitForExit();
    await waitUntil(() => descendants(app.pid).length === 0 && running.length > 0, "앱이 끝남");
  });
});
