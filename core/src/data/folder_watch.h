// 폴더 안의 이름이 바뀔 때까지 기다린다. 지켜보라고 한 폴더만 지켜본다.
#pragma once

#include <atomic>
#include <chrono>
#include <filesystem>
#include <vector>

namespace va::data {

class ChangeWait {
public:
    ChangeWait();
    ~ChangeWait();
    ChangeWait(const ChangeWait&) = delete;
    ChangeWait& operator=(const ChangeWait&) = delete;

    // 이 폴더들을 지켜보기 시작한다. 내용을 읽기 전에 불러야 그 사이의 변화를 놓치지 않는다.
    // 한 번에 지켜볼 수 있는 수를 넘으면 false. 그때는 짧게 기다렸다가 다시 읽어야 한다
    bool arm(const std::vector<std::filesystem::path>& folders);

    // 지켜보는 폴더에서 이름이 생기거나 없어지거나 바뀌면, cancel되면, 시간이 다 되면 돌아온다
    void wait(std::chrono::milliseconds timeout);

    // 다른 스레드에서 기다림을 끝낸다
    void cancel();
    bool cancelled() const { return cancelled_; }

private:
    void disarm();

    void* wake_ = nullptr;
    std::vector<void*> watches_;
    std::atomic<bool> cancelled_{false};
};

}  // namespace va::data
