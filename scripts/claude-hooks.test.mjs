// Claude Code 설정에 훅을 넣고 빼는 규칙을 확인한다. 실행: node --test scripts/claude-hooks.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { hookEvents, installedHooks, withHooks, withoutHooks } from "./claude-hooks.mjs";

const OURS = "C:/Users/someone/AppData/Local/Visual-Agent/hooks/va-hook.exe";
const other = { type: "command", command: "C:/tools/other-hook.exe claude", timeout: 10 };
const existing = {
  model: "some-model",
  hooks: {
    Stop: [{ hooks: [other] }],
    PreToolUse: [{ matcher: "*", hooks: [other] }],
    PostToolUse: [{ matcher: "*", hooks: [other] }],
  },
  theme: "dark",
};

test("훅을 넣어도 다른 프로그램의 훅과 다른 설정은 그대로다 (AC10)", () => {
  const next = withHooks(existing, OURS);
  assert.equal(next.model, "some-model");
  assert.equal(next.theme, "dark");
  assert.deepEqual(next.hooks.PostToolUse, existing.hooks.PostToolUse);
  assert.deepEqual(next.hooks.Stop[0], existing.hooks.Stop[0]);
  assert.deepEqual(next.hooks.PreToolUse[0], existing.hooks.PreToolUse[0]);
  // 넘겨받은 설정을 고치지 않는다
  assert.equal(existing.hooks.Stop.length, 1);

  assert.deepEqual(installedHooks(next), { count: hookEvents.length, command: OURS });
  for (const [event] of hookEvents) {
    const ours = next.hooks[event].at(-1);
    assert.deepEqual(ours.hooks, [{ type: "command", command: OURS, args: ["claude"], timeout: 5 }]);
  }
  // 하위 에이전트를 부리는 도구에만 건다. 모든 도구에 걸지 않는다
  assert.equal(next.hooks.PreToolUse.at(-1).matcher, "Agent|Task");
  assert.equal("matcher" in next.hooks.Stop.at(-1), false);
});

test("두 번 넣어도 하나씩만 들어가고, 프로그램 위치가 바뀌면 새것으로 바뀐다 (AC10)", () => {
  const moved = "D:/elsewhere/va-hook.exe";
  const twice = withHooks(withHooks(existing, OURS), moved);
  assert.deepEqual(installedHooks(twice), { count: hookEvents.length, command: moved });
  assert.equal(twice.hooks.Stop.length, 2);
});

test("빼면 넣기 전과 같아진다 (AC10)", () => {
  assert.deepEqual(withoutHooks(withHooks(existing, OURS)), existing);
  // 훅이 하나도 없던 설정은 hooks 항목 자체가 없던 대로 돌아간다
  assert.deepEqual(withoutHooks(withHooks({ model: "m" }, OURS)), { model: "m" });
  assert.deepEqual(withoutHooks(withHooks({}, OURS)), {});
  assert.deepEqual(installedHooks(existing), { count: 0, command: null });
});
