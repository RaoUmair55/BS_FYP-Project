# IntegrityFlow panel presentation

Latest deck: `IntegrityFlow_Panel_Animated_2026.pptx`. Previous decks remain available as earlier revisions.

## Presentation order

Slides 1–15 cover the introduction and hand-off to the live demonstration in approximately 5 minutes 45 seconds. Slide 16 is the questions screen. Slides 17–22 are a technical appendix, opened only when needed.

The main sequence covers the problem, objectives, architecture, all eight scope modules, additions, reported load testing, implementation progress and remaining work. Slides 6–10 explain what each module does and the technology used. Speaker notes contain implementation detail, suggested timing and code sources.

Use Slide Show mode. Click or press Space to reveal the next group. The deck has fade transitions and 54 click-controlled reveal groups. It does not advance on a timer. Static previews show the completed slide rather than playing animations.

## Live demonstration: 7–8 minutes

1. Show an exam and its rules in the examiner dashboard.
2. Complete candidate consent, self-check and voice enrollment.
3. Demonstrate a visible phone/head turn and one safely rehearsed environment event.
4. Review the evidence, send a warning and submit an answer.
5. Show a historical summary, or demonstrate controlled offline recovery if rehearsed.

Keep the candidate on a separate laptop from the projected PowerPoint/dashboard: attaching HDMI can introduce a second display and block candidate self-check. Save open work before strict application enforcement. Bring the cable/adapter, charger, backup deck and a clearly identified recording of a successful rehearsal.

## Claims and benchmark interpretation

The supplied benchmark reports 50 synthetic candidate workers with dashboard polling, and an after-run duration of 20 seconds. It reports average HTTP latency falling from 4,142.10 ms to 408.76 ms and request success rising from 89.2% to 100.0%. The deck attributes these figures to the supplied team report because raw logs, hardware specifications and repeated runs were not supplied. No new load test was run while making the deck.

Request success does not establish durable socket delivery, evidence playback, AI accuracy or production capacity. The before/after throughput figures imply different reporting windows, so the main slide emphasizes the latency result rather than a capacity percentage. The reported before P95 of 8,000 ms is labelled as the timeout ceiling. Preserve the original benchmark logs for evaluation questions.

The current route acknowledges a committed violation before deferred scoring/broadcast work. `setImmediate` defers work on the event loop. It is neither a worker thread nor a durable background job. The former awaited database calls were asynchronous, although they kept the HTTP response waiting.

Reporting is implemented through exam summaries, CSV and browser Save PDF. Combining every alert log and screenshot into a single export remains open. The deck does not claim headphones are detected or assign an unsupported overall completion percentage.

Team and supervisor names are carried over from the previous project deck. Confirm their spelling before upload.
