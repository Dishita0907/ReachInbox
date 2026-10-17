#!/usr/bin/env python3
"""Build a credentials-free backend/.env.example using LOCAL variable names only."""
from pathlib import Path
import re

submission = Path(__file__).resolve().parent
backend = submission / "backend"
if not (backend / "src").is_dir():
    raise SystemExit("ERROR: Expected backend/src in the submission folder")

names = set()
# Include the names in the existing starter template.
example = backend / ".env.example"
if example.exists():
    names.update(re.findall(r"^([A-Za-z_][A-Za-z0-9_]*)=", example.read_text(), re.M))

# Include actual source variable names.
for filename in (backend / "src").rglob("*.ts"):
    content = filename.read_text(encoding="utf-8", errors="ignore")
    names.update(re.findall(r"process\.env\.([A-Za-z_][A-Za-z0-9_]*)", content))
    names.update(re.findall(r"process\.env\[['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\]", content))

# Include keys from the WORKING backend's .env (values are NEVER copied).
working_env = Path.home() / "ReachInbox" / "backend" / ".env"
if working_env.is_file():
    for line in working_env.read_text(encoding="utf-8", errors="ignore").splitlines():
        matched = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if matched:
            names.add(matched.group(1))

# Preserve blank placeholders only.
header = [
    "# ReachInbox backend environment example — keys only, no values or secrets",
    "# Copy to backend/.env and fill in locally.",
    "# Review which keys are required in backend/src and compose.yaml.",
    "",
]
example.write_text("\n".join(header + [f"{name}=" for name in sorted(names)]) + "\n", encoding="utf-8")
print(f"SUCCESS: backend/.env.example contains {len(names)} variable names and no secret values.")
