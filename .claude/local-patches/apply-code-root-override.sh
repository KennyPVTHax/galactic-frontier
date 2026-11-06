#!/usr/bin/env bash
# Local patch (Galactic Frontier): the framework hard-codes the Unity code root as "Assets" at the repo root, but our Unity project is
# unity/Assets and the repo root also holds our TypeScript src/. Without this patch /project-stage-detect counts 0 source files and
# reports a finished project as greenfield. Adds an OPTIONAL project.yaml key `engine.code_root` (honoured only if that directory exists)
# to the two places that derive the code root. Idempotent; re-run after a framework upgrade.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -I - <<'PY'
import re, pathlib
MARK = "LOCAL PATCH (galactic-frontier)"
# 1) hooks/yaml-helper.sh :: resolve_code_root
p = pathlib.Path("hooks/yaml-helper.sh"); s = p.read_text()
if MARK not in s:
    anchor = '    *)       root="" ;;\n  esac\n'
    assert s.count(anchor) == 1, "yaml-helper anchor changed - review upstream"
    s = s.replace(anchor, anchor + '''
  # LOCAL PATCH (galactic-frontier): optional engine.code_root (e.g. unity/Assets) for a project that lives in a subdirectory.
  _cr_cfg=$(get_yaml_key "$_YH_ROOT/project.yaml" engine.code_root 2>/dev/null)
  if [ -n "$_cr_cfg" ] && [ -d "$_YH_ROOT/$_cr_cfg" ]; then root="$_cr_cfg"; src="engine.code_root"; fi
''')
    p.write_text(s)
# 2) scripts/project-state.sh
p = pathlib.Path("scripts/project-state.sh"); s = p.read_text()
if MARK not in s:
    anchor = '  unreal*) CODE_ROOT="Source" ;;\nesac\n'
    assert s.count(anchor) == 1, "project-state anchor changed - review upstream"
    s = s.replace(anchor, anchor + '''# LOCAL PATCH (galactic-frontier): optional engine.code_root (e.g. unity/Assets) for a project that lives in a subdirectory.
if [ -f project.yaml ]; then
  _CR_CFG=$(yaml_get project.yaml engine.code_root)
  if [ -n "$_CR_CFG" ] && [ -d "$_CR_CFG" ]; then CODE_ROOT="$_CR_CFG"; CSRC="engine.code_root"; fi
fi
''')
    p.write_text(s)
# 3) hooks/validate-commit.sh :: the blocking JSON check must also cover unity/Assets/**/GameData/ (our authored-world + game data).
p = pathlib.Path("hooks/validate-commit.sh"); s = p.read_text()
old = "DATA_FILES=$(echo \"$STAGED\" | grep -E '^(assets|Assets|Content)/(.*/)?[Dd]ata/.*\\.[Jj][Ss][Oo][Nn]$')"
new = "# LOCAL PATCH (galactic-frontier): also unity/Assets/** and directories named *Data (e.g. GameData)\nDATA_FILES=$(echo \"$STAGED\" | grep -E '^(unity/)?(assets|Assets|Content)/(.*/)?[A-Za-z_]*[Dd]ata/.*\\.[Jj][Ss][Oo][Nn]$')"
if MARK not in s:
    assert s.count(old) == 1, "validate-commit anchor changed - review upstream"
    p.write_text(s.replace(old, new))
print("code-root override + unity JSON-check scope ensured")
PY
