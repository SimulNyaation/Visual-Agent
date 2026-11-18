// 셸 하나를 화면 없는 콘솔(Windows 가상 콘솔)에 띄우고 글자를 주고받는다.
#pragma once

#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace va::data {

class Pty {
public:
    struct Options {
        std::filesystem::path program;
        std::wstring arguments;
        std::filesystem::path directory;  // 시작 위치
        // 앱의 환경 변수에 더해 셸에 넘길 것 (이름, 값). 같은 이름이 있으면 이것으로 바꾼다
        std::vector<std::pair<std::wstring, std::wstring>> environment;
        short columns = 120;
        short rows = 30;
    };

    // 띄우지 못하면 빈 값
    static std::unique_ptr<Pty> start(const Options& options);
    ~Pty();

    Pty(const Pty&) = delete;
    Pty& operator=(const Pty&) = delete;

    // 출력이 올 때까지 기다렸다가 받는다. 콘솔이 닫혀 더 올 것이 없으면 false
    bool read(std::string& out);
    bool write(std::string_view bytes);
    void resize(short columns, short rows);

    // 콘솔을 닫는다. 이 콘솔에 붙어 돌던 셸과 프로그램은 Windows가 끝낸다
    void close();
    // 기다리고 있는 read를 깨운다
    void abortRead();
    // 셸이 아직 살아 있으면 끝낸다. 콘솔이 닫힌 뒤에 부른다.
    // 셸이 콘솔에 붙기도 전에 콘솔이 닫히면 Windows가 그 셸을 끝내 주지 않아 혼자 남기 때문이다
    void kill();

    bool exited() const;
    unsigned long pid() const { return pid_; }
    // 이 셸과 셸에서 실행된 프로그램들
    std::vector<unsigned long> processIds() const;

private:
    Pty() = default;

    std::mutex mutex_;  // console_과 input_을 닫는 것과 쓰는 것이 겹치지 않게 한다
    void* console_ = nullptr;
    void* input_ = nullptr;   // 셸로 보내는 쪽
    void* output_ = nullptr;  // 셸에서 받는 쪽
    void* process_ = nullptr;
    void* job_ = nullptr;     // 셸에서 실행된 프로그램을 알아내는 데만 쓴다
    unsigned long pid_ = 0;
};

}  // namespace va::data
