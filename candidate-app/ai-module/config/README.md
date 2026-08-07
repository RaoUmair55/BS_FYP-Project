# Whitelist Configuration

This folder contains `whitelist.json`, which defines the allowed applications that will not be terminated during an active exam session.

## Whitelisted Entries Explained
- `electron.exe`: The base Electron binary, required for the candidate app to run.
- `candidate-app-electron.exe`: The packaged executable name for the candidate app.
- `explorer.exe`: The Windows shell, necessary for the OS to function normally without crashing to a black screen.
- `notepad.exe`: Allowed strictly for taking quick, plain-text notes if permitted by the exam.
- `taskmgr.exe`: Allowed for system troubleshooting (though could be disabled in stricter configurations).

Note: Critical Windows services (like `svchost.exe`, `system`, etc.) are hardcoded into the `whitelist_enforcer.py` safety list and do not need to be added here.
