# Kubilitics Desktop

Desktop application for Kubilitics - The Kubernetes OS

## Architecture

- **Frontend**: React (shared with web)
- **Desktop Shell**: Tauri (Rust)
- **Backend**: Go server (runs as sidecar process)

## Development

### Prerequisites

- Node.js 20+
- Rust 1.75+
- Go 1.24+

### Setup

```bash
# Install Tauri CLI
cargo install tauri-cli --version ^2.0

# Install dependencies
npm install

# Build Go backend
cd ../kubilitics-backend
go build -o ../kubilitics-desktop/src-tauri/binaries/kubilitics-backend cmd/server/main.go

# Run development
cd ../kubilitics-desktop
cargo tauri dev
```

## Building

```bash
# Build for current platform
cargo tauri build

# Outputs:
# - macOS: src-tauri/target/release/bundle/dmg/
# - Windows: src-tauri/target/release/bundle/msi/
# - Linux: src-tauri/target/release/bundle/deb/
```

## Features

- **Local Backend**: Go backend runs as child process
- **Auto-Discovery**: Automatically detects kubeconfig
- **Offline-First**: Works without internet (for local clusters)
- **Native UI**: Platform-native window chrome
- **File Access**: Read/write kubeconfig files
- **System Tray**: Minimize to tray

## Directory Structure

```
kubilitics-desktop/
├── src/                # React frontend
├── src-tauri/          # Tauri backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands.rs
│   │   └── sidecar.rs
│   ├── binaries/       # Go backend binary
│   ├── icons/
│   └── tauri.conf.json
└── package.json
```

## Deployment

### macOS

1. Code sign the app
2. Notarize with Apple
3. Distribute via DMG or Mac App Store

### Windows

1. Sign with certificate
2. Create MSI installer
3. Distribute via Microsoft Store or direct download

### Linux

1. Package as DEB/RPM/AppImage
2. Distribute via package managers or direct download
