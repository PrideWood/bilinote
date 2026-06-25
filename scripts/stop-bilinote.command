#!/bin/zsh

echo "Stopping BiliNote AI dev processes..."
pkill -f "tsx watch server/server.ts" 2>/dev/null || true
pkill -f "vite --host 0.0.0.0" 2>/dev/null || true
pkill -f "concurrently \"npm:dev:server\" \"npm:dev:client\"" 2>/dev/null || true
pkill -f "node dist-server/server.js" 2>/dev/null || true
pkill -f "BiliNote AI.app/Contents/Resources/app/dist-server/server.js" 2>/dev/null || true
echo "Done."
sleep 1
