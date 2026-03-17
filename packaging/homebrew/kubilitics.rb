# typed: false
# frozen_string_literal: true

# Cask for Kubilitics Desktop App
# Tap: kubilitics/homebrew-tap
cask "kubilitics" do
  version "1.0.0"
  sha256 "PLACEHOLDER_SHA256_DMG"

  url "https://github.com/kubilitics/kubiltics/releases/download/v#{version}/Kubilitics-#{version}-universal.dmg"
  name "Kubilitics"
  desc "Kubernetes management platform with real-time dashboard and AI-powered CLI"
  homepage "https://kubilitics.com"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :ventura"

  app "Kubilitics.app"

  zap trash: [
    "~/Library/Application Support/com.kubilitics.app",
    "~/Library/Caches/com.kubilitics.app",
    "~/Library/Preferences/com.kubilitics.app.plist",
    "~/Library/Saved Application State/com.kubilitics.app.savedState",
  ]
end
