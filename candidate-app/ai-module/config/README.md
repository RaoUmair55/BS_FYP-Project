# Whitelist Configuration

This folder contains `whitelist.json`, which defines the allowed applications that will not be terminated during an active exam session.

## Whitelist Profiles
- **`exam_whitelist`**: Active strictly during actual exam sessions (`APP_MODE=exam`). Contains only the bare essentials (`electron.exe`, `candidate-app-electron.exe`, `python.exe`) to prevent unauthorized applications, browsers, or external cheat tools.
- **`dev_whitelist`**: Active during development and testing (`APP_MODE=dev`). Permits developer tools such as VS Code, Antigravity IDE, terminals, Node.js, and browsers without triggering enforcement kills.

## Critical Notes
- Hardcoded safety exclusions for critical Windows OS kernel services (e.g. `System`, `svchost.exe`, `csrss.exe`, `dwm.exe`, `lsass.exe`, `services.exe`) are enforced directly inside `whitelist_enforcer.py` to prevent any possibility of OS instability.
