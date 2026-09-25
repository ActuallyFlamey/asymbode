# asymbode

A rage-vibecoded tool to help you study plotting **Bode diagrams**.
Draw an **asymptotic Bode plot** by setting **zeroes** and **poles**, and check it against the real solution!

>[!NOTE]
>This project was **entirely written** by **Xiaomi MiMo-v2.6-Flash** on High mode, using OpenCode on T3 Code.<br />
>But it works, I checked. And this README was written by me, a human.

# How to run it
Simply **clone the repo** and open [`index.html`](./index.html) in your browser of choice.

# How it works
- Load the **transfer function** that you have to plot, in **zeroes and poles form**.
- Use the **Zero**, **Pole**, **Complex Zero**, and **Complex Pole** drawing tools to put them where you think they should be.
  - For studying, you might want to **disable** the "*Mirror edits across graphs*" option, so that you can draw the two graphs one by one.
- In **Select** mode, you can also **drag the line** to give it a **constant gain**.
- **Zoom**: drag the background to **pan**; the **mouse wheel** over a plot zooms the **whole view** (ω and dB/° scale together, so the curves keep their shape), while the wheel over an axis (the margins holding the labels) scales **only that axis**. The **ticks follow the zoom**: the axes show finer steps the closer you look, and once a decade is wide enough the ω axis also labels the values in between (`2·10¹`, `3·10¹` …).
- When you're done, press "**Show solution & Check**":
  - A line showing the **correct plot** will appear on the graphs.
  - A **checklist** of your **mistakes** (or lack thereof) will appear on the **sidebar**.
- You can then **export your plots** as images, to easily embed them into **note-taking apps**.

# How to test
- `node selftest.js` — the maths plus the view/zoom/wheel self-tests (no dependencies, runs in plain node).
- `node browsertest.js` — the wheel behaviour driven through **real `WheelEvent`s** in headless Chromium, against the laid-out page (needs `chromium`, or set `CHROME=/path/to/chromium`; skipped if none is found).
