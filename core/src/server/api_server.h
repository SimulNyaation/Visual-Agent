// 화면이 접속하는 작은 웹 서버. 이 PC 자신(127.0.0.1)만 접속할 수 있다.
#pragma once

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "data/folder_watch.h"
#include "data/project_files.h"
#include "data/settings_store.h"
#include "domain/file_rules.h"
#include "domain/project_tabs.h"

namespace httplib {
class Server;
struct Request;
struct Response;
}

namespace va::server {

struct ApiServerOptions {
    std::filesystem::path uiDirectory;  // 화면 파일이 있는 폴더
    std::string token;                  // 화면만 아는 값. 없거나 틀리면 요청을 거부한다
    // 폴더 선택 창을 띄운다. 취소하면 값이 없다
    std::function<std::optional<std::filesystem::path>()> pickFolder;
    std::function<bool(const std::filesystem::path&)> folderExists;
    // 지운 것을 보내는 곳 (휴지통)
    data::TrashFn trash;
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
    void registerFileRoutes();
    // 탭의 프로젝트 폴더. 탭이 없거나 폴더가 없으면 오류를 응답하고 값이 없다
    std::optional<data::ProjectFiles> projectFiles(const httplib::Request& req, httplib::Response& res);
    std::string stateJson();

    ApiServerOptions options_;
    data::SettingsStore store_;
    std::mutex mutex_;
    domain::ProjectTabs tabs_;
    std::unique_ptr<httplib::Server> server_;
    std::thread thread_;

    // 파일 작업과 되돌리기 기록. 긴 복사가 탭 요청을 막지 않도록 따로 잠근다
    std::mutex filesMutex_;
    std::map<std::string, std::vector<domain::FileOperation>> history_;
    // 지금 폴더 변화를 기다리고 있는 요청. 새 요청이 오면 앞의 것은 끝낸다
    std::mutex waitMutex_;
    std::shared_ptr<data::ChangeWait> currentWait_;
    int port_ = 0;
};

std::string generateToken();

}  // namespace va::server
