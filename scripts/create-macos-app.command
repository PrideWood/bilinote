#!/bin/zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="BiliNote AI"
APP_PATH="$PROJECT_DIR/$APP_NAME.app"
MACOS_DIR="$APP_PATH/Contents/MacOS"
RESOURCES_DIR="$APP_PATH/Contents/Resources"
BUNDLED_APP_DIR="$RESOURCES_DIR/app"

cd "$PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Please install Node.js first."
  read -r "?Press Enter to close..."
  exit 1
fi

echo "Building BiliNote AI..."
npm run build

rm -rf "$APP_PATH"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$BUNDLED_APP_DIR"

cat > "$APP_PATH/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>BiliNote AI</string>
  <key>CFBundleExecutable</key>
  <string>BiliNote AI</string>
  <key>CFBundleIdentifier</key>
  <string>local.bilinote.ai</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleName</key>
  <string>BiliNote AI</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
PLIST

cat > "$MACOS_DIR/$APP_NAME" <<'LAUNCHER'
#!/bin/zsh
set -e

CONTENTS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$CONTENTS_DIR/Resources/app"
APP_DATA_DIR="${BILINOTE_DATA_DIR:-$HOME/Library/Application Support/BiliNote AI}"
LOG_DIR="$APP_DATA_DIR/logs"
LAUNCHER_LOG="$LOG_DIR/app-launcher.log"

mkdir -p "$LOG_DIR"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Launching BiliNote AI from $PROJECT_DIR" >> "$LAUNCHER_LOG"

cd "$PROJECT_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [[ -f "$HOME/.zprofile" ]]; then
  source "$HOME/.zprofile" >> "$LAUNCHER_LOG" 2>&1 || true
fi
if [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc" >> "$LAUNCHER_LOG" 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. PATH=$PATH" >> "$LAUNCHER_LOG"
  /usr/bin/osascript -e 'display alert "BiliNote AI 启动失败" message "没有找到 Node.js。请先安装 Node.js，或从终端运行 scripts/start-bilinote.command 查看详细错误。"'
  exit 1
fi

echo "Using node: $(command -v node)" >> "$LAUNCHER_LOG"
/usr/bin/env node "$PROJECT_DIR/scripts/start-local-service.mjs" >> "$LAUNCHER_LOG" 2>&1 &
LAUNCHER

chmod +x "$MACOS_DIR/$APP_NAME"
chmod +x "$PROJECT_DIR/scripts/start-local-service.mjs"

echo "Bundling local service files..."
mkdir -p "$BUNDLED_APP_DIR/scripts"
ditto "$PROJECT_DIR/dist" "$BUNDLED_APP_DIR/dist"
ditto "$PROJECT_DIR/dist-server" "$BUNDLED_APP_DIR/dist-server"
ditto "$PROJECT_DIR/scripts/start-local-service.mjs" "$BUNDLED_APP_DIR/scripts/start-local-service.mjs"
ditto "$PROJECT_DIR/package.json" "$BUNDLED_APP_DIR/package.json"
if [[ -f "$PROJECT_DIR/.env" ]]; then
  ditto "$PROJECT_DIR/.env" "$BUNDLED_APP_DIR/.env"
fi
if [[ -d "$PROJECT_DIR/node_modules" ]]; then
  ditto "$PROJECT_DIR/node_modules" "$BUNDLED_APP_DIR/node_modules"
fi
chmod +x "$BUNDLED_APP_DIR/scripts/start-local-service.mjs"

if [[ -f "$PROJECT_DIR/public/BiliNote.icns" ]]; then
  cp "$PROJECT_DIR/public/BiliNote.icns" "$RESOURCES_DIR/AppIcon.icns"
else
  ICON_SOURCE="$PROJECT_DIR/public/android-chrome-512x512.png"
  if [[ ! -f "$ICON_SOURCE" ]]; then
    ICON_SOURCE="$PROJECT_DIR/public/apple-touch-icon.png"
  fi
fi

if [[ ! -f "$RESOURCES_DIR/AppIcon.icns" && -f "$ICON_SOURCE" ]] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  ICONSET="$RESOURCES_DIR/AppIcon.iconset"
  mkdir -p "$ICONSET"
  sips -z 16 16 "$ICON_SOURCE" --out "$ICONSET/icon_16x16.png" >/dev/null
  sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$ICON_SOURCE" --out "$ICONSET/icon_32x32.png" >/dev/null
  sips -z 64 64 "$ICON_SOURCE" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$ICON_SOURCE" --out "$ICONSET/icon_128x128.png" >/dev/null
  sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$ICON_SOURCE" --out "$ICONSET/icon_256x256.png" >/dev/null
  sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$ICON_SOURCE" --out "$ICONSET/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$ICON_SOURCE" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET" -o "$RESOURCES_DIR/AppIcon.icns" || true
  rm -rf "$ICONSET"
fi

echo ""
echo "Created: $APP_PATH"
echo "Double-click it to start BiliNote AI without a Terminal window."
