# Server developer checks

Run from `server/`, for example:

```sh
node checks/check_camera_photos.js
npm run check:isolation
npm run check:late-evidence
```

The `check_*.js` regression scripts use controlled dependencies. `check_session.js` is different: it reads the configured MongoDB and prints account/session information. Run it only when deliberately inspecting development data; it is not part of the regression suite.
