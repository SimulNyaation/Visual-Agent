// 화면이 접속하는 작은 웹 서버. 이 PC 자신(127.0.0.1)만 접속할 수 있다.
#pragma once

#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

#include "data/settings_store.h"
#include "domain/project_tabs.h"

namespace httplib {
class Server;
}

namespace va::server {

struct ApiServerOptions {
    std::filesystem::path uiDirectory;  // 화면 파일이 있는 폴더
    std::string token;                  // 화면만 아는 값. 없거나 틀리면 요청을 거부한다
    // 폴더 선택 창을 띄운다. 취소하면 값이 없다
    std::function<std::optional<std::filesystem::path>()> pickFolder;
    std::function<bool(const std::filesystem::path&)> folderExists;
};

class ApiServer {
public:
    ApiServer(ApiServerOptions options, data::SettingsStore store);
    ~ApiServer();

    ApiServer(const ApiServer&) = delete;
    ApiServer& operator=(const ApiServer&) = delete;

    // 비어 있는 포트를 골라 서버를 연다. 실패하면 false
    bool start();
    void stop();
    int port() const { return port_; }

private:
    void registerRoutes();
    std::string stateJson();

    ApiServerOptions options_;
    data::SettingsStore store_;
    std::mutex mutex_;
    domain::ProjectTabs tabs_;
    std::unique_ptr<httplib::Server> server_;
    std::thread thread_;
    int port_ = 0;
};

std::string generateToken();

}  // namespace va::server
