# Dashboard developer checks

Run from `dashboard/`:

```sh
node checks/check_audio_grouping.cjs
node checks/check_end_exam.cjs
```

These checks exercise dashboard behavior with mocked inputs; they do not start the UI.
