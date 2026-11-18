// 터미널 테스트에서 에이전트 대신 실행하는 시험용 프로그램.
// 실제 에이전트처럼 화면 전체를 쓰고(다른 화면으로 바꾸고, 색과 테두리를 그리고, 커서를 옮긴다),
// 받은 키의 이름을 화면과 기록 파일에 적는다. q나 Ctrl+C를 받으면 끝난다.
// 실제 에이전트처럼 터미널 제목도 알려 준다: 시작할 때 자기 이름, F2·F3을 받으면 대화의 주제, F4를 받으면 폴더 경로.
// 실제 에이전트가 작업하는 모습도 흉내 낸다: w를 받으면 4초, e를 받으면 1초 동안 0.2초마다 진행 표시를 그린다.
// 사용: va_fake_agent [기록 파일]
#include <cstdio>
#include <atomic>
#include <string>
#include <thread>

#include <windows.h>

namespace {

HANDLE g_out = nullptr;

void put(const std::string& text) {
    DWORD written = 0;
    WriteFile(g_out, text.data(), static_cast<DWORD>(text.size()), &written, nullptr);
}

std::string sizeText() {
    CONSOLE_SCREEN_BUFFER_INFO info{};
    GetConsoleScreenBufferInfo(g_out, &info);
    const int columns = info.srWindow.Right - info.srWindow.Left + 1;
    const int rows = info.srWindow.Bottom - info.srWindow.Top + 1;
    return std::to_string(columns) + "x" + std::to_string(rows);
}

void draw(const std::string& lastKey) {
    std::string screen = "\x1b[2J\x1b[H";
    screen += "\x1b[1;1H\x1b[33m\xE2\x94\x8C";  // ┌
    for (int i = 0; i < 30; ++i) screen += "\xE2\x94\x80";  // ─
    screen += "\xE2\x94\x90\x1b[0m";  // ┐
    screen += "\x1b[2;3H\x1b[32mFAKE AGENT READY\x1b[0m";
    screen += "\x1b[3;3Hsize " + sizeText();
    screen += "\x1b[4;3Hlast key: " + lastKey;
    screen += "\x1b[5;1H\x1b[33m\xE2\x94\x94";  // └
    for (int i = 0; i < 30; ++i) screen += "\xE2\x94\x80";
    screen += "\xE2\x94\x98\x1b[0m";  // ┘
    screen += "\x1b[4;13H";
    put(screen);
}

void setTitle(const std::string& title) {
    put("\x1b]0;" + title + "\x07");
}

// 받은 글자에 제목을 바꾸는 키가 들어 있으면 제목을 알려 준다 (키 여러 개가 한꺼번에 읽힐 수 있다)
void announceTitle(const std::string& bytes) {
    const auto has = [&bytes](const char* key) { return bytes.find(key) != std::string::npos; };
    if (has("\x1bOQ")) setTitle("\xE2\x9C\xB3 Fix login error");  // F2: ✳ + 주제
    if (has("\x1bOR")) setTitle("\xE2\xA0\x90 Translate README");  // F3: 진행 표시 + 다른 주제
    if (has("\x1bOS")) setTitle("C:\\work\\alpha");  // F4: 주제가 아닌 것
}

std::atomic<int> g_ticksLeft{0};

// 작업하는 동안 화면 넷째 줄 아래에 진행 표시를 계속 고쳐 그린다
void workLoop() {
    int drawn = 0;
    for (;;) {
        Sleep(200);
        if (g_ticksLeft.load() <= 0) continue;
        --g_ticksLeft;
        put("\x1b[s\x1b[6;3Hworking " + std::to_string(++drawn) + "   \x1b[u");
        if (g_ticksLeft.load() == 0) put("\x1b[s\x1b[6;3Hwork done      \x1b[u");
    }
}

std::string keyName(const std::string& bytes) {
    if (bytes == "\x1b[A") return "UP";
    if (bytes == "\x1b[B") return "DOWN";
    if (bytes == "\x1b[C") return "RIGHT";
    if (bytes == "\x1b[D") return "LEFT";
    if (bytes == "\x1b") return "ESC";
    if (bytes == "\r") return "ENTER";
    if (bytes == "\x03") return "CTRL+C";
    return bytes;
}

}  // namespace

int main(int argc, char** argv) {
    const HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
    g_out = GetStdHandle(STD_OUTPUT_HANDLE);
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleMode(in, ENABLE_VIRTUAL_TERMINAL_INPUT);
    SetConsoleMode(g_out, ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING);

    std::thread(workLoop).detach();
    put("\x1b[?1049h");
    setTitle("claude");
    draw("-");

    for (;;) {
        char buffer[64];
        DWORD count = 0;
        if (!ReadFile(in, buffer, sizeof(buffer), &count, nullptr) || count == 0) break;
        announceTitle(std::string(buffer, count));
        const std::string name = keyName(std::string(buffer, count));

        if (argc > 1) {
            FILE* log = nullptr;
            if (fopen_s(&log, argv[1], "ab") == 0 && log != nullptr) {
                std::fprintf(log, "%s\n", name.c_str());
                std::fclose(log);
            }
        }
        if (name == "q" || name == "CTRL+C") break;
        if (name == "w") g_ticksLeft = 20;
        if (name == "e") g_ticksLeft = 5;
        draw(name);
    }

    put("\x1b[?1049l");
    return 0;
}
