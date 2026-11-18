#include "data/pty.h"

#include <algorithm>
#include <cwchar>
#include <cwctype>

#include <windows.h>

#include <tlhelp32.h>

namespace va::data {

namespace {

// 프로그램이 시작한 시각. 알 수 없으면 0
unsigned long long startedAt(unsigned long id) {
    const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, id);
    if (process == nullptr) return 0;
    FILETIME created{}, exited{}, kernel{}, user{};
    const BOOL ok = GetProcessTimes(process, &created, &exited, &kernel, &user);
    CloseHandle(process);
    if (!ok) return 0;
    return (static_cast<unsigned long long>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
}

// ids에 든 프로그램이 띄운 프로그램, 또 그 프로그램이 띄운 프로그램을 차례로 찾아 ids에 더한다.
// 작업 묶음만으로는 빠지는 경우가 있다: Microsoft Store로 설치한 PowerShell 7은 Windows가 따로 관리해,
// 그 안에서 실행한 프로그램이 우리 작업 묶음에 들어오지 않는다
void addDescendants(std::vector<unsigned long>& ids) {
    const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return;

    std::vector<std::pair<unsigned long, unsigned long>> parents;  // (프로그램, 그것을 띄운 프로그램)
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    for (BOOL more = Process32FirstW(snapshot, &entry); more; more = Process32NextW(snapshot, &entry)) {
        parents.emplace_back(entry.th32ProcessID, entry.th32ParentProcessID);
    }
    CloseHandle(snapshot);

    const auto known = [&](unsigned long id) { return std::find(ids.begin(), ids.end(), id) != ids.end(); };
    for (bool added = true; added;) {
        added = false;
        for (const auto& [id, parent] : parents) {
            if (id == 0 || known(id) || !known(parent)) continue;
            // Windows는 끝난 프로그램의 번호를 다시 쓴다. "띄운 프로그램의 번호"가 우연히 같을 뿐인 무관한 프로그램을
            // 걸러내기 위해, 띄운 쪽보다 나중에 시작한 것만 받아들인다
            const auto born = startedAt(id);
            const auto parentBorn = startedAt(parent);
            if (born == 0 || parentBorn == 0 || born < parentBorn) continue;
            ids.push_back(id);
            added = true;
        }
    }
}

std::wstring upper(std::wstring text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](wchar_t c) { return static_cast<wchar_t>(std::towupper(c)); });
    return text;
}

// 앱의 환경 변수에 extra를 더한 묶음 ("이름=값" 뒤에 0, 맨 끝에 0 하나 더). extra가 없으면 빈 값
std::wstring environmentBlock(const std::vector<std::pair<std::wstring, std::wstring>>& extra) {
    if (extra.empty()) return {};
    std::wstring block;
    wchar_t* const current = GetEnvironmentStringsW();
    if (current != nullptr) {
        for (const wchar_t* item = current; *item != L'\0'; item += std::wcslen(item) + 1) {
            const std::wstring entry = item;
            // "=C:=C:\..."처럼 =로 시작하는 것은 드라이브마다의 현재 위치다. 이름의 끝은 그 뒤의 =이다
            const std::wstring name = upper(entry.substr(0, entry.find(L'=', 1)));
            const bool replaced = std::any_of(extra.begin(), extra.end(),
                                              [&](const auto& pair) { return upper(pair.first) == name; });
            if (!replaced) block.append(entry).push_back(L'\0');
        }
        FreeEnvironmentStringsW(current);
    }
    for (const auto& [name, value] : extra) block.append(name + L"=" + value).push_back(L'\0');
    block.push_back(L'\0');
    return block;
}

void closeHandle(void*& handle) {
    if (handle != nullptr && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    handle = nullptr;
}

}  // namespace

std::unique_ptr<Pty> Pty::start(const Options& options) {
    std::unique_ptr<Pty> pty(new Pty());

    HANDLE inputRead = nullptr;
    HANDLE inputWrite = nullptr;
    HANDLE outputRead = nullptr;
    HANDLE outputWrite = nullptr;
    if (!CreatePipe(&inputRead, &inputWrite, nullptr, 0)) return nullptr;
    if (!CreatePipe(&outputRead, &outputWrite, nullptr, 0)) {
        CloseHandle(inputRead);
        CloseHandle(inputWrite);
        return nullptr;
    }
    pty->input_ = inputWrite;
    pty->output_ = outputRead;

    HPCON console = nullptr;
    const HRESULT created =
        CreatePseudoConsole(COORD{options.columns, options.rows}, inputRead, outputWrite, 0, &console);
    // 콘솔이 자기 몫의 손잡이를 따로 가져갔으므로 이쪽 것은 닫는다
    CloseHandle(inputRead);
    CloseHandle(outputWrite);
    if (FAILED(created)) return nullptr;
    pty->console_ = console;

    SIZE_T attributeSize = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeSize);
    std::vector<char> attributeBuffer(attributeSize);
    auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributeBuffer.data());
    if (!InitializeProcThreadAttributeList(attributes, 1, 0, &attributeSize)) return nullptr;
    if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, console,
                                   sizeof(console), nullptr, nullptr)) {
        DeleteProcThreadAttributeList(attributes);
        return nullptr;
    }

    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    // 앱의 표준 입출력이 다른 곳으로 이어져 있으면 셸이 콘솔 대신 그쪽에 쓰게 된다. 물려주지 않는다고 못 박는다
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.lpAttributeList = attributes;

    std::wstring command = L"\"" + options.program.wstring() + L"\"";
    if (!options.arguments.empty()) command += L" " + options.arguments;

    // 앱이 "Ctrl+C 무시" 상태로 실행됐으면(다른 프로그램이 새 그룹으로 띄운 경우) 그 상태가 셸과 그 안의 프로그램에 물려져
    // 터미널에서 Ctrl+C로 프로그램을 멈출 수 없게 된다. 물려주기 전에 보통 상태로 돌려놓는다
    SetConsoleCtrlHandler(nullptr, FALSE);

    std::wstring environment = environmentBlock(options.environment);

    PROCESS_INFORMATION info{};
    const BOOL started = CreateProcessW(
        options.program.c_str(), command.data(), nullptr, nullptr, FALSE,
        EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
        environment.empty() ? nullptr : environment.data(),
        options.directory.c_str(), &startup.StartupInfo, &info);
    DeleteProcThreadAttributeList(attributes);
    if (!started) return nullptr;

    pty->process_ = info.hProcess;
    pty->pid_ = info.dwProcessId;

    // 셸에서 실행된 프로그램을 나중에 알아낼 수 있게 묶어 둔다. 묶지 못해도 터미널은 쓸 수 있다
    pty->job_ = CreateJobObjectW(nullptr, nullptr);
    if (pty->job_ != nullptr && !AssignProcessToJobObject(pty->job_, info.hProcess)) {
        closeHandle(pty->job_);
    }
    ResumeThread(info.hThread);
    CloseHandle(info.hThread);
    return pty;
}

Pty::~Pty() {
    close();
    kill();
    closeHandle(output_);
    closeHandle(process_);
    closeHandle(job_);
}

bool Pty::read(std::string& out) {
    char buffer[16384];
    DWORD count = 0;
    if (!ReadFile(output_, buffer, sizeof(buffer), &count, nullptr) || count == 0) return false;
    out.assign(buffer, count);
    return true;
}

bool Pty::write(std::string_view bytes) {
    std::lock_guard lock(mutex_);
    if (input_ == nullptr) return false;
    while (!bytes.empty()) {
        DWORD written = 0;
        if (!WriteFile(input_, bytes.data(), static_cast<DWORD>(bytes.size()), &written, nullptr) ||
            written == 0) {
            return false;
        }
        bytes.remove_prefix(written);
    }
    return true;
}

void Pty::resize(short columns, short rows) {
    std::lock_guard lock(mutex_);
    if (console_ != nullptr) ResizePseudoConsole(console_, COORD{columns, rows});
}

void Pty::close() {
    void* console = nullptr;
    {
        std::lock_guard lock(mutex_);
        console = console_;
        console_ = nullptr;
        closeHandle(input_);
    }
    if (console != nullptr) ClosePseudoConsole(console);
}

void Pty::abortRead() { CancelIoEx(output_, nullptr); }

void Pty::kill() {
    if (process_ != nullptr && !exited()) TerminateProcess(process_, 1);
}

bool Pty::exited() const { return WaitForSingleObject(process_, 0) == WAIT_OBJECT_0; }

std::vector<unsigned long> Pty::processIds() const {
    std::vector<unsigned long> ids;
    if (!exited()) ids.push_back(pid_);

    // 작업 묶음에 든 것. 셸이 끝난 뒤에도 남아 도는 프로그램까지 알 수 있다
    if (job_ != nullptr) {
        constexpr DWORD kMost = 512;
        std::vector<char> buffer(sizeof(JOBOBJECT_BASIC_PROCESS_ID_LIST) + kMost * sizeof(ULONG_PTR));
        auto* list = reinterpret_cast<JOBOBJECT_BASIC_PROCESS_ID_LIST*>(buffer.data());
        if (QueryInformationJobObject(job_, JobObjectBasicProcessIdList, list,
                                      static_cast<DWORD>(buffer.size()), nullptr)) {
            for (DWORD i = 0; i < list->NumberOfProcessIdsInList; ++i) {
                const auto id = static_cast<unsigned long>(list->ProcessIdList[i]);
                if (std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
            }
        }
    }
    // 작업 묶음에 들어오지 않은 것은 누가 누구를 띄웠는지를 따라가 찾는다
    if (!ids.empty()) addDescendants(ids);
    return ids;
}

}  // namespace va::data
