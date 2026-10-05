# Hyperframes Composition Brief: IntegrityFlow

Create a polished 22-second, 1920×1080 local launch video. Follow brag-plan.md as the creative contract. Output ../brag.mp4, ../brag.jpg and ../share-copy.txt.

Source files: dashboard/src/pages/Dashboard.jsx, dashboard/src/App.css, dashboard/src/components/PriorityQueue.jsx, dashboard/src/components/EvidenceViewer.jsx, candidate-app/renderer/selfCheck.html and dashboard/public/logo.svg. Required verbatim UI labels: System Self-Check, Live Monitoring, Active Candidates, Priority Queue, Evidence Timeline, Confirm, Dismiss. Recreate the working workflow with fictional data, not real exam records; use the actual logo. Keep the recognizable dark Material dashboard identity.

Visual identity: #111318 base, #1b1d23 surface, #e8eaed text, #a8c7fa accent, #185abc active blue; local Roboto. Red and amber are semantic alert colors from the project, not decorative accents. Generic cartoon character appears only in illustrative UI.

Scene windows: hook 0–3; self-check 3–8; dashboard 8–14; evidence review 14–19; brand close 19–22. Maintain readable holds and seek-safe camera moves on inner wrappers. Actual source UI copy and layout must be visible in the centerpiece scenes. No generic SaaS language or unverified performance claims.

Audio: assets/music/music.mp3, derived from brag bundled ende.app vol-12, 0.28 bed with a quiet fade. Cue summary is in brag-plan.md; source preset is in the brag plugin assets/music/cues. Native audio volume automation, distinct audio tracks for overlapping cues. Drop and click accents match UI movement. Voice disabled. Audio data is pre-extracted in assets/music/audio-data.json. Add restrained music-coupled accent presence only if seek-safe.

Implementation: one root HTML composition and one paused GSAP timeline, registered after construction. Ship all assets locally. Run the complete Hyperframes check with zero errors, inspect scene stills, render locally and verify duration/audio. No cloud or publication. Preserve the source project; author only in brag-output.
