import { createState, step, snapshot } from "./mines.mjs";

const raw = await new Promise((resolve) => {
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => resolve(s));
});
const c = JSON.parse(raw);

let used = 0;
const rng = () => {
  if (used >= c.tape.length) {
    throw new Error("asked for more random numbers than the original used");
  }
  return c.tape[used++];
};

const state = createState();
const trace = [snapshot(state)];
for (const inp of c.inputs) {
  step(state, inp, rng);
  trace.push(snapshot(state));
}

process.stdout.write(JSON.stringify({ trace, tapeUsed: used }));