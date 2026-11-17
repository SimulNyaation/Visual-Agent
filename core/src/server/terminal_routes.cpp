// 터미널이 쓰는 요청: 터미널 띄우기·닫기, 글자 보내기, 크기 맞추기, 소식 기다리기, 앱 닫기 확인.
#include <algorithm>
#include <chrono>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "server/api_server.h"

namespace va::server {

namespace {

using nlohmann::json;

constexpr const char* kJson = "application/json; charset=utf-8";
// 소식이 없을 때 요청 하나를 붙잡아 두는 가장 긴 시간
constexpr std::chrono::seconds kLongestWait{20};
// 화면이 이 시간 안에 소식을 받아 간 적이 있으면 화면이 살아 있다고 본다
constexpr std::chrono::seconds kListenGrace{5};

void sendError(httplib::Response& res, int status, const char* code) {
    res.status = status;
    res.set_content(json{{"error", code}}.dump(), kJson);
}

json parseBody(const httplib::Request& req) {
    auto body = json::parse(req.body, nullptr, /*allow_exceptions=*/false);
    return body.is_object() ? body : json::object();
}

// 터미널의 출력은 글자 중간에서 끊겨 올 수 있어, 글자가 아닌 바이트 그대로 실어 보낸다
std::string base64(const std::string& bytes) {
    static constexpr char kAlphabet[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve((bytes.size() + 2) / 3 * 4);
    std::size_t i = 0;
    for (; i + 2 < bytes.size(); i += 3) {
        const unsigned value = (static_cast<unsigned char>(bytes[i]) << 16) |
                               (static_cast<unsigned char>(bytes[i + 1]) << 8) |
                               static_cast<unsigned char>(bytes[i + 2]);
        out.push_back(kAlphabet[(value >> 18) & 63]);
        out.push_back(kAlphabet[(value >> 12) & 63]);
        out.push_back(kAlphabet[(value >> 6) & 63]);
        out.push_back(kAlphabet[value & 63]);
    }
    if (i < bytes.size()) {
        unsigned value = static_cast<unsigned char>(bytes[i]) << 16;
        const bool two = i + 1 < bytes.size();
        if (two) value |= static_cast<unsigned char>(bytes[i + 1]) << 8;
        out.push_back(kAlphabet[(value >> 18) & 63]);
        out.push_back(kAlphabet[(value >> 12) & 63]);
        out.push_back(two ? kAlphabet[(value >> 6) & 63] : '=');
        out.push_back('=');
    }
    return out;
}

json terminalJson(const data::TerminalView& view) {
    return {{"id", view.id},       {"tabId", view.tabId}, {"shell", view.shell},
            {"name", view.name},   {"agent", view.agent}, {"busy", view.busy}};
}

std::chrono::steady_clock::rep nowTicks() {
    return std::chrono::steady_clock::now().time_since_epoch().count();
}

}  // namespace

bool ApiServer::screenListening() const {
    if (listeners_ > 0) return true;
    const auto last = std::chrono::steady_clock::duration(lastListen_.load());
    return last.count() != 0 && std::chrono::steady_clock::now().time_since_epoch() - last < kListenGrace;
}

bool ApiServer::requestClose() {
    if (!terminals_.anyBusy()) return true;
    // 화면이 멈춰 확인 창을 띄울 수 없으면 창을 닫지 못하게 되므로, 그때는 그냥 닫는다
    if (!screenListening()) return true;
    ++quitRequests_;
    terminals_.touch();
    return false;
}

void ApiServer::registerTerminalRoutes() {
    // 터미널을 띄운다. PowerShell 7을 먼저 띄워 보고, 없거나 뜨지 않으면 명령 프롬프트를 띄운다.
    // automatic이 true면 이번 실행에서 그 탭에 자동으로 띄워 준 적이 없을 때만 띄운다
    server_->Post(R"(/api/tabs/([^/]+)/terminals)",
                  [this](const httplib::Request& req, httplib::Response& res) {
                      const std::string tabId = req.matches[1].str();
                      const json body = parseBody(req);
                      const bool automatic = body.value("automatic", false);

                      std::filesystem::path folder;
                      {
                          std::lock_guard lock(mutex_);
                          const auto& tabs = tabs_.tabs();
                          const auto tab = std::find_if(tabs.begin(), tabs.end(), [&](const auto& item) {
                              return item.id == tabId;
                          });
                          if (tab == tabs.end()) return sendError(res, 404, "tab_not_found");
                          if (!options_.folderExists(tab->path)) return sendError(res, 404, "folder_not_found");
                          folder = tab->path;

                          if (automatic && !autoStarted_.insert(tabId).second) {
                              res.set_content(json{{"terminal", nullptr}}.dump(), kJson);
                              return;
                          }
                      }
                      if (terminals_.shells().empty()) return sendError(res, 409, "no_shell");

                      const auto view = terminals_.open(tabId, folder);
                      if (!view) return sendError(res, 500, "start_failed");
                      res.set_content(json{{"terminal", terminalJson(*view)}}.dump(), kJson);
                  });

    server_->Post(R"(/api/terminals/([^/]+)/input)",
                  [this](const httplib::Request& req, httplib::Response& res) {
                      const json body = parseBody(req);
                      if (!body.contains("data") || !body["data"].is_string()) {
                          return sendError(res, 400, "invalid_body");
                      }
                      if (!terminals_.write(req.matches[1].str(), body["data"].get<std::string>())) {
                          return sendError(res, 404, "terminal_not_found");
                      }
                      res.set_content("{}", kJson);
                  });

    server_->Post(R"(/api/terminals/([^/]+)/resize)",
                  [this](const httplib::Request& req, httplib::Response& res) {
                      const json body = parseBody(req);
                      if (!body.contains("columns") || !body["columns"].is_number_integer() ||
                          !body.contains("rows") || !body["rows"].is_number_integer()) {
                          return sendError(res, 400, "invalid_body");
                      }
                      if (!terminals_.resize(req.matches[1].str(), body["columns"].get<int>(),
                                             body["rows"].get<int>())) {
                          return sendError(res, 404, "terminal_not_found");
                      }
                      res.set_content("{}", kJson);
                  });

    // 실행 중인 프로그램이 있으면 닫지 않고 busy로 답한다. force가 true면 묻지 않고 닫는다
    server_->Post(R"(/api/terminals/([^/]+)/close)",
                  [this](const httplib::Request& req, httplib::Response& res) {
                      const std::string id = req.matches[1].str();
                      const json body = parseBody(req);
                      if (!terminals_.exists(id)) return sendError(res, 404, "terminal_not_found");
                      if (!body.value("force", false) && terminals_.busy(id)) {
                          return sendError(res, 409, "busy");
                      }
                      terminals_.close(id);
                      res.set_content("{}", kJson);
                  });

    // 새 출력이 있거나 터미널 목록이 달라질 때까지 기다렸다가 답한다
    server_->Post("/api/terminals/events", [this](const httplib::Request& req, httplib::Response& res) {
        const json body = parseBody(req);
        const std::uint64_t known = body.value("version", std::uint64_t{0});

        ++listeners_;
        const auto events = terminals_.wait(known, kLongestWait);
        --listeners_;
        lastListen_ = nowTicks();

        json terminals = json::array();
        for (const auto& view : events.terminals) terminals.push_back(terminalJson(view));
        json output = json::array();
        for (const auto& chunk : events.output) {
            output.push_back({{"id", chunk.id}, {"data", base64(chunk.bytes)}});
        }
        res.set_content(json{{"version", events.version},
                             {"terminals", std::move(terminals)},
                             {"output", std::move(output)},
                             {"quitRequests", quitRequests_.load()}}
                            .dump(),
                        kJson);
    });

    // 앱 닫기 확인 창의 답. confirm이 true면 앱을 닫는다
    server_->Post("/api/app/quit", [this](const httplib::Request& req, httplib::Response& res) {
        const json body = parseBody(req);
        if (body.value("confirm", false) && options_.quit) options_.quit();
        res.set_content("{}", kJson);
    });
}

}  // namespace va::server
