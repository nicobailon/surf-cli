#!/bin/bash
cd "$(dirname "$0")/.."

PASS=0
FAIL=0

test_output() {
  local name="$1"
  local cmd="$2"
  local expect="$3"

  output=$(eval "$cmd" 2>&1) || true
  if echo "$output" | grep -q -- "$expect"; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name"
    echo "  Command: $cmd"
    echo "  Expected: $expect"
    echo "  Got: $output"
    FAIL=$((FAIL + 1))
  fi
}

test_no_output() {
  local name="$1"
  local cmd="$2"
  local unexpected="$3"

  output=$(eval "$cmd" 2>&1) || true
  if echo "$output" | grep -q -- "$unexpected"; then
    echo "FAIL: $name"
    echo "  Command: $cmd"
    echo "  Unexpected: $unexpected"
    echo "  Got: $output"
    FAIL=$((FAIL + 1))
  else
    echo "PASS: $name"
    PASS=$((PASS + 1))
  fi
}

test_exit_output() {
  local name="$1"
  local cmd="$2"
  local expected_status="$3"
  local expect="$4"

  output=$(eval "$cmd" 2>&1)
  status=$?
  if [ "$status" -eq "$expected_status" ] && echo "$output" | grep -q -- "$expect"; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name"
    echo "  Command: $cmd"
    echo "  Expected status: $expected_status"
    echo "  Expected output: $expect"
    echo "  Got status: $status"
    echo "  Got: $output"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== CLI Unit Tests (headless-only) ==="
echo ""

echo "-- Version and Help --"
test_output "version flag" "node cli.cjs --version" "surf version"
test_output "version short" "node cli.cjs -v" "surf version"
test_output "basic help" "node cli.cjs --help" "Headless terminal AI CLI"
test_output "basic help AI commands" "node cli.cjs --help" "AI Commands (headless-only)"
test_output "full help chatgpt" "node cli.cjs --help-full" "chatgpt"
test_output "full help gemini" "node cli.cjs --help-full" "gemini"
test_output "full help session" "node cli.cjs --help-full" "session"
test_output "full help workflow" "node cli.cjs --help-full" "do"
test_output "full help mcp" "node cli.cjs --help-full" "server"
test_no_output "full help omits screenshot" "node cli.cjs --help-full" "screenshot"

echo ""
echo "-- Supported Command Discovery --"
test_output "list shows chatgpt" "node cli.cjs --list" "chatgpt"
test_output "list shows gemini" "node cli.cjs --list" "gemini"
test_output "list shows session" "node cli.cjs --list" "session"
test_output "list shows do" "node cli.cjs --list" "do"
test_output "list shows server" "node cli.cjs --list" "server"
test_no_output "list omits screenshot" "node cli.cjs --list" "screenshot"
test_no_output "list omits tab.list" "node cli.cjs --list" "tab.list"
test_output "find chatgpt" "node cli.cjs --find chatgpt" "chatgpt"
test_output "find gemini" "node cli.cjs --find gemini" "gemini"
test_output "find session" "node cli.cjs --find session" "session"
test_output "find old screenshot empty" "node cli.cjs --find screenshot" "No commands found"

echo ""
echo "-- Skill Command --"
test_output "skills prints frontmatter" "node cli.cjs skills" "name: surf"
test_output "skill alias works" "node cli.cjs skill" "Headless terminal AI via local signed-in browser profiles"
test_output "skills version current" "node cli.cjs skills" "surf-cli v2.11.1"
test_output "skills chatgpt aliases current" "node cli.cjs skills" "gpt-4.1-mini"
test_output "skills gemini preview current" "node cli.cjs skills" "gemini-3.1-pro-preview"
test_no_output "skills no missing file error" "node cli.cjs skills" "SKILL.md not found"

echo ""
echo "-- Command Help --"
test_output "chatgpt help" "node cli.cjs chatgpt --help" "Send prompt to ChatGPT"
test_output "gemini help" "node cli.cjs gemini --help" "Send prompt to Gemini"
test_output "chatgpt.chats help" "node cli.cjs chatgpt.chats --help" "Search conversations"
test_output "chatgpt.reply help" "node cli.cjs chatgpt.reply --help" "Reply in-thread"
test_output "slack.read help include-dms" "node cli.cjs slack.read --help" "--include-dms"
test_output "slack.read help optional profile text" "node cli.cjs slack.read --help" "Optional Chrome profile email for cookie auth fallback"
test_output "session help" "node cli.cjs session --help" "inspect and reconcile"
test_output "do help" "node cli.cjs do --help" "Execute multiple commands"

echo ""
echo "-- Headless-only Guards --"
test_exit_output "chatgpt rejects with-page" "node cli.cjs chatgpt \"x\" --with-page" 1 "headless-only"
test_exit_output "gemini rejects with-page" "node cli.cjs gemini \"x\" --with-page" 1 "headless-only"
test_exit_output "chatgpt.chats rejects continue" "node cli.cjs chatgpt.chats abc --continue" 1 "headless-only"
test_exit_output "install removed" "node cli.cjs install abc" 1 "removed"
test_exit_output "extension-path removed" "node cli.cjs extension-path" 1 "removed"
test_exit_output "unknown command rejected" "node cli.cjs screenshot" 1 "Unknown or unsupported command"
test_exit_output "typo command rejected" "node cli.cjs chatgtp" 1 "Unknown or unsupported command"
test_exit_output "hidden tab.list rejected" "node cli.cjs tab.list" 1 "Unknown or unsupported command"
test_exit_output "hidden page.read rejected" "node cli.cjs page.read" 1 "Unknown or unsupported command"

echo ""
echo "-- ChatGPT Chats Validation --"
test_output "chatgpt.chats invalid combo" "node cli.cjs chatgpt.chats abc --search test" "cannot use conversation ID with --search"
test_output "chatgpt.chats all+limit invalid" "node cli.cjs chatgpt.chats --all --limit 5" "cannot be combined with --limit"
test_output "chatgpt.chats advanced conflict" "node cli.cjs chatgpt.chats abc --rename 'New Title' --delete" "use only one of --rename, --delete, --delete-ids, or --download-file"
test_output "chatgpt.chats download requires output" "node cli.cjs chatgpt.chats abc --download-file file-123" "requires --output"
test_output "chatgpt.reply usage" "node cli.cjs chatgpt.reply" "Usage: surf chatgpt.reply"
test_output "slack.read thread requires channel" "node cli.cjs slack.read --thread 123" "--thread requires a channel ID"
test_no_output "slack.read no hard profile requirement" "node cli.cjs slack.read --thread 123" "--profile is required for slack.read"

echo ""
echo "-- Session Reconcile --"
tmp_sessions=$(mktemp -d)
test_output "session reconcile empty" \
  "SURF_SESSIONS_DIR=$tmp_sessions node cli.cjs session --reconcile" \
  "No running sessions"
test_output "session clear+reconcile invalid" \
  "node cli.cjs session --clear --reconcile" \
  "cannot combine --clear with --reconcile"
# stale session: dead pid, old createdAt
mkdir -p "$tmp_sessions/chatgpt-stale_2000-01-01_000000.000_0001"
cat > "$tmp_sessions/chatgpt-stale_2000-01-01_000000.000_0001/meta.json" <<'METAMETA'
{"id":"chatgpt-stale_2000-01-01_000000.000_0001","tool":"chatgpt","status":"running","createdAt":"2000-01-01T00:00:00.000Z","pid":999999999,"conversationId":null,"reconcile":null}
METAMETA
test_output "session list shows orphaned" \
  "SURF_SESSIONS_DIR=$tmp_sessions node cli.cjs session --all" \
  "orphaned"
# alive pid but very old → stale, NOT orphaned
mkdir -p "$tmp_sessions/chatgpt-alive-but-old_2000-01-01_000000.000_0002"
cat > "$tmp_sessions/chatgpt-alive-but-old_2000-01-01_000000.000_0002/meta.json" <<'METAMETA'
{"id":"chatgpt-alive-but-old_2000-01-01_000000.000_0002","tool":"chatgpt","status":"running","createdAt":"2000-01-01T00:00:00.000Z","pid":$$,"conversationId":null,"reconcile":null}
METAMETA
test_output "session list shows stale not orphaned" \
  "SURF_SESSIONS_DIR=$tmp_sessions node cli.cjs session --all" \
  "stale"
rm -rf "$tmp_sessions"
# --hours N should not be parsed as a session ID
tmp_sessions=$(mktemp -d)
test_output "session --hours arg not treated as ID" \
  "SURF_SESSIONS_DIR=$tmp_sessions node cli.cjs session --hours 1" \
  "No sessions found"
rm -rf "$tmp_sessions"

echo ""
echo "-- Prompt File --"
test_output "prompt-file missing file" \
  "node cli.cjs chatgpt --prompt-file /tmp/nonexistent_prompt_$$.md 2>&1 || true" \
  "Failed to read prompt file"
empty_prompt=$(mktemp)
test_output "prompt-file empty" \
  "node cli.cjs chatgpt --prompt-file $empty_prompt 2>&1 || true" \
  "prompt file is empty"
rm -f "$empty_prompt"

echo ""
echo "==================================="
echo "Results: $PASS passed, $FAIL failed"
echo "==================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
