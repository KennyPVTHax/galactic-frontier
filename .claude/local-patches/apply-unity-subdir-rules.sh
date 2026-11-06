#!/usr/bin/env bash
# Local patch (Galactic Frontier): the Unity project lives in unity/, not at the repo root, but the framework's path-scoped rules
# match "Assets/**" only. For every rule path starting with "Assets/", add the same pattern prefixed with "unity/".
# Idempotent: safe to re-run after a framework upgrade. Touches only .claude/rules/*.md frontmatter `paths:` lines.
set -euo pipefail
cd "$(dirname "$0")/../rules"
for f in *.md; do
  awk '
    { print }
    /^  - "Assets\// && !seen[$0]++ { l=$0; sub(/"Assets\//, "\"unity/Assets/", l); pending=l }
    pending != "" { if (!(pending in have)) { print pending; have[pending]=1 } pending="" }
  ' "$f" > "$f.tmp"
  # drop duplicates introduced by earlier runs (keep first occurrence of each paths line)
  awk '!(/^  - "/ && dup[$0]++)' "$f.tmp" > "$f"; rm -f "$f.tmp"
done
echo "unity/ path variants ensured in .claude/rules/*.md"
