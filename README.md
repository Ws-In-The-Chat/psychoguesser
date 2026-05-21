# 🧠 PsychoGuesser — AP Psychology Landmarks

A GeoGuessr-style multiplayer game where you identify real-world places that shaped psychology history.

---

## Quick Start

### Step 1 — Install Node.js (one-time)
Download and install the **LTS version** from: **https://nodejs.org**

### Step 2 — Run the game

**Option A — Double-click:** Open `START.command` (it installs everything and opens the browser automatically)

**Option B — Terminal:**
```bash
cd /Users/alec/psychoguesser
npm install
node server.js
```

Then open **http://localhost:3000** in your browser.

---

## Playing with Friends

When the server is running, your terminal will show:
```
Local:   http://localhost:3000       ← your browser
Network: http://192.168.x.x:3000    ← friends on the same WiFi
```

Friends on the **same WiFi** can use the Network URL directly.
For friends **anywhere** in the world, use a free tunnel like [ngrok](https://ngrok.com):
```bash
ngrok http 3000
```

---

## Game Modes

| Mode | Rounds | Time | Notes |
|------|--------|------|-------|
| 🌍 Classic | 5 | 60s | Balanced score: accuracy + speed |
| ⚡ Sprint | 8 | 25s | Fast-paced, speed is critical |
| 🔍 Detective | 5 | 80s | Clues unlock every 18s — guess early for bonus points |
| 📖 Practice | 5 | None | All clues shown, no pressure — perfect for studying |

## Scoring

- **Distance score:** Up to 5,000 pts — drops exponentially with distance
- **Time bonus:** +12 pts per second remaining on the clock
- A guess within ~50 km scores 4,500+ points

---

## Locations (15 total)

| Location | Significance |
|----------|-------------|
| Berggasse 19, Vienna | Freud's home — birthplace of psychoanalysis |
| Leipzig University | Wundt's 1879 lab — experimental psychology's origin |
| Yale University | Milgram's obedience experiments (1961) |
| Stanford University | Zimbardo's Prison Experiment (1971) |
| Harvard University | Skinner's operant conditioning lab |
| St. Petersburg Institute | Pavlov's classical conditioning with dogs |
| Johns Hopkins Hospital | Watson & Rayner's "Little Albert" (1920) |
| Salpêtrière Hospital, Paris | Charcot's hypnosis work — influenced Freud |
| University of Geneva | Piaget's cognitive development research |
| Bethlem Royal Hospital | The original "Bedlam" — oldest psychiatric hospital |
| Cavendish, Vermont | Phineas Gage railroad accident (1848) |
| Swarthmore College | Asch's conformity line experiments |
| Brooklyn College | Maslow taught here while developing his hierarchy |
| Küsnacht, Switzerland | Carl Jung's home and the Jung Institute |
| Tuskegee University | Site of the unethical 40-year syphilis study |
