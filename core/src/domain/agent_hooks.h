// 에이전트(Claude Code)가 훅으로 직접 알려 주는 소식의 규칙: 지금 답하는 중인지, 허락을 기다리는지,
// 어떤 하위 에이전트를 부리고 있는지. 파일 시스템, 프로세스, 창을 모른다.
#pragma once

#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

namespace va::domain {

// 에이전트가 부린 하위 에이전트 하나
struct SubAgent {
    std::string id;
    std::string type;         // 종류. 예: "Explore"
    std::string description;  // 맡긴 일의 짧은 설명. 알 수 없으면 빈 문자열
};

// 훅 하나가 알려 준 내용 가운데 쓰는 것만 추린 것
struct HookEvent {
    std::string name;          // 예: "UserPromptSubmit", "SubagentStart"
    std::string source;        // SessionStart일 때: startup, resume, clear, compact …
    std::string agentId;       // 하위 에이전트 안에서 일어난 일이면 그 하위 에이전트
    std::string agentType;
    std::string toolName;      // 도구에 관한 소식일 때
    std::string subagentType;  // 하위 에이전트를 부리는 도구일 때: 부릴 종류와 설명
    std::string description;
    std::vector<SubAgent> backgroundSubAgents;  // Stop일 때: 뒤에서 아직 돌고 있는 하위 에이전트
};

// 훅이 넘겨준 JSON에서 쓰는 것만 읽는다. 모양이 달라도 읽을 수 있는 만큼 읽는다
HookEvent parseHookEvent(const nlohmann::json& payload);

// 터미널 하나에서 에이전트가 알려 준 지금까지의 상태
struct HookState {
    bool connected = false;   // 이 터미널의 에이전트가 훅으로 소식을 보내고 있다
    bool turnActive = false;  // 질문을 받아 답하는 중 (다 답했다는 소식이 아직 없다)
    bool asking = false;      // 허락을 묻고 기다리는 중
    std::vector<SubAgent> subAgents;  // 지금 돌고 있는 하위 에이전트 (시작한 순서)
    // 부리겠다고 한 뒤 아직 시작 소식이 오지 않은 하위 에이전트 (설명을 짝지어 주려고 기억한다)
    std::vector<SubAgent> pending;

    // 에이전트가 스스로 "작업 중"이라고 알려 준 상태인가
    bool working() const { return turnActive || !subAgents.empty(); }
};

// 훅 소식 하나를 받아 상태를 고친다
HookState applyHookEvent(HookState state, const HookEvent& event);

// 사용자가 터미널에 글자를 넣었다. 허락을 묻던 중이면 답한 것으로 보고,
// 답하는 중에 Esc나 Ctrl+C를 넣었으면 멈추게 한 것으로 본다 (멈추게 하면 "다 답했다"는 소식이 오지 않는다)
HookState noteUserInput(HookState state, std::string_view bytes);

}  // namespace va::domain
