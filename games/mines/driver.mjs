import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../../lib/playwright.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ORIGINAL_DIR = path.join(here, "../../originals/mines");
export const LOCAL_JQUERY = path.join(here, "vendor/jquery-1.8.3.min.js");
export const T0 = 1000000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      const rel = urlPath === "/" ? "/index.html" : urlPath;
      const fullPath = path.resolve(ORIGINAL_DIR, "." + rel);
      if (!fullPath.startsWith(ORIGINAL_DIR) || !fs.existsSync(fullPath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(fullPath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      if (rel === "/js/minesweeper.js") {
        const src = fs.readFileSync(fullPath, "utf8");
        const hooked = src.replace(
          "core.init();",
          "window.__minesInternal = { globals: globals, defaults: defaults };\n  core.init();"
        );
        res.end(hooked);
        return;
      }
      res.end(fs.readFileSync(fullPath));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function install({ seed, T0 }) {
  let t = T0;
  const tape = [];
  let a = seed >>> 0;

  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    const v = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    tape.push(v);
    return v;
  };

  const RealDate = Date;
  const FakeDate = function (...args) {
    return args.length ? new RealDate(...args) : new RealDate(Math.floor(t));
  };
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => Math.floor(t);
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  window.Date = FakeDate;
  performance.now = () => t - T0;

  const realSetTimeout = window.setTimeout.bind(window);
  let nextTimerId = 1;
  const timers = new Map();

  window.setTimeout = (fn, delay = 0, ...args) => {
    const id = nextTimerId++;
    const d = Math.max(0, Number(delay) || 0);
    timers.set(id, { fn, delay: d, next: t + d, repeat: false, args });
    return id;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };
  window.setInterval = (fn, delay = 0, ...args) => {
    const id = nextTimerId++;
    const d = Math.max(1, Number(delay) || 1);
    timers.set(id, { fn, delay: d, next: t + d, repeat: true, args });
    return id;
  };
  window.clearInterval = (id) => {
    timers.delete(id);
  };

  function advance(dtMs) {
    const target = t + dtMs;
    while (true) {
      let earliestId = null;
      let earliestTime = target + 1;
      for (const [id, item] of timers) {
        if (item.next <= target && item.next < earliestTime) {
          earliestTime = item.next;
          earliestId = id;
        }
      }
      if (earliestId === null) break;
      const item = timers.get(earliestId);
      t = item.next;
      if (item.repeat) {
        item.next = t + item.delay;
      } else {
        timers.delete(earliestId);
      }
      if (typeof item.fn === "function") item.fn(...item.args);
    }
    t = target;
  }

  const RealImage = window.Image;
  const pendingImages = new Set();
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  window.Image = function (...args) {
    const img = new RealImage(...args);
    const done = () => pendingImages.delete(img);
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    Object.defineProperty(img, "src", {
      get() {
        return srcDesc.get.call(this);
      },
      set(v) {
        pendingImages.add(img);
        srcDesc.set.call(this, v);
      },
      configurable: true,
    });
    return img;
  };
  window.Image.prototype = RealImage.prototype;

  window.prompt = () => "Player";

  function readState() {
    const { globals: g, defaults: d } = window.__minesInternal;
    const cols = g.squaresX;
    const rows = g.squaresY;
    const mines = [];
    const revealed = [];
    const flags = [];

    for (let y = 0; y < rows; y++) {
      let mRow = "";
      let rRow = "";
      let fRow = "";
      for (let x = 0; x < cols; x++) {
        const mv = g.mineMap && g.mineMap[x] ? g.mineMap[x][y] : undefined;
        mRow += mv === undefined ? "." : mv === -1 ? "*" : String(mv);

        const rv = g.revealedMap && g.revealedMap[x] ? g.revealedMap[x][y] : undefined;
        rRow += rv === 1 ? "1" : ".";

        const fv = g.flagMap && g.flagMap[x] ? g.flagMap[x][y] : undefined;
        fRow += fv === 1 ? "F" : fv === 0 ? "u" : ".";
      }
      mines.push(mRow);
      revealed.push(rRow);
      flags.push(fRow);
    }

    const difficulty = Number(d.difficulty) || 0;
    return {
      screen: difficulty === 0 ? "start" : "game",
      difficulty,
      firstClick: !!g.firstClick,
      gameover: !!g.gameover,
      status: document.getElementById("status").textContent,
      totalMines: g.totalMines,
      totalFlags: g.totalFlags,
      elapsedTime: g.elapsedTime,
      mines,
      revealed,
      flags,
    };
  }

  async function waitImages() {
    let guard = 0;
    while (pendingImages.size > 0 && guard++ < 500) {
      await new Promise((r) => realSetTimeout(r, 1));
    }
    await new Promise((r) => realSetTimeout(r, 0));
  }

  window.__mines = {
    ready() {
      return Boolean(window.__minesInternal);
    },
    advance,
    state: readState,
    tape: () => tape.slice(),
    resetTape() {
      tape.length = 0;
    },
    async step(dtMs, action) {
      if (action) {
        if (action.type === "difficulty") {
          const btnMap = { easy: "#easybtn", medium: "#mediumbtn", insane: "#insanebtn" };
          document.querySelector(btnMap[action.value]).click();
        } else if (action.type === "reset") {
          document.querySelector("#reset").click();
        } else if (action.type === "switch") {
          document.querySelector("#switchscreens").click();
        } else if (action.type === "click") {
          const canvas = document.getElementById("board");
          const celSize = window.__minesInternal.defaults.celSize;
          const clientX = canvas.offsetLeft + 1 + action.x * celSize + Math.floor(celSize / 2);
          const clientY = canvas.offsetTop + 1 + action.y * celSize + Math.floor(celSize / 2);
          const ev = new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            button: action.button === "right" ? 2 : 0,
            clientX,
            clientY,
          });
          canvas.dispatchEvent(ev);
          await waitImages();
        }
      }
      if (dtMs > 0) advance(dtMs);
      await waitImages();
      return readState();
    },
  };
}

export async function openOriginal({ seed = 1, headless = true } = {}) {
  if (!fs.existsSync(LOCAL_JQUERY)) {
    throw new Error(`Local jQuery missing at ${LOCAL_JQUERY}`);
  }
  const jqueryCode = fs.readFileSync(LOCAL_JQUERY, "utf8");
  const { server, baseUrl } = await startStaticServer();
  const { chromium } = loadPlaywright();
  let browser;
  try {
    browser = await chromium.launch({ headless });
  } catch {
    browser = await chromium.launch({ headless, channel: "chrome" });
  }

  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
    deviceScaleFactor: 1,
  });

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl)) return route.continue();
    if (url.includes("jquery")) {
      return route.fulfill({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: jqueryCode,
      });
    }
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });

  await page.addInitScript(install, { seed, T0 });
  await page.goto(`${baseUrl}/index.html`, { waitUntil: "load" });
  await page.evaluate(() => {
    if (!window.__mines.ready()) window.__mines.advance(50);
    window.__mines.resetTape();
  });

  const initial = await page.evaluate(() => window.__mines.state());
  return {
    page,
    initial,
    step: ({ dt = 0, action = null }) =>
      page.evaluate(([d, a]) => window.__mines.step(d, a), [dt, action]),
    tape: () => page.evaluate(() => window.__mines.tape()),
    close: async () => {
      await browser.close();
      server.close();
    },
  };
}