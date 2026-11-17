// 터미널 테스트에서 에이전트 대신 실행하는 시험용 프로그램.
// 실제 에이전트처럼 화면 전체를 쓰고(다른 화면으로 바꾸고, 색과 테두리를 그리고, 커서를 옮긴다),
// 받은 키의 이름을 화면과 기록 파일에 적는다. q나 Ctrl+C를 받으면 끝난다.
// 사용: va_fake_agent [기록 파일]
#include <cstdio>
#include <string>

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

    put("\x1b[?1049h");
    draw("-");

    for (;;) {
        char buffer[64];
        DWORD count = 0;
        if (!ReadFile(in, buffer, sizeof(buffer), &count, nullptr) || count == 0) break;
        const std::string name = keyName(std::string(buffer, count));

        if (argc > 1) {
            FILE* log = nullptr;
            if (fopen_s(&log, argv[1], "ab") == 0 && log != nullptr) {
                std::fprintf(log, "%s\n", name.c_str());
                std::fclose(log);
            }
        }
        if (name == "q" || name == "CTRL+C") break;
        draw(name);
    }

    put("\x1b[?1049l");
    return 0;
}
