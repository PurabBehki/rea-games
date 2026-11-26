import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../../lib/rng.mjs";
import { openOriginal, T0 } from "./driver.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const COLS = 30;
const ROWS = 20;

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function findCells(state, pred) {
  const out = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (pred(x, y, state.mines[y][x], state.revealed[y][x], state.flags[y][x])) {
        out.push([x, y]);
      }
    }
  }
  return out;
}

function neighbors(x, y) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) out.push([nx, ny]);
    }
  }
  return out;
}

async function runCase({ seed, player }) {
  const g = await openOriginal({ seed });
  try {
    const trace = [g.initial];
    const inputs = [];
    for (let i = 0; ; i++) {
      const inp = player(trace[trace.length - 1], i);
      if (!inp) break;
      const st = await g.step(inp);
      inputs.push({ dt: inp.dt, action: inp.action });
      trace.push(st);
    }
    return { tape: await g.tape(), inputs, trace };
  } finally {
    await g.close();
  }
}

function winPlayer({ r, difficulty, firstPos, extraSafeFlags = 0, resetAfter = false, dtList = [500, 1000] }) {
  let stage = "start";
  let extraDone = 0;
  let postSteps = 0;
  return (obs) => {
    const dt = pick(r, dtList);
    if (stage === "start") {
      stage = "first";
      return { dt: 1000, action: { type: "difficulty", value: difficulty } };
    }
    if (stage === "first") {
      stage = "play";
      return { dt, action: { type: "click", button: "left", x: firstPos[0], y: firstPos[1] } };
    }
    if (obs.gameover) {
      if (postSteps === 0) {
        postSteps++;
        return { dt: 1000, action: { type: "click", button: "left", x: 0, y: 0 } };
      }
      if (resetAfter && postSteps === 1) {
        postSteps++;
        return { dt: 500, action: { type: "reset" } };
      }
      if (resetAfter && postSteps === 2) {
        postSteps++;
        return { dt: 1000, action: { type: "click", button: "left", x: 10, y: 10 } };
      }
      return null;
    }
    if (extraDone < extraSafeFlags) {
      const safeHidden = findCells(obs, (_x, _y, m, rev, fl) => m !== "*" && rev === "." && fl === ".");
      if (safeHidden.length) {
        extraDone++;
        const [x, y] = pick(r, safeHidden);
        return { dt, action: { type: "click", button: "right", x, y } };
      }
    }
    const unflaggedMines = findCells(obs, (_x, _y, m, _rev, fl) => m === "*" && fl !== "F");
    if (unflaggedMines.length) {
      const [x, y] = unflaggedMines[0];
      return { dt, action: { type: "click", button: "right", x, y } };
    }
    return null;
  };
}

function loseAndResetPlayer({ r, difficulty, safeClicks = 12, resetRounds = 2, dtList = [250, 500, 1000, 1500] }) {
  let stepCount = 0;
  let round = 0;
  let clicksInRound = 0;
  let pickedDiff = false;

  return (obs) => {
    const dt = pick(r, dtList);
    if (!pickedDiff) {
      pickedDiff = true;
      return { dt: 1000, action: { type: "difficulty", value: difficulty } };
    }
    if (obs.gameover) {
      if (stepCount === 0) {
        stepCount++;
        return { dt: 1000, action: { type: "click", button: "right", x: 1, y: 1 } };
      }
      round++;
      if (round >= resetRounds) return null;
      stepCount = 0;
      clicksInRound = 0;
      return { dt: 500, action: { type: "reset" } };
    }
    if (obs.firstClick) {
      const x = Math.floor(r() * COLS);
      const y = Math.floor(r() * ROWS);
      return { dt, action: { type: "click", button: "left", x, y } };
    }
    if (clicksInRound < safeClicks) {
      clicksInRound++;
      const safe = findCells(obs, (_x, _y, m, rev, fl) => m !== "*" && rev === "." && fl !== "F");
      if (safe.length) {
        const [x, y] = pick(r, safe);
        return { dt, action: { type: "click", button: "left", x, y } };
      }
    }
    const mines = findCells(obs, (_x, _y, m, rev, fl) => m === "*" && rev === "." && fl !== "F");
    if (mines.length) {
      const [x, y] = pick(r, mines);
      return { dt, action: { type: "click", button: "left", x, y } };
    }
    return null;
  };
}

function chordAndQuirkPlayer({ r, difficulty, testUnflagQuirk = false, lethalChord = false }) {
  let phase = "start";
  let targetNum = null;
  let queue = [];

  return (obs) => {
    if (phase === "start") {
      phase = "first";
      return { dt: 1000, action: { type: "difficulty", value: difficulty } };
    }
    if (phase === "first") {
      phase = "find";
      return { dt: 500, action: { type: "click", button: "left", x: 15, y: 10 } };
    }
    if (obs.gameover) return null;
    if (queue.length) return queue.shift();

    if (phase === "find") {
      const candidates = findCells(obs, (x, y, m, rev) => {
        if (rev !== "1" || m === "0" || m === "*" || m === ".") return false;
        const nbs = neighbors(x, y);
        const hiddenMines = nbs.filter(([nx, ny]) => obs.mines[ny][nx] === "*" && obs.flags[ny][nx] !== "F");
        const hiddenSafe = nbs.filter(([nx, ny]) => obs.mines[ny][nx] !== "*" && obs.revealed[ny][nx] === "." && obs.flags[ny][nx] !== "F");
        return hiddenMines.length > 0 && hiddenSafe.length > 0;
      });
      if (!candidates.length) {
        const safe = findCells(obs, (_x, _y, m, rev) => m !== "*" && rev === ".");
        if (!safe.length) return null;
        const [sx, sy] = pick(r, safe);
        return { dt: 300, action: { type: "click", button: "left", x: sx, y: sy } };
      }
      targetNum = candidates[0];
      const [tx, ty] = targetNum;
      const nbs = neighbors(tx, ty);
      const mineNbs = nbs.filter(([nx, ny]) => obs.mines[ny][nx] === "*");
      const safeNbs = nbs.filter(([nx, ny]) => obs.mines[ny][nx] !== "*" && obs.revealed[ny][nx] === ".");

      if (lethalChord) {
        const needed = Number(obs.mines[ty][tx]);
        const wrongFlags = safeNbs.slice(0, needed);
        if (wrongFlags.length < needed) return null;
        for (const [fx, fy] of wrongFlags) {
          queue.push({ dt: 250, action: { type: "click", button: "right", x: fx, y: fy } });
        }
        queue.push({ dt: 500, action: { type: "click", button: "right", x: tx, y: ty } });
        phase = "done";
        return queue.shift();
      }
      for (const [mx, my] of mineNbs) {
        if (obs.flags[my][mx] !== "F") {
          queue.push({ dt: 250, action: { type: "click", button: "right", x: mx, y: my } });
        }
      }
      if (testUnflagQuirk && mineNbs.length > 0) {
        const [ux, uy] = mineNbs[0];
        queue.push({ dt: 250, action: { type: "click", button: "right", x: ux, y: uy } });
      }
      queue.push({ dt: 500, action: { type: "click", button: "right", x: tx, y: ty } });
      phase = "done";
      return queue.shift();
    }
    return null;
  };
}

function edgeAndSwitchPlayer() {
  const script = [
    { dt: 300, action: { type: "click", button: "left", x: 5, y: 5 } },
    { dt: 300, action: { type: "click", button: "right", x: 5, y: 5 } },
    { dt: 1000, action: { type: "difficulty", value: "easy" } },
    { dt: 400, action: { type: "click", button: "right", x: 0, y: 0 } },
    { dt: 333, action: { type: "click", button: "left", x: 0, y: 0 } },
    { dt: 334, action: null },
    { dt: 333, action: null },
    { dt: 250, action: { type: "click", button: "right", x: 29, y: 19 } },
    { dt: 250, action: { type: "click", button: "left", x: 29, y: 19 } },
    { dt: 500, action: { type: "click", button: "right", x: 29, y: 19 } },
    { dt: 1000, action: { type: "switch" } },
    { dt: 500, action: { type: "click", button: "left", x: 10, y: 10 } },
    { dt: 1000, action: { type: "difficulty", value: "insane" } },
    { dt: 1200, action: { type: "click", button: "left", x: 29, y: 0 } },
    { dt: 2500, action: { type: "click", button: "right", x: 0, y: 19 } },
  ];
  let idx = 0;
  return () => (idx < script.length ? script[idx++] : null);
}

function floodOverFlagPlayer({ r }) {
  let stage = "start";
  let queue = [];
  return (obs) => {
    if (stage === "start") {
      stage = "first";
      return { dt: 1000, action: { type: "difficulty", value: "easy" } };
    }
    if (stage === "first") {
      stage = "find";
      return { dt: 500, action: { type: "click", button: "left", x: 0, y: 0 } };
    }
    if (queue.length) return queue.shift();
    if (stage === "find") {
      const zeros = findCells(obs, (x, y, m, rev) => {
        if (m !== "0" || rev !== ".") return false;
        return neighbors(x, y).some(([nx, ny]) => obs.mines[ny][nx] !== "*" && obs.revealed[ny][nx] === ".");
      });
      if (!zeros.length) return null;
      const [zx, zy] = pick(r, zeros);
      const nb = neighbors(zx, zy).find(([nx, ny]) => obs.mines[ny][nx] !== "*" && obs.revealed[ny][nx] === ".");
      queue.push({ dt: 300, action: { type: "click", button: "right", x: nb[0], y: nb[1] } });
      queue.push({ dt: 700, action: { type: "click", button: "left", x: zx, y: zy } });
      stage = "done";
      return queue.shift();
    }
    return null;
  };
}

export function buildCases() {
  const R = (s) => mulberry32(s * 7919 + 17);
  const cases = [];
  const add = (name, seed, make) => cases.push({ name, seed, make: () => make(R(seed)) });

  add("edges-and-screens", 1, () => edgeAndSwitchPlayer());
  add("easy-win", 2, (r) => winPlayer({ r, difficulty: "easy", firstPos: [14, 10], resetAfter: true }));
  add("medium-win", 3, (r) => winPlayer({ r, difficulty: "medium", firstPos: [0, 0] }));
  add("insane-win", 4, (r) => winPlayer({ r, difficulty: "insane", firstPos: [15, 9] }));
  add("easy-win-extra-flags", 5, (r) => winPlayer({ r, difficulty: "easy", firstPos: [5, 5], extraSafeFlags: 5 }));
  add("easy-lose-reset", 6, (r) => loseAndResetPlayer({ r, difficulty: "easy", safeClicks: 10, resetRounds: 3 }));
  add("medium-lose-reset", 7, (r) => loseAndResetPlayer({ r, difficulty: "medium", safeClicks: 10, resetRounds: 2 }));
  add("insane-lose-reset", 8, (r) => loseAndResetPlayer({ r, difficulty: "insane", safeClicks: 8, resetRounds: 3 }));
  add("chord-safe-easy", 9, (r) => chordAndQuirkPlayer({ r, difficulty: "easy" }));
  add("chord-safe-medium", 10, (r) => chordAndQuirkPlayer({ r, difficulty: "medium" }));
  add("chord-unflag-quirk", 11, (r) => chordAndQuirkPlayer({ r, difficulty: "easy", testUnflagQuirk: true }));
  add("chord-lethal", 12, (r) => chordAndQuirkPlayer({ r, difficulty: "easy", lethalChord: true }));
  add("flood-over-flag", 13, (r) => floodOverFlagPlayer({ r }));
  add("rejection-sampling-insane", 14, (r) => loseAndResetPlayer({ r, difficulty: "insane", safeClicks: 2, resetRounds: 6, dtList: [333, 667, 1000] }));

  return cases;
}

export async function record({ only, log = () => {} } = {}) {
  const outDir = path.join(here, "cases");
  fs.mkdirSync(outDir, { recursive: true });
  const cases = buildCases().filter((c) => !only || only.includes(c.name));
  let frames = 0;
  let inputs = 0;
  for (const c of cases) {
    const { tape, inputs: inp, trace } = await runCase({ seed: c.seed, player: c.make() });
    fs.writeFileSync(
      path.join(outDir, `${c.name}.json`),
      JSON.stringify({ game: "mines", name: c.name, seed: c.seed, clock0: T0, tape, inputs: inp, trace })
    );
    frames += trace.length;
    inputs += inp.length;
    const end = trace[trace.length - 1];
    log(
      `${c.name.padEnd(28)} frames ${String(trace.length).padStart(4)} randoms ${String(tape.length).padStart(5)} mines ${String(end.totalMines).padStart(3)} status ${end.status}`
    );
  }
  return { cases: cases.length, inputs, frames };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await record({ log: console.log })));
}