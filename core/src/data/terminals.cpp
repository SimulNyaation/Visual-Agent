#include "data/terminals.h"

#include <algorithm>

#include "data/process_info.h"
#include "domain/terminal_rules.h"

namespace va::data {

namespace {

using namespace std::chrono_literals;

// 화면이 받아 가지 않은 출력을 이만큼까지만 쌓아 둔다. 넘으면 셸의 출력을 잠시 붙잡아 둔다
constexpr std::size_t kMostQueuedBytes = 4 * 1024 * 1024;
// 한 번에 화면으로 보내는 양
constexpr std::size_t kMostBytesPerWait = 512 * 1024;
// 한 덩어리로 합치는 크기
constexpr std::size_t kChunkBytes = 64 * 1024;
// 실행 중인 에이전트와 셸 종료를 살피는 간격
constexpr auto kMonitorInterval = 500ms;
// 터미널을 닫은 뒤 이 시간이 지나도 셸이 살아 있으면 직접 끝낸다.
// 셸이 콘솔에 붙기도 전에 콘솔을 닫으면 Windows가 그 셸을 끝내 주지 않고, 콘솔도 닫히지 않은 채 남기 때문이다
constexpr auto kCloseGrace = 1000ms;
// 앱을 닫을 때 터미널의 뒷정리를 기다려 주는 시간. 넘으면 기다리지 않고 끝낸다.
// 그때까지 끝나지 않은 셸과 프로그램은 콘솔이 닫힌 것을 알게 된 Windows가 마저 끝낸다
constexpr auto kShutdownGrace = 2000ms;

short clampSize(int value, int low, int high) {
    return static_cast<short>(std::clamp(value, low, high));
}

}  // namespace

Terminals::Terminals(std::vector<InstalledShell> shells) : shells_(std::move(shells)) {
    monitor_ = std::thread([this] { monitorLoop(); });
}

Terminals::~Terminals() { shutdown(); }

std::shared_ptr<Terminals::Entry> Terminals::find(const std::string& id) {
    std::lock_guard lock(mutex_);
    const auto it = std::find_if(entries_.begin(), entries_.end(),
                                 [&](const auto& entry) { return entry->id == id; });
    return it == entries_.end() ? nullptr : *it;
}

std::vector<std::shared_ptr<Terminals::Entry>> Terminals::entriesOfTab(const std::string& tabId) {
    std::lock_guard lock(mutex_);
    std::vector<std::shared_ptr<Entry>> result;
    for (const auto& entry : entries_) {
        if (entry->tabId == tabId) result.push_back(entry);
    }
    return result;
}

std::vector<TerminalView> Terminals::viewsLocked() const {
    std::vector<TerminalView> views;
    for (const auto& entry : entries_) {
        views.push_back({entry->id, entry->tabId, entry->shellId, entry->name, entry->agent, entry->busy});
    }
    return views;
}

bool Terminals::busyNow(const Entry& entry) {
    if (entry.pty->exited()) return false;
    return domain::hasRunningProgram(describeProcesses(entry.pty->processIds()), entry.pty->pid());
}

std::optional<TerminalView> Terminals::open(const std::string& tabId,
                                            const std::filesystem::path& directory) {
    const InstalledShell* shell = nullptr;
    std::unique_ptr<Pty> pty;
    for (const auto& candidate : shells_) {
        Pty::Options options;
        options.program = candidate.program;
        options.arguments = candidate.arguments;
        options.directory = directory;
        pty = Pty::start(options);
        if (pty) {
            shell = &candidate;
            break;
        }
    }
    if (!pty) return std::nullopt;

    auto entry = std::make_shared<Entry>();
    entry->tabId = tabId;
    entry->shellId = shell->id;
    entry->pty = std::move(pty);

    std::lock_guard lock(mutex_);
    if (stopping_) return std::nullopt;
    std::vector<unsigned> used;
    for (const auto& other : entries_) {
        if (other->tabId == tabId) used.push_back(other->number);
    }
    entry->id = "p" + std::to_string(nextId_++);
    entry->number = domain::nextTerminalNumber(used);
    entry->name = domain::terminalName(shell->label, entry->number);
    entries_.push_back(entry);
    entry->reader = std::thread([this, entry] { readLoop(entry); });
    ++version_;
    changed_.notify_all();
    return TerminalView{entry->id, entry->tabId, entry->shellId, entry->name, {}, false};
}

void Terminals::readLoop(const std::shared_ptr<Entry>& entry) {
    std::string data;
    while (entry->pty->read(data)) {
        std::unique_lock lock(mutex_);
        changed_.wait(lock, [&] {
            return queuedBytes_ < kMostQueuedBytes || stopping_ || entry->closing;
        });
        if (stopping_) break;
        // 닫는 중인 터미널의 출력은 자리가 없으면 버린다
        if (queuedBytes_ >= kMostQueuedBytes) continue;

        queuedBytes_ += data.size();
        if (!queue_.empty() && queue_.back().id == entry->id &&
            queue_.back().bytes.size() + data.size() <= kChunkBytes) {
            queue_.back().bytes += data;
        } else {
            queue_.push_back({entry->id, data});
        }
        changed_.notify_all();
    }
    // 읽기가 끝났다는 것은 콘솔이 닫혔다는 뜻이다. 그런데도 셸이 살아 있으면 혼자 남은 것이므로 끝낸다
    entry->pty->kill();

    std::lock_guard lock(mutex_);
    entries_.erase(std::remove(entries_.begin(), entries_.end(), entry), entries_.end());
    finished_.push_back(entry);
    entry->finished = true;
    ++version_;
    changed_.notify_all();
}

void Terminals::monitorLoop() {
    for (;;) {
        std::vector<std::shared_ptr<Entry>> entries;
        std::vector<std::shared_ptr<Entry>> finished;
        {
            std::unique_lock lock(mutex_);
            if (changed_.wait_for(lock, kMonitorInterval, [&] { return stopping_; })) return;
            entries = entries_;
            finished.swap(finished_);
        }
        for (const auto& entry : finished) {
            if (entry->reader.joinable()) entry->reader.join();
        }

        for (const auto& entry : entries) {
            bool overdue = false;
            {
                std::lock_guard lock(mutex_);
                overdue = entry->closing && std::chrono::steady_clock::now() - entry->closeAt > kCloseGrace;
            }
            if (overdue) {
                entry->pty->kill();
                continue;
            }
            if (entry->pty->exited()) {
                // 셸이 스스로 끝났다. 콘솔을 닫으면 읽기가 끝나고 목록에서 빠진다
                entry->pty->close();
                continue;
            }
            const auto processes = describeProcesses(entry->pty->processIds());
            const std::string agent = domain::detectAgent(processes);
            const bool busy = domain::hasRunningProgram(processes, entry->pty->pid());

            std::lock_guard lock(mutex_);
            if (entry->agent != agent || entry->busy != busy) {
                entry->agent = agent;
                entry->busy = busy;
                ++version_;
                changed_.notify_all();
            }
        }
    }
}

bool Terminals::write(const std::string& id, std::string_view bytes) {
    const auto entry = find(id);
    return entry && entry->pty->write(bytes);
}

bool Terminals::resize(const std::string& id, int columns, int rows) {
    const auto entry = find(id);
    if (!entry) return false;
    entry->pty->resize(clampSize(columns, 2, 500), clampSize(rows, 1, 300));
    return true;
}

bool Terminals::close(const std::string& id) {
    const auto entry = find(id);
    if (!entry) return false;
    {
        std::lock_guard lock(mutex_);
        if (!entry->closing) entry->closeAt = std::chrono::steady_clock::now();
        entry->closing = true;
        changed_.notify_all();
    }
    entry->pty->close();
    return true;
}

void Terminals::closeTab(const std::string& tabId) {
    for (const auto& entry : entriesOfTab(tabId)) close(entry->id);
}

bool Terminals::exists(const std::string& id) { return find(id) != nullptr; }

bool Terminals::busy(const std::string& id) {
    const auto entry = find(id);
    return entry && busyNow(*entry);
}

bool Terminals::tabBusy(const std::string& tabId) {
    const auto entries = entriesOfTab(tabId);
    return std::any_of(entries.begin(), entries.end(), [](const auto& entry) { return busyNow(*entry); });
}

bool Terminals::anyBusy() {
    std::vector<std::shared_ptr<Entry>> entries;
    {
        std::lock_guard lock(mutex_);
        entries = entries_;
    }
    return std::any_of(entries.begin(), entries.end(), [](const auto& entry) { return busyNow(*entry); });
}

std::vector<TerminalView> Terminals::list() {
    std::lock_guard lock(mutex_);
    return viewsLocked();
}

std::vector<unsigned long> Terminals::processIds(const std::string& id) {
    const auto entry = find(id);
    return entry ? entry->pty->processIds() : std::vector<unsigned long>{};
}

TerminalEvents Terminals::wait(std::uint64_t knownVersion, std::chrono::milliseconds timeout) {
    std::unique_lock lock(mutex_);
    const std::uint64_t generation = ++waitGeneration_;
    changed_.notify_all();
    changed_.wait_for(lock, timeout, [&] {
        return !queue_.empty() || version_ != knownVersion || stopping_ || waitGeneration_ != generation;
    });

    TerminalEvents events;
    events.version = version_;
    events.terminals = viewsLocked();
    if (waitGeneration_ != generation) {
        events.superseded = true;
        return events;
    }
    std::size_t taken = 0;
    while (!queue_.empty() && taken < kMostBytesPerWait) {
        taken += queue_.front().bytes.size();
        events.output.push_back(std::move(queue_.front()));
        queue_.pop_front();
    }
    queuedBytes_ -= std::min(queuedBytes_, taken);
    changed_.notify_all();
    return events;
}

void Terminals::touch() {
    std::lock_guard lock(mutex_);
    ++version_;
    changed_.notify_all();
}

void Terminals::shutdown() {
    std::vector<std::shared_ptr<Entry>> entries;
    {
        std::lock_guard lock(mutex_);
        if (stopping_) return;
        entries = entries_;
        for (const auto& entry : entries) {
            if (!entry->closing) entry->closeAt = std::chrono::steady_clock::now();
            entry->closing = true;
        }
        changed_.notify_all();
    }
    for (const auto& entry : entries) entry->pty->close();

    {
        // 콘솔이 닫히면 읽기가 스스로 끝난다. 끝나지 않는 것은 아래에서 깨운다
        std::unique_lock lock(mutex_);
        changed_.wait_for(lock, kShutdownGrace, [&] { return entries_.empty(); });
        stopping_ = true;
        entries = entries_;
        entries.insert(entries.end(), finished_.begin(), finished_.end());
        finished_.clear();
        changed_.notify_all();
    }
    if (monitor_.joinable()) monitor_.join();

    for (const auto& entry : entries) entry->pty->kill();
    for (const auto& entry : entries) {
        while (!entry->finished) {
            entry->pty->abortRead();
            std::this_thread::sleep_for(10ms);
        }
        if (entry->reader.joinable()) entry->reader.join();
    }
    std::lock_guard lock(mutex_);
    finished_.clear();
}

}  // namespace va::data
