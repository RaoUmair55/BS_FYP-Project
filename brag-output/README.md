# IntegrityFlow launch video

22 seconds, Full HD 1920×1080 at 30 fps. Music and interface sound accents; no voiceover.

Files:
- brag.mp4: finished launch video, with the selected poster baked into frame zero.
- brag.jpg: shareable thumbnail from the settled Live Monitoring scene.
- share-copy.txt: ready-to-use caption.
- composition/index.html: editable Hyperframes source.
- build_video.py: regenerates the source composition.
- brag-plan.md: storyboard and source-derived factual boundaries.
- check.json: successful browser, layout, contrast and runtime verification.

The film uses IntegrityFlow's actual logo, palette and UI labels in a readable illustrative recreation. Candidate data and evidence are fictional. It shows readiness checks, monitoring and examiner evidence review, without claiming measured detection accuracy.

Music: bundled brag track “Happy Beats Business Moves Vol. 12” by ende.app. Interface sounds supplied by the brag plugin.

To render again from the project root:
    npx hyperframes render brag-output/composition --quality delivery --fps 30 --workers 1 --low-memory-mode --output brag-output/brag.mp4

Rendering does not modify the candidate app, server or dashboard.
