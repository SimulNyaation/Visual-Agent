// Claude Code가 Visual-Agent에 소식(하위 에이전트, 답하는 중, 허락 대기)을 알리도록 Claude Code 설정에 훅을 넣거나 뺀다.
// 사용자의 Claude Code 설정 파일(~/.claude/settings.json)을 고친다. 다른 프로그램이 넣어 둔 훅은 건드리지 않고,
// 처음 고칠 때 원래 파일을 settings.json.before-visual-agent 로 남겨 둔다.
// 사용: node scripts/claude-hooks.mjs install | remove | status
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** 훅을 거는 일과, 그 일을 고르는 조건(matcher). null이면 조건 없이 모두 */
export const hookEvents = [
  ["SessionStart", null],
  ["SessionEnd", null],
  ["UserPromptSubmit", null],
  ["Stop", null],
  ["StopFailure", null],
  ["PermissionRequest", "*"],
  // 하위 에이전트를 부리는 도구만 (맡긴 일의 설명을 알아내려고). 다른 도구를 쓸 때는 실행되지 않는다
  ["PreToolUse", "Agent|Task"],
  ["SubagentStart", null],
  ["SubagentStop", null],
];

/** 이 훅 묶음이 Visual-Agent가 넣은 것인가 */
function isOurs(group) {
  return Array.isArray(group?.hooks) && group.hooks.some((hook) => /[\\/]va-hook\.exe$/i.test(String(hook?.command ?? "")));
}

function ourGroup(matcher, command) {
  const hook = { type: "command", command, args: ["claude"], timeout: 5 };
  return matcher === null ? { hooks: [hook] } : { matcher, hooks: [hook] };
}

/** 설정에서 Visual-Agent가 넣은 훅만 뺀 것. 다른 것은 그대로다 */
export function withoutHooks(settings) {
  if (typeof settings?.hooks !== "object" || settings.hooks === null) return { ...settings };
  const hooks = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const kept = Array.isArray(groups) ? groups.filter((group) => !isOurs(group)) : groups;
    if (!Array.isArray(kept) || kept.length > 0) hooks[event] = kept;
  }
  const next = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

/** 설정에 Visual-Agent의 훅을 넣은 것. 이미 있으면 새것으로 바꾼다. 다른 것은 그대로다 */
export function withHooks(settings, command) {
  const next = withoutHooks(settings);
  const hooks = { ...(next.hooks ?? {}) };
  for (const [event, matcher] of hookEvents) {
    hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] : []), ourGroup(matcher, command)];
  }
  return { ...next, hooks };
}

/** 넣어 둔 훅의 수와 그것이 가리키는 프로그램 */
export function installedHooks(settings) {
  const groups = Object.values(settings?.hooks ?? {}).flatMap((list) => (Array.isArray(list) ? list.filter(isOurs) : []));
  return { count: groups.length, command: groups[0]?.hooks.find((hook) => hook.command)?.command ?? null };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const action = process.argv[2];
  const settingsFile = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
  const built = join(root, "build", "core", "va-hook.exe");
  // 앱을 다시 빌드해도 Claude Code가 쓰는 중인 파일과 부딪히지 않게 따로 둔다
  const installed = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Visual-Agent", "hooks", "va-hook.exe");
  const command = installed.replaceAll("\\", "/");

  const read = () => {
    if (!existsSync(settingsFile)) return {};
    const settings = JSON.parse(readFileSync(settingsFile, "utf8").replace(/^﻿/, ""));
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) throw new Error(`${settingsFile} 의 모양을 알 수 없습니다`);
    return settings;
  };
  const write = (settings) => {
    const backup = `${settingsFile}.before-visual-agent`;
    if (existsSync(settingsFile) && !existsSync(backup)) copyFileSync(settingsFile, backup);
    mkdirSync(dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  };

  if (action === "status") {
    const { count, command: current } = installedHooks(read());
    console.log(count === 0 ? "Visual-Agent 훅이 들어 있지 않습니다" : `Visual-Agent 훅 ${count}개가 들어 있습니다 (${current})`);
    console.log(`설정 파일: ${settingsFile}`);
  } else if (action === "install") {
    if (!existsSync(built)) throw new Error(`${built} 가 없습니다. 먼저 "npm run build"로 앱을 빌드하세요.`);
    mkdirSync(dirname(installed), { recursive: true });
    copyFileSync(built, installed);
    write(withHooks(read(), command));
    console.log(`Visual-Agent 훅 ${hookEvents.length}개를 넣었습니다: ${settingsFile}`);
    console.log(`훅이 실행하는 프로그램: ${installed}`);
    console.log("새로 시작하는 Claude Code부터 적용됩니다. 빼려면: node scripts/claude-hooks.mjs remove");
  } else if (action === "remove") {
    write(withoutHooks(read()));
    console.log(`Visual-Agent 훅을 뺐습니다: ${settingsFile}`);
  } else {
    console.error("사용: node scripts/claude-hooks.mjs install | remove | status");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`[claude-hooks] ${error.message}`);
    process.exit(1);
  }
}
