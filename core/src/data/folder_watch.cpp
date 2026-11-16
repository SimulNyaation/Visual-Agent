#include "data/folder_watch.h"

#include <windows.h>

namespace va::data {

namespace {
// 한 번에 기다릴 수 있는 수(64)에서 깨우기 신호 하나를 뺀 값
constexpr std::size_t kMaxWatches = MAXIMUM_WAIT_OBJECTS - 1;
}  // namespace

ChangeWait::ChangeWait() : wake_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}

ChangeWait::~ChangeWait() {
    disarm();
    if (wake_) CloseHandle(wake_);
}

void ChangeWait::disarm() {
    for (void* watch : watches_) FindCloseChangeNotification(watch);
    watches_.clear();
}

bool ChangeWait::arm(const std::vector<std::filesystem::path>& folders) {
    disarm();
    bool all = true;
    for (const auto& folder : folders) {
        if (watches_.size() >= kMaxWatches) {
            all = false;
            break;
        }
        const HANDLE watch = FindFirstChangeNotificationW(
            folder.c_str(), FALSE, FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME);
        if (watch == INVALID_HANDLE_VALUE) {
            all = false;  // 없어진 폴더. 다시 읽을 때 드러난다
            continue;
        }
        watches_.push_back(watch);
    }
    return all;
}

void ChangeWait::wait(std::chrono::milliseconds timeout) {
    if (cancelled_ || !wake_) return;
    std::vector<HANDLE> handles;
    handles.push_back(wake_);
    for (void* watch : watches_) handles.push_back(watch);
    WaitForMultipleObjects(static_cast<DWORD>(handles.size()), handles.data(), FALSE,
                           static_cast<DWORD>(timeout.count()));
}

void ChangeWait::cancel() {
    cancelled_ = true;
    if (wake_) SetEvent(wake_);
}

}  // namespace va::data
