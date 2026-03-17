# typed: false
# frozen_string_literal: true

# Formula for kcli — AI-powered kubectl replacement
# Tap: kubilitics/homebrew-tap
class Kcli < Formula
  desc "AI-powered kubectl replacement for Kubernetes management"
  homepage "https://kubilitics.com"
  version "1.0.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/kubilitics/kubiltics/releases/download/v#{version}/kcli-v#{version}-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/kubilitics/kubiltics/releases/download/v#{version}/kcli-v#{version}-darwin-amd64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_AMD64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/kubilitics/kubiltics/releases/download/v#{version}/kcli-v#{version}-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/kubilitics/kubiltics/releases/download/v#{version}/kcli-v#{version}-linux-amd64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_AMD64"
    end
  end

  def install
    bin.install "kcli"

    # Generate shell completions
    generate_completions_from_executable(bin/"kcli", "completion")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kcli version")
  end
end
