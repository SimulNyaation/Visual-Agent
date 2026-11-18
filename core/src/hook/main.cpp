// Claude Code의 훅이 실행하는 작은 프로그램. 훅이 표준 입력으로 넘겨준 내용(JSON)을 Visual-Agent에 그대로 전한다.
// Visual-Agent의 터미널에서 실행된 Claude Code가 아니면(환경 변수가 없으면) 아무것도 하지 않고 끝난다.
// 어떤 경우에도 아무것도 출력하지 않고 0으로 끝난다: 출력하면 Claude Code의 대화에 섞여 들어가고,
// 실패로 끝나면 Claude Code가 오류를 보여 주기 때문이다.
// 사용: va-hook claude   (Claude Code 설정의 hooks에 등록한다)
#include <cstdio>
#include <string>

#include <httplib.h>  // windows.h보다 먼저 와야 한다 (소켓 헤더가 겹친다)

#include <fcntl.h>
#include <io.h>

namespace {

// 이보다 큰 내용은 전하지 않는다
constexpr std::size_t kLargestPayload = 4 * 1024 * 1024;

std::string environment(const char* name) {
    char buffer[512];
    const DWORD length = GetEnvironmentVariableA(name, buffer, sizeof(buffer));
    return length > 0 && length < sizeof(buffer) ? std::string(buffer, length) : std::string{};
}

std::string readInput() {
    _setmode(_fileno(stdin), _O_BINARY);
    std::string input;
    char buffer[16 * 1024];
    for (;;) {
        const std::size_t count = std::fread(buffer, 1, sizeof(buffer), stdin);
        if (count == 0) break;
        input.append(buffer, count);
        if (input.size() > kLargestPayload) return {};
    }
    return input;
}

}  // namespace

int main() {
    const std::string port = environment("VA_HOOK_PORT");
    const std::string token = environment("VA_HOOK_TOKEN");
    const std::string terminal = environment("VA_TERMINAL_ID");
    if (port.empty() || token.empty() || terminal.empty()) return 0;

    const std::string input = readInput();
    if (input.empty()) return 0;

    // 확인용: 받은 내용을 파일에 한 줄씩 덧붙여 적는다 (평소에는 쓰지 않는다)
    const std::string log = environment("VA_HOOK_LOG");
    if (!log.empty()) {
        FILE* file = nullptr;
        if (fopen_s(&file, log.c_str(), "ab") == 0 && file != nullptr) {
            std::fwrite(input.data(), 1, input.size(), file);
            std::fputc('\n', file);
            std::fclose(file);
        }
    }

    try {
        httplib::Client client("127.0.0.1", std::stoi(port));
        // 앱이 답하지 않아도 Claude Code를 오래 붙잡지 않는다
        client.set_connection_timeout(0, 500 * 1000);
        client.set_read_timeout(1, 0);
        client.set_write_timeout(1, 0);
        client.Post("/api/hooks/claude", {{"X-VA-Hook-Token", token}, {"X-VA-Terminal", terminal}}, input,
                    "application/json");
    } catch (...) {
    }
    return 0;
}
