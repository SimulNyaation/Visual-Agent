#include "server/api_server.h"

#include <random>

#include <httplib.h>
#include <nlohmann/json.hpp>

namespace va::server {

namespace {

constexpr const char* kJson = "application/json; charset=utf-8";
constexpr const char* kTokenHeader = "X-VA-Token";

void sendError(httplib::Response& res, int status, const char* code) {
    res.status = status;
    res.set_content(nlohmann::json{{"error", code}}.dump(), kJson);
}

bool isApiPath(const std::string& path) { return path.rfind("/api/", 0) == 0; }

}  // namespace

std::string generateToken() {
    static constexpr char kAlphabet[] =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    std::random_device device;
    std::uniform_int_distribution<int> pick(0, static_cast<int>(sizeof(kAlphabet)) - 2);
    std::string token;
    for (int i = 0; i < 40; ++i) token.push_back(kAlphabet[pick(device)]);
    return token;
}

ApiServer::ApiServer(ApiServerOptions options, data::SettingsStore store)
    : options_(std::move(options)),
      store_(std::move(store)),
      tabs_(store_.load()),
      server_(std::make_unique<httplib::Server>()) {}

ApiServer::~ApiServer() { stop(); }

bool ApiServer::start() {
    registerRoutes();
    if (!server_->set_mount_point("/", options_.uiDirectory.string())) return false;
    port_ = server_->bind_to_any_port("127.0.0.1");
    if (port_ <= 0) return false;
    thread_ = std::thread([this] { server_->listen_after_bind(); });
    server_->wait_until_ready();
    return true;
}

void ApiServer::stop() {
    {
        std::lock_guard lock(waitMutex_);
        if (currentWait_) currentWait_->cancel();
    }
    if (server_ && server_->is_running()) server_->stop();
    if (thread_.joinable()) thread_.join();
}

std::string ApiServer::stateJson() {
    nlohmann::json tabs = nlohmann::json::array();
    for (const auto& tab : tabs_.view(options_.folderExists)) {
        tabs.push_back({{"id", tab.id},
                        {"name", tab.name},
                        {"label", tab.label},
                        {"path", tab.path},
                        {"missing", tab.missing}});
    }
    return nlohmann::json{{"tabs", tabs}, {"activeId", tabs_.activeId()}}.dump();
}

void ApiServer::registerRoutes() {
    // 모든 /api/ 요청은 이 PC의 화면에서 온 것인지 먼저 확인한다
    server_->set_pre_routing_handler([this](const httplib::Request& req, httplib::Response& res) {
        if (!isApiPath(req.path)) return httplib::Server::HandlerResponse::Unhandled;

        const std::string host = req.get_header_value("Host");
        const std::string expected = "127.0.0.1:" + std::to_string(port_);
        if (host != expected) {
            sendError(res, 403, "forbidden_host");
            return httplib::Server::HandlerResponse::Handled;
        }
        if (req.get_header_value(kTokenHeader) != options_.token) {
            sendError(res, 401, "invalid_token");
            return httplib::Server::HandlerResponse::Handled;
        }
        return httplib::Server::HandlerResponse::Unhandled;
    });

    server_->Get("/api/state", [this](const httplib::Request&, httplib::Response& res) {
        std::lock_guard lock(mutex_);
        res.set_content(stateJson(), kJson);
    });

    // 본문에 path가 있으면 그 폴더를 열고, 없으면 폴더 선택 창을 띄운다
    server_->Post("/api/tabs", [this](const httplib::Request& req, httplib::Response& res) {
        std::optional<std::filesystem::path> folder;

        const auto body = nlohmann::json::parse(req.body, nullptr, /*allow_exceptions=*/false);
        if (body.is_object() && body.contains("path")) {
            if (!body["path"].is_string()) return sendError(res, 400, "invalid_path");
            folder = domain::fromUtf8(body["path"].get<std::string>());
            if (!folder->is_absolute() || !options_.folderExists(*folder)) {
                return sendError(res, 400, "folder_not_found");
            }
        } else {
            folder = options_.pickFolder();
            if (!folder) {
                std::lock_guard lock(mutex_);
                auto state = nlohmann::json::parse(stateJson());
                state["cancelled"] = true;
                res.set_content(state.dump(), kJson);
                return;
            }
        }

        std::lock_guard lock(mutex_);
        tabs_.open(*folder);
        store_.save(tabs_);
        res.set_content(stateJson(), kJson);
    });

    server_->Post(R"(/api/tabs/([^/]+)/select)",
                  [this](const httplib::Request& req, httplib::Response& res) {
                      std::lock_guard lock(mutex_);
                      if (!tabs_.select(req.matches[1].str())) {
                          return sendError(res, 404, "tab_not_found");
                      }
                      store_.save(tabs_);
                      res.set_content(stateJson(), kJson);
                  });

    server_->Delete(R"(/api/tabs/([^/]+))",
                    [this](const httplib::Request& req, httplib::Response& res) {
                        std::lock_guard lock(mutex_);
                        if (!tabs_.close(req.matches[1].str())) {
                            return sendError(res, 404, "tab_not_found");
                        }
                        store_.save(tabs_);
                        {
                            std::lock_guard files(filesMutex_);
                            history_.erase(req.matches[1].str());
                        }
                        res.set_content(stateJson(), kJson);
                    });

    registerFileRoutes();
}

}  // namespace va::server
