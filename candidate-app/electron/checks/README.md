# Electron developer checks

Run from `candidate-app/electron/`:

```sh
npm run check:consent
npm run check:reliability
node checks/check_display_timer.js
node checks/check_file_notice.js
node checks/check_voice_toggle.js
```

Reliability checks start temporary local services and run the Python detection regressions. Use the candidate app’s configured Python environment. These files are not exam screens.
