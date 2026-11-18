// 파일 칸이 쓰는 요청: 폴더 읽기, 바뀜 기다리기, 옮기기·복사·이름 바꾸기·새로 만들기·지우기·되돌리기.
#include <chrono>
#include <optional>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "server/api_server.h"

namespace va::server {

namespace {

using nlohmann::json;
using Path = std::filesystem::path;

constexpr const char* kJson = "application/json; charset=utf-8";
// 바뀐 것이 없을 때 요청 하나를 붙잡아 두는 가장 긴 시간
constexpr std::chrono::seconds kLongestWait{20};
// 지켜볼 폴더가 너무 많아 일부만 지켜볼 때 다시 읽는 간격
constexpr std::chrono::seconds kRereadInterval{1};
// 문서 창이 열어 둔 파일이 바뀌었는지 다시 확인하는 간격
constexpr std::chrono::milliseconds kFileCheckInterval{500};

void sendError(httplib::Response& res, const std::string& code) {
    int status = 409;
    if (code == "invalid_path" || code == "invalid_name" || code == "invalid_body") status = 400;
    if (code == "not_found" || code == "tab_not_found" || code == "folder_not_found") status = 404;
    if (code == "in_use") status = 423;
    if (code == "failed") status = 500;
    res.status = status;
    res.set_content(json{{"error", code}}.dump(), kJson);
}

const char* kindText(data::EntryKind kind) {
    switch (kind) {
        case data::EntryKind::Folder: return "folder";
        case data::EntryKind::Link: return "link";
        case data::EntryKind::File: return "file";
    }
    return "file";
}

json listingJson(const Path& folder, const data::Listing& listing) {
    json entries = json::array();
    for (const auto& entry : listing.entries) {
        entries.push_back({{"name", entry.name}, {"kind", kindText(entry.kind)}});
    }
    return {{"path", domain::toRelativeText(folder)},
            {"missing", listing.missing},
            {"stamp", listing.stamp},
            {"entries", std::move(entries)}};
}

json changesJson(const std::vector<domain::FileChange>& changes) {
    json items = json::array();
    for (const auto& change : changes) {
        items.push_back({{"from", domain::toRelativeText(change.from)},
                         {"to", domain::toRelativeText(change.to)}});
    }
    return items;
}

std::optional<Path> readPath(const json& body, const char* key) {
    if (!body.is_object() || !body.contains(key) || !body[key].is_string()) return std::nullopt;
    return domain::parseRelativePath(body[key].get<std::string>());
}

std::optional<std::vector<Path>> readPaths(const json& body, const char* key) {
    if (!body.is_object() || !body.contains(key) || !body[key].is_array()) return std::nullopt;
    std::vector<Path> paths;
    for (const auto& item : body[key]) {
        if (!item.is_string()) return std::nullopt;
        const auto path = domain::parseRelativePath(item.get<std::string>());
        if (!path) return std::nullopt;
        paths.push_back(*path);
    }
    return paths;
}

std::optional<std::wstring> readName(const json& body, const char* key) {
    if (!body.is_object() || !body.contains(key) || !body[key].is_string()) return std::nullopt;
    return domain::fromUtf8(body[key].get<std::string>()).wstring();
}

json parseBody(const httplib::Request& req) {
    return json::parse(req.body, nullptr, /*allow_exceptions=*/false);
}

}  // namespace

std::optional<data::ProjectFiles> ApiServer::projectFiles(const httplib::Request& req,
                                                          httplib::Response& res) {
    const std::string id = req.matches[1].str();
    Path root;
    {
        std::lock_guard lock(mutex_);
        for (const auto& tab : tabs_.tabs()) {
            if (tab.id == id) root = tab.path;
        }
    }
    if (root.empty()) {
        sendError(res, "tab_not_found");
        return std::nullopt;
    }
    if (!options_.folderExists(root)) {
        sendError(res, "folder_not_found");
        return std::nullopt;
    }
    return data::ProjectFiles(root, options_.trash);
}

void ApiServer::registerFileRoutes() {
    using Request = httplib::Request;
    using Response = httplib::Response;

    // 폴더 여러 개의 내용을 한 번에 읽는다
    server_->Post(R"(/api/tabs/([^/]+)/files/list)", [this](const Request& req, Response& res) {
        const auto folders = readPaths(parseBody(req), "dirs");
        if (!folders) return sendError(res, "invalid_path");
        const auto files = projectFiles(req, res);
        if (!files) return;

        json dirs = json::array();
        for (const auto& folder : *folders) dirs.push_back(listingJson(folder, files->list(folder)));
        res.set_content(json{{"dirs", std::move(dirs)}}.dump(), kJson);
    });

    // 문서 창: 글자 파일 하나의 내용을 읽는다. 화면이 알고 있는 것과 같으면 내용 없이 답한다.
    // wait이면 화면이 알고 있는 것(내용의 stamp 또는 열 수 없는 이유 error)과 달라질 때까지 기다렸다가 답한다
    server_->Post(R"(/api/tabs/([^/]+)/files/read)", [this](const Request& req, Response& res) {
        const json body = parseBody(req);
        const auto file = readPath(body, "path");
        if (!file) return sendError(res, "invalid_path");
        const auto textOf = [&body](const char* key) {
            return body.contains(key) && body[key].is_string() ? body[key].get<std::string>() : std::string();
        };
        const std::string known = textOf("stamp");
        const std::string knownError = textOf("error");
        const bool waiting = body.contains("wait") && body["wait"].is_boolean() && body["wait"].get<bool>();

        std::shared_ptr<data::ChangeWait> wait;
        if (waiting) {
            wait = std::make_shared<data::ChangeWait>();
            std::lock_guard lock(waitMutex_);
            // 지켜보는 문서는 하나다. 다른 문서를 지켜보기 시작하면 앞의 기다림은 끝낸다
            if (currentFileWait_) currentFileWait_->cancel();
            currentFileWait_ = wait;
        }

        const auto deadline = std::chrono::steady_clock::now() + kLongestWait;
        data::FileText text;
        for (;;) {
            const auto files = projectFiles(req, res);
            if (!files) return;
            text = files->read(*file, known);
            const bool same = text.error.empty() ? text.unchanged : text.error == knownError;
            if (!wait || !same || wait->cancelled() || std::chrono::steady_clock::now() >= deadline) break;
            wait->wait(kFileCheckInterval);
        }
        if (!text.error.empty()) return sendError(res, text.error);
        json reply = {{"stamp", text.stamp}, {"unchanged", text.unchanged}};
        if (!text.unchanged) reply["text"] = text.text;
        res.set_content(reply.dump(), kJson);
    });

    // 화면이 알고 있는 내용과 달라진 폴더가 생길 때까지 기다렸다가 그 폴더들의 새 내용을 준다
    server_->Post(R"(/api/tabs/([^/]+)/files/changes)", [this](const Request& req, Response& res) {
        const json body = parseBody(req);
        if (!body.is_object() || !body.contains("dirs") || !body["dirs"].is_array()) {
            return sendError(res, "invalid_body");
        }
        struct Known {
            Path folder;
            std::string stamp;
        };
        std::vector<Known> known;
        for (const auto& item : body["dirs"]) {
            const auto folder = readPath(item, "path");
            if (!folder || !item.contains("stamp") || !item["stamp"].is_string()) {
                return sendError(res, "invalid_path");
            }
            known.push_back({*folder, item["stamp"].get<std::string>()});
        }

        const auto wait = std::make_shared<data::ChangeWait>();
        {
            std::lock_guard lock(waitMutex_);
            if (currentWait_) currentWait_->cancel();
            currentWait_ = wait;
        }

        const auto deadline = std::chrono::steady_clock::now() + kLongestWait;
        json changed = json::array();
        for (;;) {
            const auto files = projectFiles(req, res);
            if (!files) return;

            std::vector<Path> watched;
            for (const auto& item : known) {
                if (const auto located = files->locateFolder(item.folder)) watched.push_back(*located);
            }
            const bool watchingAll = wait->arm(watched);

            for (const auto& item : known) {
                const auto listing = files->list(item.folder);
                if (listing.missing || listing.stamp != item.stamp) {
                    changed.push_back(listingJson(item.folder, listing));
                }
            }
            const auto now = std::chrono::steady_clock::now();
            if (!changed.empty() || wait->cancelled() || now >= deadline) break;

            auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now);
            if (!watchingAll && remaining > kRereadInterval) remaining = kRereadInterval;
            wait->wait(remaining);
        }
        res.set_content(json{{"dirs", std::move(changed)}}.dump(), kJson);
    });

    // 파일 작업 하나를 하고, 되돌릴 수 있는 것이면 기록에 올린다
    const auto run = [this](const Request& req, Response& res,
                            std::optional<domain::FileOperationKind> kind,
                            const std::function<data::Outcome(data::ProjectFiles&)>& action) {
        auto files = projectFiles(req, res);
        if (!files) return;

        std::lock_guard lock(filesMutex_);
        const data::Outcome outcome = action(*files);
        if (!outcome.error.empty()) return sendError(res, outcome.error);
        if (kind && !outcome.changes.empty()) {
            history_[req.matches[1].str()].push_back({*kind, outcome.changes});
        }
        res.set_content(json{{"ok", true}, {"changes", changesJson(outcome.changes)}}.dump(), kJson);
    };

    server_->Post(R"(/api/tabs/([^/]+)/files/move)", [run](const Request& req, Response& res) {
        const json body = parseBody(req);
        const auto items = readPaths(body, "items");
        const auto to = readPath(body, "to");
        if (!items || !to) return sendError(res, "invalid_path");
        run(req, res, domain::FileOperationKind::Move,
            [&](data::ProjectFiles& files) { return files.move(*items, *to); });
    });

    server_->Post(R"(/api/tabs/([^/]+)/files/copy)", [run](const Request& req, Response& res) {
        const json body = parseBody(req);
        const auto items = readPaths(body, "items");
        const auto to = readPath(body, "to");
        if (!items || !to) return sendError(res, "invalid_path");
        run(req, res, domain::FileOperationKind::Copy,
            [&](data::ProjectFiles& files) { return files.copy(*items, *to); });
    });

    server_->Post(R"(/api/tabs/([^/]+)/files/rename)", [run](const Request& req, Response& res) {
        const json body = parseBody(req);
        const auto item = readPath(body, "path");
        const auto name = readName(body, "name");
        if (!item) return sendError(res, "invalid_path");
        if (!name) return sendError(res, "invalid_name");
        run(req, res, domain::FileOperationKind::Rename,
            [&](data::ProjectFiles& files) { return files.rename(*item, *name); });
    });

    server_->Post(R"(/api/tabs/([^/]+)/files/create)", [run](const Request& req, Response& res) {
        const json body = parseBody(req);
        const auto parent = readPath(body, "parent");
        const auto name = readName(body, "name");
        if (!parent) return sendError(res, "invalid_path");
        if (!name || !body.contains("kind") || !body["kind"].is_string()) {
            return sendError(res, "invalid_name");
        }
        const bool folder = body["kind"].get<std::string>() == "folder";
        run(req, res, domain::FileOperationKind::Create,
            [&](data::ProjectFiles& files) { return files.create(*parent, *name, folder); });
    });

    // 지운 것은 되돌리기 기록에 올리지 않는다. 휴지통에서 꺼낸다
    server_->Post(R"(/api/tabs/([^/]+)/files/trash)", [run](const Request& req, Response& res) {
        const auto items = readPaths(parseBody(req), "items");
        if (!items) return sendError(res, "invalid_path");
        run(req, res, std::nullopt,
            [&](data::ProjectFiles& files) { return files.trash(*items); });
    });

    // 가장 최근 작업을 되돌린다. 파일이 없어졌거나 원래 자리가 차서 되돌릴 수 없으면 그 작업은 기록에서 빼고 이유를 알린다
    server_->Post(R"(/api/tabs/([^/]+)/files/undo)", [this](const Request& req, Response& res) {
        auto files = projectFiles(req, res);
        if (!files) return;

        std::lock_guard lock(filesMutex_);
        auto& history = history_[req.matches[1].str()];
        if (history.empty()) return sendError(res, "nothing_to_undo");

        const domain::FileOperation operation = history.back();
        const data::Outcome outcome = files->undo(operation);
        // 파일이 쓰이는 중이라 실패한 것은 나중에 다시 되돌릴 수 있게 남겨 둔다
        const bool retryable = outcome.error == "in_use" || outcome.error == "failed";
        if (!retryable) history.pop_back();
        if (!outcome.error.empty()) return sendError(res, outcome.error);
        res.set_content(json{{"ok", true},
                             {"undone",
                              {{"kind", domain::toText(operation.kind)},
                               {"items", changesJson(operation.items)}}}}
                            .dump(),
                        kJson);
    });
}

}  // namespace va::server
