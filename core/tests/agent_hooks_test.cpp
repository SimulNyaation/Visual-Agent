// 에이전트가 훅으로 알려 주는 소식의 규칙.
#include <doctest/doctest.h>

#include <nlohmann/json.hpp>

#include "domain/agent_hooks.h"

using nlohmann::json;
using namespace va::domain;

namespace {

HookState feed(HookState state, const json& payload) { return applyHookEvent(std::move(state), parseHookEvent(payload)); }

json spawn(const std::string& type, const std::string& description) {
    return {{"hook_event_name", "PreToolUse"},
            {"tool_name", "Agent"},
            {"tool_input", {{"subagent_type", type}, {"description", description}, {"prompt", "..."}}}};
}

json started(const std::string& id, const std::string& type) {
    return {{"hook_event_name", "SubagentStart"}, {"agent_id", id}, {"agent_type", type}};
}

json stopped(const std::string& id) { return {{"hook_event_name", "SubagentStop"}, {"agent_id", id}}; }

}  // namespace

TEST_CASE("훅: 질문을 받으면 답하는 중이 되고, 다 답하면 끝난다 (AC6)") {
    HookState state;
    CHECK_FALSE(state.connected);
    state = feed(state, {{"hook_event_name", "SessionStart"}, {"source", "startup"}});
    CHECK(state.connected);
    CHECK_FALSE(state.working());

    state = feed(state, {{"hook_event_name", "UserPromptSubmit"}, {"prompt", "hi"}});
    CHECK(state.working());
    state = feed(state, {{"hook_event_name", "Stop"}, {"background_tasks", json::array()}});
    CHECK_FALSE(state.working());

    // API 오류로 끝난 것도 끝난 것이다
    state = feed(state, {{"hook_event_name", "UserPromptSubmit"}});
    state = feed(state, {{"hook_event_name", "StopFailure"}});
    CHECK_FALSE(state.working());

    // 대화가 끝나면 훅으로 받던 것도 없다
    state = feed(state, {{"hook_event_name", "UserPromptSubmit"}});
    state = feed(state, {{"hook_event_name", "SessionEnd"}, {"reason", "other"}});
    CHECK_FALSE(state.connected);
    CHECK_FALSE(state.working());
}

TEST_CASE("훅: 하위 에이전트는 시작하면 생기고 끝나면 사라지며, 부릴 때 붙인 설명과 짝지어진다 (AC1, AC2, AC3)") {
    HookState state;
    state = feed(state, {{"hook_event_name", "UserPromptSubmit"}});
    state = feed(state, spawn("Explore", "로그인 코드 찾기"));
    state = feed(state, spawn("general-purpose", "테스트 돌리기"));
    CHECK(state.subAgents.empty());

    // 시작 소식은 부린 순서와 다르게 올 수 있다. 종류가 같은 것과 짝짓는다
    state = feed(state, started("a2", "general-purpose"));
    state = feed(state, started("a1", "Explore"));
    REQUIRE(state.subAgents.size() == 2);
    CHECK(state.subAgents[0].id == "a2");
    CHECK(state.subAgents[0].type == "general-purpose");
    CHECK(state.subAgents[0].description == "테스트 돌리기");
    CHECK(state.subAgents[1].description == "로그인 코드 찾기");
    CHECK(state.pending.empty());

    // 같은 시작 소식이 또 와도(하위 에이전트를 이어서 시킬 때) 하나만 있다
    state = feed(state, started("a1", "Explore"));
    CHECK(state.subAgents.size() == 2);

    state = feed(state, stopped("a2"));
    REQUIRE(state.subAgents.size() == 1);
    CHECK(state.subAgents[0].id == "a1");
    state = feed(state, stopped("a1"));
    CHECK(state.subAgents.empty());

    // 설명을 알 수 없는 하위 에이전트도 종류와 함께 보인다. 예전 도구 이름(Task)도 받는다
    state = feed(state, started("a3", "Plan"));
    REQUIRE(state.subAgents.size() == 1);
    CHECK(state.subAgents[0].description.empty());
    json old = spawn("Explore", "예전 이름");
    old["tool_name"] = "Task";
    state = feed(state, old);
    state = feed(state, started("a4", "Explore"));
    CHECK(state.subAgents[1].description == "예전 이름");

    // 다른 도구를 쓰는 것은 하위 에이전트를 부리는 것이 아니다
    json bash = spawn("", "ls");
    bash["tool_name"] = "Bash";
    state = feed(state, bash);
    CHECK(state.pending.empty());
}

TEST_CASE("훅: 하위 에이전트가 돌고 있으면 답을 마친 뒤에도 작업 중이고, 뒤에서 도는 것이 없다고 하면 모두 치운다 (AC4)") {
    HookState state;
    state = feed(state, {{"hook_event_name", "UserPromptSubmit"}});
    state = feed(state, spawn("Explore", "뒤에서 찾기"));
    state = feed(state, started("a1", "Explore"));

    // 설명을 알 수 없던 것과, 끝났다는 소식을 놓친 것
    state = feed(state, started("a2", "Plan"));
    state = feed(state, started("a3", "Explore"));

    // 답은 마쳤지만 하위 에이전트 둘이 뒤에서 아직 돈다. 그 둘만 남고, 몰랐던 설명이 채워진다
    const json running = {
        {{"id", "a1"}, {"type", "subagent"}, {"status", "running"}, {"description", "뒤에서 찾기"}, {"agent_type", "Explore"}},
        {{"id", "a2"}, {"type", "subagent"}, {"status", "running"}, {"description", "계획 세우기"}, {"agent_type", "Plan"}},
        {{"id", "s1"}, {"type", "shell"}, {"status", "running"}}};
    state = feed(state, {{"hook_event_name", "Stop"}, {"background_tasks", running}});
    CHECK_FALSE(state.turnActive);
    REQUIRE(state.subAgents.size() == 2);
    CHECK(state.subAgents[0].description == "뒤에서 찾기");
    CHECK(state.subAgents[1].id == "a2");
    CHECK(state.subAgents[1].description == "계획 세우기");
    CHECK(state.working());
    state = feed(state, stopped("a2"));

    // Claude Code가 안에서 쓰는 것(종류가 없다)의 시작과 끝은 하위 에이전트 줄이 되지 않는다
    state = feed(state, started("internal", ""));
    state = feed(state, stopped("internal-2"));
    CHECK(state.subAgents.size() == 1);

    // 하위 에이전트 안에서 일어난 Stop은 주 에이전트의 것이 아니다
    state = feed(state, {{"hook_event_name", "UserPromptSubmit"}});
    state = feed(state, {{"hook_event_name", "Stop"}, {"agent_id", "a1"}});
    CHECK(state.turnActive);

    // 뒤에서 도는 것이 셸뿐이거나 이미 끝난 하위 에이전트뿐이면 남은 것을 치운다 (끝났다는 소식을 놓친 경우)
    const json none = {{{"id", "s"}, {"type", "shell"}, {"status", "running"}},
                       {{"id", "x"}, {"type", "subagent"}, {"status", "completed"}}};
    state = feed(state, {{"hook_event_name", "Stop"}, {"background_tasks", none}});
    CHECK(state.subAgents.empty());
    CHECK_FALSE(state.working());
}

TEST_CASE("훅: 허락을 물으면 허락 대기가 되고, 사용자가 답하면 풀린다 (AC5)") {
    HookState state;
    state = feed(state, {{"hook_event_name", "UserPromptSubmit"}});
    state = feed(state, {{"hook_event_name", "PermissionRequest"}, {"tool_name", "Bash"}});
    CHECK(state.asking);
    CHECK(state.working());

    // 고르느라 누른 화살표 키와, 터미널이 스스로 보내는 "창을 보고 있지 않음"은 답이 아니다
    state = noteUserInput(state, "\x1b[B");
    state = noteUserInput(state, "\x1b[O");
    CHECK(state.asking);
    state = noteUserInput(state, "\r");
    CHECK_FALSE(state.asking);
    CHECK(state.working());

    // 답하기 전에 다 답했다는 소식이 와도 풀린다
    state = feed(state, {{"hook_event_name", "PermissionRequest"}});
    state = feed(state, {{"hook_event_name", "Stop"}});
    CHECK_FALSE(state.asking);
}

TEST_CASE("훅: 답하는 중에 Esc나 Ctrl+C로 멈추게 하면 작업 중이 풀린다 (멈추게 하면 끝났다는 소식이 오지 않는다) (AC6)") {
    for (const char* key : {"\x1b", "\x03"}) {
        HookState state;
        state = feed(state, {{"hook_event_name", "UserPromptSubmit"}});
        state = feed(state, started("a1", "Explore"));
        // 글자나 화살표 키는 멈추게 하는 것이 아니다
        state = noteUserInput(state, "a");
        state = noteUserInput(state, "\x1b[A");
        CHECK(state.working());
        state = noteUserInput(state, key);
        CHECK_FALSE(state.working());
        CHECK(state.subAgents.empty());
    }

    // 훅으로 소식을 보내지 않는 에이전트의 터미널에서는 아무 일도 없다
    HookState plain;
    plain = noteUserInput(plain, "\x1b");
    CHECK_FALSE(plain.connected);
}

TEST_CASE("훅: 대화를 줄여 쓰느라 다시 시작된 것은 하던 일을 지우지 않고, 새 대화는 지운다") {
    HookState state;
    state = feed(state, {{"hook_event_name", "UserPromptSubmit"}});
    state = feed(state, started("a1", "Explore"));
    state = feed(state, {{"hook_event_name", "SessionStart"}, {"source", "compact"}});
    CHECK(state.turnActive);
    CHECK(state.subAgents.size() == 1);

    state = feed(state, {{"hook_event_name", "SessionStart"}, {"source", "clear"}});
    CHECK(state.connected);
    CHECK_FALSE(state.working());
}

TEST_CASE("훅: 모양이 다른 내용과 아주 긴 설명도 견딘다") {
    CHECK(parseHookEvent(json::array()).name.empty());
    CHECK(parseHookEvent({{"hook_event_name", 3}, {"tool_input", "x"}, {"background_tasks", 1}}).name.empty());
    HookState state;
    state = feed(state, json::object());
    CHECK_FALSE(state.connected);

    // 한글은 3바이트다. 글자 중간에서 끊기지 않는다
    std::string longText;
    for (int i = 0; i < 200; ++i) longText += "가";
    const HookEvent event = parseHookEvent(spawn("Explore", longText));
    CHECK(event.description.size() <= 200);
    CHECK(event.description.size() % 3 == 0);
}
