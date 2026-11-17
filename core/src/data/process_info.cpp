#include "data/process_info.h"

#include <filesystem>

#include <windows.h>

namespace va::data {

namespace {

// Windows가 공개 헤더에 넣지 않은 것들. 다른 프로그램의 명령줄을 읽는 방법은 이것뿐이다
struct UnicodeText {
    USHORT length;         // 바이트 수
    USHORT maximumLength;
    PWSTR buffer;
};
constexpr int kProcessCommandLine = 60;
using QueryProcessFn = LONG(NTAPI*)(HANDLE, int, PVOID, ULONG, PULONG);

QueryProcessFn queryProcess() {
    static const auto function = reinterpret_cast<QueryProcessFn>(reinterpret_cast<void*>(
        GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationProcess")));
    return function;
}

std::wstring imageName(HANDLE process) {
    std::wstring path(1024, L'\0');
    DWORD length = static_cast<DWORD>(path.size());
    if (!QueryFullProcessImageNameW(process, 0, path.data(), &length)) return {};
    path.resize(length);
    return std::filesystem::path(path).filename().wstring();
}

std::wstring commandLine(HANDLE process) {
    const auto query = queryProcess();
    if (query == nullptr) return {};
    std::vector<char> buffer(sizeof(UnicodeText) + 32768 * sizeof(wchar_t));
    ULONG needed = 0;
    if (query(process, kProcessCommandLine, buffer.data(), static_cast<ULONG>(buffer.size()), &needed) < 0) {
        return {};
    }
    const auto* text = reinterpret_cast<const UnicodeText*>(buffer.data());
    if (text->buffer == nullptr) return {};
    return std::wstring(text->buffer, text->length / sizeof(wchar_t));
}

}  // namespace

std::vector<domain::ProcessInfo> describeProcesses(const std::vector<unsigned long>& processIds) {
    std::vector<domain::ProcessInfo> result;
    for (const unsigned long pid : processIds) {
        const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (process == nullptr) continue;
        domain::ProcessInfo info;
        info.pid = pid;
        info.image = imageName(process);
        if (domain::needsCommandLine(info.image)) info.commandLine = commandLine(process);
        CloseHandle(process);
        if (!info.image.empty()) result.push_back(std::move(info));
    }
    return result;
}

}  // namespace va::data
