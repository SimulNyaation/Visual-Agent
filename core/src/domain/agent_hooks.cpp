#include "domain/agent_hooks.h"

#include <algorithm>

namespace va::domain {

namespace {

// 설명과 종류를 이보다 길게 들고 있지 않는다
constexpr std::size_t kLongestText = 200;
// 하위 에이전트를 이보다 많이 기억하지 않는다 (끝났다는 소식을 놓쳐도 끝없이 쌓이지 않게)
constexpr std::size_t kMostSubAgents = 50;

// UTF-8 글자의 중간에서 끊지 않고 줄인다
std::string shortened(std::string text) {
    if (text.size() <= kLongestText) return text;
    std::size_t end = kLongestText;
    while (end > 0 && (static_cast<unsigned char>(text[end]) & 0xC0) == 0x80) --end;
    text.resize(end);
    return text;
}

std::string textOf(const nlohmann::json& object, const char* key) {
    if (!object.is_object()) return {};
    const auto it = object.find(key);
    return it != object.end() && it->is_string() ? shortened(it->get<std::string>()) : std::string{};
}

// 뒤에서 돌리는 일 하나가 "아직 돌고 있는 하위 에이전트"인가
bool isRunningSubAgent(const nlohmann::json& task) {
    if (textOf(task, "type") != "subagent") return false;
    const std::string status = textOf(task, "status");
    static const char* const kEnded[] = {"completed", "failed",  "killed", "cancelled",
                                         "canceled",  "stopped", "done",   "error"};
    return std::none_of(std::begin(kEnded), std::end(kEnded),
                        [&](const char* ended) { return status == ended; });
}

// 하위 에이전트를 부리는 도구 (예전 이름은 Task)
bool isSubAgentTool(const std::string& tool) { return tool == "Agent" || tool == "Task"; }

void forget(std::vector<SubAgent>& list, const std::string& id) {
    list.erase(std::remove_if(list.begin(), list.end(), [&](const SubAgent& item) { return item.id == id; }),
               list.end());
}

}  // namespace

HookEvent parseHookEvent(const nlohmann::json& payload) {
    HookEvent event;
    event.name = textOf(payload, "hook_event_name");
    event.source = textOf(payload, "source");
    event.agentId = textOf(payload, "agent_id");
    event.agentType = textOf(payload, "agent_type");
    event.toolName = textOf(payload, "tool_name");
    if (payload.is_object() && payload.contains("tool_input")) {
        event.subagentType = textOf(payload["tool_input"], "subagent_type");
        event.description = textOf(payload["tool_input"], "description");
    }
    if (payload.is_object() && payload.contains("background_tasks") && payload["background_tasks"].is_array()) {
        for (const auto& task : payload["background_tasks"]) {
            if (!isRunningSubAgent(task)) continue;
            event.backgroundSubAgents.push_back(
                {textOf(task, "id"), textOf(task, "agent_type"), textOf(task, "description")});
        }
    }
    return event;
}

HookState applyHookEvent(HookState state, const HookEvent& event) {
    const bool fromMain = event.agentId.empty() || event.name == "SubagentStart" || event.name == "SubagentStop";

    if (event.name == "SessionEnd") return {};
    if (event.name == "SessionStart") {
        // 대화를 줄여 쓰느라(compact) 다시 시작된 것은 답하던 중에도 일어난다. 그때는 상태를 그대로 둔다
        if (event.source == "compact") {
            state.connected = true;
            return state;
        }
        HookState fresh;
        fresh.connected = true;
        return fresh;
    }
    if (event.name.empty()) return state;
    state.connected = true;

    if (event.name == "UserPromptSubmit") {
        state.turnActive = true;
        state.asking = false;
    } else if (event.name == "Stop" || event.name == "StopFailure") {
        if (!fromMain) return state;
        state.turnActive = false;
        state.asking = false;
        state.pending.clear();
        // 답을 마쳤으면 뒤에서 돌고 있다고 알려 준 하위 에이전트만 남는다. 끝났다는 소식을 놓친 것은 여기서 치운다
        const auto& running = event.backgroundSubAgents;
        for (auto it = state.subAgents.begin(); it != state.subAgents.end();) {
            const auto same = std::find_if(running.begin(), running.end(),
                                           [&](const SubAgent& item) { return item.id == it->id; });
            if (same == running.end()) {
                it = state.subAgents.erase(it);
                continue;
            }
            if (it->description.empty()) it->description = same->description;
            ++it;
        }
    } else if (event.name == "PermissionRequest") {
        state.asking = true;
        if (fromMain) state.turnActive = true;
    } else if (event.name == "PreToolUse") {
        state.asking = false;
        if (fromMain) state.turnActive = true;
        if (isSubAgentTool(event.toolName) && state.pending.size() < kMostSubAgents) {
            state.pending.push_back({{}, event.subagentType, event.description});
        }
    } else if (event.name == "SubagentStart") {
        // 종류가 없는 것은 Claude Code가 안에서 쓰는 것(예: 대화 제목 짓기)이다. 사용자가 부린 것이 아니다
        if (event.agentId.empty() || event.agentType.empty()) return state;
        const bool known = std::any_of(state.subAgents.begin(), state.subAgents.end(),
                                       [&](const SubAgent& item) { return item.id == event.agentId; });
        if (known || state.subAgents.size() >= kMostSubAgents) return state;
        // 부리겠다고 한 것 가운데 종류가 같은 가장 앞의 것과 짝짓는다
        auto match = std::find_if(state.pending.begin(), state.pending.end(),
                                  [&](const SubAgent& item) { return item.type == event.agentType; });
        SubAgent started{event.agentId, event.agentType, {}};
        if (match != state.pending.end()) {
            started.description = match->description;
            state.pending.erase(match);
        }
        state.subAgents.push_back(std::move(started));
    } else if (event.name == "SubagentStop") {
        forget(state.subAgents, event.agentId);
    }
    return state;
}

HookState noteUserInput(HookState state, std::string_view bytes) {
    if (!state.connected || bytes.empty()) return state;
    // 화살표 키, 그리고 터미널이 스스로 보내는 것(창을 보고 있는지, 마우스)은 ESC로 시작한다. 답한 것이 아니다
    const bool sequence = bytes.size() > 1 && bytes[0] == '\x1b' && bytes != "\x1b\x1b";
    if (!sequence) state.asking = false;
    const bool interrupt = bytes == "\x1b" || bytes == "\x1b\x1b" || bytes.find('\x03') != std::string_view::npos;
    if (interrupt && state.turnActive) {
        state.turnActive = false;
        state.subAgents.clear();
        state.pending.clear();
    }
    return state;
}

}  // namespace va::domain
