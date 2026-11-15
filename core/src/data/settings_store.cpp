#include "data/settings_store.h"

#include <fstream>
#include <system_error>

namespace va::data {

SettingsStore::SettingsStore(std::filesystem::path directory)
    : directory_(std::move(directory)), file_(directory_ / "state.json") {}

domain::ProjectTabs SettingsStore::load() const {
    std::ifstream in(file_, std::ios::binary);
    if (!in) return {};
    const auto json = nlohmann::json::parse(in, nullptr, /*allow_exceptions=*/false);
    if (json.is_discarded()) return {};
    return domain::ProjectTabs::fromJson(json);
}

bool SettingsStore::save(const domain::ProjectTabs& tabs) const {
    std::error_code ec;
    std::filesystem::create_directories(directory_, ec);
    if (ec) return false;

    const auto temp = directory_ / "state.json.tmp";
    {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        if (!out) return false;
        out << tabs.toJson().dump(2);
        if (!out.good()) return false;
    }
    std::filesystem::rename(temp, file_, ec);
    return !ec;
}

}  // namespace va::data
