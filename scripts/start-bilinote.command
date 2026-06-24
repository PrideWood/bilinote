#!/bin/zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "Starting BiliNote AI..."
echo "Project: $PROJECT_DIR"
echo ""

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Please install Node.js first."
  read -r "?Press Enter to close..."
  exit 1
fi

open "http://localhost:5173/" >/dev/null 2>&1 &
npm run dev

