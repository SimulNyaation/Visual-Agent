// 화면이 접속하는 작은 웹 서버. 이 PC 자신(127.0.0.1)만 접속할 수 있다.
#pragma once

#include <filesystem>
#include <functional>
#include <atomic>
#include <chrono>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "data/folder_watch.h"
#include "data/project_files.h"
#include "data/settings_store.h"
#include "data/shell_finder.h"
#include "data/terminals.h"
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
    // 터미널에 띄울 셸. 앞의 것부터 띄워 본다
    std::vector<data::InstalledShell> shells;
    // 앱 창을 묻지 않고 닫는다
    std::function<void()> quit;
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

    // 앱 창을 닫으려 할 때 창이 묻는다. 바로 닫아도 되면 true.
    // 터미널에서 실행 중인 프로그램이 있으면 화면에 확인 창을 띄우게 하고 false를 돌려준다
    bool requestClose();

private:
    void registerRoutes();
    void registerFileRoutes();
    void registerTerminalRoutes();
    // 화면이 터미널 소식을 받아 가고 있는가
    bool screenListening() const;
    // 탭의 프로젝트 폴더. 탭이 없거나 폴더가 없으면 오류를 응답하고 값이 없다
    std::optional<data::ProjectFiles> projectFiles(const httplib::Request& req, httplib::Response& res);
    std::string stateJson();

    ApiServerOptions options_;
    data::SettingsStore store_;
    std::mutex mutex_;
    domain::ProjectTabs tabs_;
    domain::Layout layout_;
    // 이번 실행에서 터미널을 자동으로 띄워 준 탭
    std::set<std::string> autoStarted_;
    std::unique_ptr<httplib::Server> server_;
    std::thread thread_;

    // 파일 작업과 되돌리기 기록. 긴 복사가 탭 요청을 막지 않도록 따로 잠근다
    std::mutex filesMutex_;
    std::map<std::string, std::vector<domain::FileOperation>> history_;
    // 지금 폴더 변화를 기다리고 있는 요청. 새 요청이 오면 앞의 것은 끝낸다
    std::mutex waitMutex_;
    std::shared_ptr<data::ChangeWait> currentWait_;
    std::shared_ptr<data::ChangeWait> currentFileWait_;  // 문서 창이 열어 둔 파일의 바뀜을 기다리는 요청

    data::Terminals terminals_;
    // 앱 닫기 확인을 화면에 요청한 횟수. 화면은 이 값이 커지면 확인 창을 띄운다
    std::atomic<unsigned> quitRequests_{0};
    std::atomic<int> listeners_{0};
    std::atomic<std::chrono::steady_clock::rep> lastListen_{0};
    int port_ = 0;
    // 터미널 안의 에이전트가 훅으로 소식을 보낼 때 쓰는 값. 화면의 값(token)과 달리 훅 소식을 보내는 데만 쓸 수 있다
    std::string hookToken_;
};

std::string generateToken();

}  // namespace va::server
