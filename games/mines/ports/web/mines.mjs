export const COLS = 30;
export const ROWS = 20;

export const DIFFICULTY = {
  none: 0,
  easy: 9,
  medium: 6,
  insane: 3,
};

function makeGrid(fillValue = undefined) {
  return Array.from({ length: COLS }, () => Array(ROWS).fill(fillValue));
}

export function createState(difficulty = DIFFICULTY.none) {
  return {
    difficulty,
    firstClick: true,
    gameover: false,
    status: "Game on :)",
    totalMines: 0,
    totalFlags: 0,
    elapsedTime: 0,
    timerMs: 0,
    field: makeGrid(undefined),
    revealed: makeGrid(undefined),
    flags: makeGrid(undefined),
  };
}

function resetBoard(state, difficulty = state.difficulty) {
  Object.assign(state, createState(difficulty));
}

function generateField(state, rng) {
  const field = makeGrid(0);
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      let val = Math.floor(rng() * state.difficulty - 1);
      if (val > 0) val = 0;
      field[x][y] = val;
    }
  }

  let totalMines = 0;
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (field[x][y] !== -1) continue;
      totalMines++;
      const xs = [x, x + 1, x - 1];
      const ys = [y, y + 1, y - 1];
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const nx = xs[a];
          const ny = ys[b];
          if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && field[nx][ny] > -1) {
            field[nx][ny]++;
          }
        }
      }
    }
  }

  state.field = field;
  state.totalMines = totalMines;
}

function isRevealed(state, x, y) {
  return state.revealed[x] !== undefined && state.revealed[x][y] !== undefined && state.revealed[x][y] > -1;
}

function countsAsFlagForChord(state, x, y) {
  return state.flags[x] !== undefined && state.flags[x][y] !== undefined && state.flags[x][y] > -1;
}

function revealCell(state, x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS || isRevealed(state, x, y)) return;

  state.revealed[x][y] = 1;

  if (state.field[x][y] === -1) {
    state.gameover = true;
    state.status = "Game over :(";
    return;
  }

  if (state.field[x][y] === 0) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS) {
          revealCell(state, nx, ny);
        }
      }
    }
  }
}

function checkWin(state) {
  let flaggedMines = 0;
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (state.flags[x][y] === 1 && state.field[x][y] === -1) {
        flaggedMines++;
      }
    }
  }
  if (flaggedMines === state.totalMines) {
    state.gameover = true;
    state.status = "You won! :D";
  }
}

function handleClick(state, { button, x, y }, rng) {
  if (state.gameover || state.difficulty === DIFFICULTY.none) return;
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;

  if (button === "left") {
    if (state.flags[x][y] === 1) return;
    if (state.firstClick) {
      do {
        generateField(state, rng);
      } while (state.field[x][y] === -1);
      state.firstClick = false;
      state.timerMs = 0;
    }
    revealCell(state, x, y);
    return;
  }

  if (button === "right") {
    if (isRevealed(state, x, y)) {
      let nearbyFlags = 0;
      const toReveal = [];
      const xs = [x, x + 1, x - 1];
      const ys = [y, y + 1, y - 1];
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const nx = xs[a];
          const ny = ys[b];
          if (countsAsFlagForChord(state, nx, ny)) {
            nearbyFlags++;
          } else {
            toReveal.push([nx, ny]);
          }
        }
      }
      if (nearbyFlags === state.field[x][y]) {
        for (const [nx, ny] of toReveal) {
          revealCell(state, nx, ny);
        }
      }
      return;
    }

    if (state.firstClick) return;

    if (state.flags[x][y] !== 1) {
      state.flags[x][y] = 1;
      state.totalFlags++;
    } else {
      state.flags[x][y] = 0;
      state.totalFlags--;
    }
    checkWin(state);
  }
}

export function step(state, { dt = 0, action = null }, rng) {
  if (action) {
    if (action.type === "difficulty") {
      resetBoard(state, DIFFICULTY[action.value]);
    } else if (action.type === "reset") {
      resetBoard(state, state.difficulty);
    } else if (action.type === "switch") {
      resetBoard(state, DIFFICULTY.none);
    } else if (action.type === "click") {
      handleClick(state, action, rng);
    }
  }

  if (dt > 0 && !state.firstClick && !state.gameover) {
    state.timerMs += dt;
    const ticks = Math.floor(state.timerMs / 1000);
    if (ticks > 0) {
      state.elapsedTime += ticks;
      state.timerMs -= ticks * 1000;
    }
  }
}

export function snapshot(state) {
  const mines = [];
  const revealed = [];
  const flags = [];
  for (let y = 0; y < ROWS; y++) {
    let mRow = "";
    let rRow = "";
    let fRow = "";
    for (let x = 0; x < COLS; x++) {
      const mv = state.field[x][y];
      mRow += mv === undefined ? "." : mv === -1 ? "*" : String(mv);
      rRow += state.revealed[x][y] === 1 ? "1" : ".";
      const fv = state.flags[x][y];
      fRow += fv === 1 ? "F" : fv === 0 ? "u" : ".";
    }
    mines.push(mRow);
    revealed.push(rRow);
    flags.push(fRow);
  }

  return {
    screen: state.difficulty === 0 ? "start" : "game",
    difficulty: state.difficulty,
    firstClick: state.firstClick,
    gameover: state.gameover,
    status: state.status,
    totalMines: state.totalMines,
    totalFlags: state.totalFlags,
    elapsedTime: state.elapsedTime,
    mines,
    revealed,
    flags,
  };
}