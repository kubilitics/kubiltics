# Homebrew formula for Kubilitics desktop app.
#
# This file is the source of truth — the tap repo at
# https://github.com/vellankikoti/homebrew-kubilitics is updated from
# this file via scripts/publish-homebrew-formula.sh after each release.
#
# Bump the version constant and the SHA256s (one per arch) when cutting
# a release, then run:
#   ./scripts/publish-homebrew-formula.sh v1.1.0
#
# Users install with:
#   brew tap vellankikoti/kubilitics
#   brew install --cask kubilitics

cask "kubilitics" do
  version "1.1.0"

  on_arm do
    url "https://github.com/vellankikoti/kubilitics/releases/download/v#{version}/Kubilitics_#{version}_aarch64.dmg"
    sha256 "REPLACE_WITH_AARCH64_DMG_SHA256"
  end

  on_intel do
    url "https://github.com/vellankikoti/kubilitics/releases/download/v#{version}/Kubilitics_#{version}_x64.dmg"
    sha256 "REPLACE_WITH_X86_64_DMG_SHA256"
  end

  name "Kubilitics"
  desc "Kubernetes operational intelligence platform with AI chat"
  homepage "https://github.com/vellankikoti/kubilitics"

  auto_updates true   # handled by tauri-plugin-updater, not Homebrew
  depends_on macos: ">= :sonoma"

  app "Kubilitics.app"

  uninstall quit:      "com.kubilitics.desktop",
            launchctl: "com.kubilitics.desktop"

  zap trash: [
    "~/Library/Application Support/kubilitics",
    "~/Library/Caches/com.kubilitics.desktop",
    "~/Library/Logs/kubilitics",
    "~/Library/Preferences/com.kubilitics.desktop.plist",
    "~/Library/Saved Application State/com.kubilitics.desktop.savedState",
  ]
end
