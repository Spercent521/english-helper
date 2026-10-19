import { test, expect } from "@playwright/test";
import fs from "node:fs";

const entry = (word, cached = false) => ({
  word,
  cached,
  phonetic: "/həˈləʊ/",
  phonetics: [],
  savedAt: "2026-10-12T10:00:00Z",
  meanings: [
    {
      partOfSpeech: "interjection",
      definitions: [
        {
          definition:
            "A greeting said when meeting someone or acknowledging their arrival.",
          example: "Hello, everyone.",
        },
      ],
    },
  ],
  license: { name: "CC BY-SA 3.0" },
});
const summaries = [
  {
    word: "hello",
    phonetic: "/həˈləʊ/",
    brief: "A greeting.",
    savedAt: "2026-10-12T10:00:00Z",
  },
  {
    word: "apple",
    phonetic: "/ˈæpəl/",
    brief: "A common round fruit.",
    savedAt: "2026-10-11T10:00:00Z",
  },
];
async function mock(page) {
  const state = { words: [], lookups: [], sources: {} };
  await page.route("**/api/list", async (route) => {
    const { value } = route.request().postDataJSON();
    const rows = [...state.words].sort((a, b) =>
      value === "alphabetical"
        ? a.word.localeCompare(b.word)
        : value === "oldest"
          ? a.savedAt.localeCompare(b.savedAt)
          : b.savedAt.localeCompare(a.savedAt),
    );
    await route.fulfill({ json: rows });
  });
  await page.route("**/api/cached", async (route) => {
    const { value } = route.request().postDataJSON();
    const word = value.trim().toLowerCase();
    state.lookups.push(word);
    if (!/^[a-z]+$/.test(word)) {
      await route.fulfill({ status: 400, json: { error: "请输入英文单词" } });
      return;
    }
    const cached = state.words.some((w) => w.word === word);
    await route.fulfill({
      json: cached
        ? { ...entry(word, true), sources: state.sources[word] }
        : {},
    });
  });
  await page.route("**/api/lookupsource", async (route) => {
    const { value: word, provider } = route.request().postDataJSON();
    if (!state.words.some((w) => w.word === word))
      state.words.push(
        summaries.find((w) => w.word === word) || { ...summaries[0], word },
      );
    const result = { ...entry(word), provider };
    state.sources[word] ||= [];
    if (!state.sources[word].some((s) => s.provider === provider))
      state.sources[word].push(result);
    await route.fulfill({ json: { ...result, sources: state.sources[word] } });
  });
  return state;
}
async function search(page, word) {
  await page.getByRole("textbox", { name: "英文单词" }).fill(word);
  await page.getByRole("button", { name: "查询单词" }).click();
  await expect(page.locator(".word-heading h2")).toHaveText(
    word.trim().toLowerCase(),
    { timeout: 30000 },
  );
  await expect(page.locator("#search-button")).toBeEnabled({ timeout: 30000 });
}
async function trackAudio(page) {
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.__audioContexts = [];
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        window.__audioContexts.push(this);
      }
    };
  });
}
function testRecording(seconds) {
  const sampleRate = 8000;
  const frames = Math.floor(sampleRate * seconds);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    wav.writeInt16LE(Math.round(1000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}
test("search, saved entries, sorting, errors and returning from library", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/");
  await expect(page.locator("#empty-state")).toBeVisible();
  await search(page, "hello");
  await expect(page.locator(".saved-badge")).toHaveText("已存入词库");
  await expect(page.locator(".meaning blockquote")).toHaveText(
    "Hello, everyone.",
  );
  await search(page, "hello");
  await expect(page.locator(".saved-badge")).toHaveText("来自本地词库");
  await search(page, "apple");
  await page.locator("[data-view=library]").click();
  await expect(page.locator("#library-list .word-row strong")).toHaveText([
    "hello",
    "apple",
  ]);
  await page.locator("#sort").selectOption("alphabetical");
  await expect(page.locator("#library-list .word-row strong")).toHaveText([
    "apple",
    "hello",
  ]);
  await page.locator("#sort").selectOption("oldest");
  await expect(page.locator("#library-list .word-row strong")).toHaveText([
    "apple",
    "hello",
  ]);
  await page.locator("#library-list [data-word=hello]").click();
  await expect(page.locator(".saved-badge")).toHaveText("来自本地词库");
  await page.locator("#word-input").fill("123");
  await page.locator("#search-button").click();
  await expect(page.getByRole("status")).toContainText("请输入英文单词");
  expect(state.lookups).toHaveLength(5);
});
test("desktop and mobile layout with screenshots", async ({ page }) => {
  const state = await mock(page);
  state.words = [...summaries];
  await page.goto("/");
  fs.mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: "artifacts/screenshots/desktop-empty.png",
    fullPage: true,
  });
  await search(page, "hello");
  await page.screenshot({
    path: "artifacts/screenshots/desktop-word.png",
    fullPage: true,
  });
  await page.locator("[data-view=library]").click();
  await page.screenshot({
    path: "artifacts/screenshots/desktop-library.png",
    fullPage: true,
  });
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator("[data-view=search]").click();
    await expect(page.locator("#play")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const heading = await page.locator(".word-heading h2").boundingBox();
    const controls = await page.locator(".pronunciation").boundingBox();
    expect(heading.x + heading.width).toBeLessThanOrEqual(controls.x);
    await page.screenshot({
      path: `artifacts/screenshots/word-${width}.png`,
      fullPage: true,
    });
  }
});
test("audio failure is visible and retry remains available", async ({
  page,
}) => {
  await mock(page);
  await trackAudio(page);
  await page.route("**/api/pronounce", (route) =>
    route.fulfill({
      status: 400,
      json: { error: "无法获取在线发音，请检查网络后重试" },
    }),
  );
  await page.goto("/");
  await search(page, "hello");
  await page.getByRole("button", { name: "播放在线发音" }).click();
  await expect(page.getByRole("status")).toContainText("发音播放失败");
  await expect(
    page.getByRole("button", { name: "播放在线发音" }),
  ).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__audioContexts[0]?.state))
    .toBe("suspended");
});
test("audio engine is lazy, suspends after ending and can play again", async ({ page }) => {
  await mock(page);
  await trackAudio(page);
  await page.route("**/api/pronounce", (route) =>
    route.fulfill({ json: testRecording(0.15) }),
  );
  await page.goto("/");
  await search(page, "hello");
  expect(await page.evaluate(() => window.__audioContexts.length)).toBe(0);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "播放在线发音" }).click();
    await expect.poll(() => page.evaluate(() => window.__audioContexts[0]?.state))
      .toBe("suspended");
    await expect(page.locator("#play")).toHaveText("听发音");
  }
  expect(await page.evaluate(() => window.__audioContexts.length)).toBe(1);
});
for (const action of ["stop", "accent", "library", "hidden", "pagehide"]) {
  test(`audio engine suspends on ${action}`, async ({ page }) => {
    await mock(page);
    await trackAudio(page);
    await page.route("**/api/pronounce", (route) =>
      route.fulfill({ json: testRecording(10) }),
    );
    await page.goto("/");
    await search(page, "hello");
    await page.getByRole("button", { name: "播放在线发音" }).click();
    await expect(page.locator("#play")).toHaveText("停止");
    await expect.poll(() => page.evaluate(() => window.__audioContexts[0]?.state))
      .toBe("running");
    if (action === "stop") await page.locator("#play").click();
    if (action === "accent") await page.locator('[data-accent="uk"]').click();
    if (action === "library") await page.locator("[data-view=library]").click();
    if (action === "hidden")
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    if (action === "pagehide")
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(() => page.evaluate(() => window.__audioContexts[0]?.state))
      .toBe("suspended");
  });
}
test("stopping a pending recording keeps the audio engine suspended", async ({ page }) => {
  await mock(page);
  await trackAudio(page);
  let finishRecording;
  const recording = new Promise((resolve) => { finishRecording = resolve; });
  await page.route("**/api/pronounce", async (route) => {
    await recording;
    await route.fulfill({ json: testRecording(10) });
  });
  await page.goto("/");
  await search(page, "hello");
  const response = page.waitForResponse("**/api/pronounce");
  await page.getByRole("button", { name: "播放在线发音" }).click();
  await expect(page.locator("#play")).toHaveText("获取中");
  await page.locator("#play").click();
  await expect.poll(() => page.evaluate(() => window.__audioContexts[0]?.state))
    .toBe("suspended");
  finishRecording();
  await response;
  await expect(page.locator("#play")).toHaveText("听发音");
  expect(await page.evaluate(() => window.__audioContexts[0].state)).toBe("suspended");
});
test("live online audio decodes and plays both accents without files", async ({
  page,
}) => {
  test.skip(
    process.env.LIVE_UI_TEST !== "1",
    "opt-in public provider integration test",
  );
  await mock(page);
  await page.addInitScript(() => {
    window.__audioProof = [];
    const original = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (data) {
      const buffer = await original.call(this, data);
      const samples = buffer.getChannelData(0);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      window.__audioProof.push({
        duration: buffer.duration,
        samples: samples.length,
        peak,
        state: this.state,
      });
      return buffer;
    };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this);
      source.addEventListener("ended", () => {
        window.__ended = (window.__ended || 0) + 1;
      });
      return source;
    };
  });
  const requests = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/pronounce")) requests.push(req.postDataJSON());
  });
  await page.goto("/");
  await search(page, "hello");
  for (const [index, accent] of ["us", "uk", "us"].entries()) {
    await page.locator(`[data-accent="${accent}"]`).click();
    await page.getByRole("button", { name: "播放在线发音" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__audioProof.length), {
        timeout: 20000,
      })
      .toBe(index + 1);
    await expect
      .poll(() => page.evaluate(() => window.__ended), { timeout: 15000 })
      .toBe(index + 1);
    await expect(
      page.getByRole("button", { name: "播放在线发音" }),
    ).toBeVisible();
  }
  const proof = await page.evaluate(() => window.__audioProof);
  for (const audio of proof) {
    expect(audio.duration).toBeGreaterThan(0.1);
    expect(audio.peak).toBeGreaterThan(0.01);
    expect(audio.state).toBe("running");
  }
  expect(requests.map((r) => r.accent)).toEqual(["us", "uk", "us"]);
  console.log("Real audio playback proof:", JSON.stringify(proof));
});
test("live dictionary search and persisted cache", async ({ page }) => {
  test.skip(
    process.env.LIVE_UI_TEST !== "1",
    "opt-in public provider integration test",
  );
  await page.goto("/");
  for (const word of ["hello", "apple"]) {
    await search(page, word);
    await expect(page.locator(".meaning li").first()).toBeVisible();
    await expect(page.locator(".saved-badge")).toHaveText("已存入词库");
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.locator(".source-status.loading")).toHaveCount(0);
    await search(page, word);
    await expect(page.locator(".saved-badge")).toHaveText("来自本地词库");
  }
});

test("keeps both sources and lets the reader switch without another request", async ({
  page,
}) => {
  await mock(page);
  let finishSlow;
  const slow = new Promise((resolve) => {
    finishSlow = resolve;
  });
  await page.route("**/api/lookupsource", async (route) => {
    const { value, provider } = route.request().postDataJSON();
    if (provider === "Free Dictionary API") await slow;
    const result = { ...entry(value), provider };
    result.meanings[0].definitions[0].definition =
      provider === "有道词典" ? "有道释义" : "English definition";
    if (provider === "有道词典")
      result.examples = [
        { sentence: "Youdao-only example.", translation: "有道例句" },
      ];
    await route.fulfill({ json: { ...result, sources: [result] } });
  });
  await page.goto("/");
  await page.locator("#word-input").fill("hello");
  await page.locator("#search-button").click();
  await expect(page.locator(".meaning li")).toContainText("有道释义");
  await expect(
    page.getByRole("tab", { name: /Free Dictionary API/ }),
  ).toContainText("查询中");
  finishSlow();
  await expect(
    page.getByRole("tab", { name: /Free Dictionary API/ }),
  ).toContainText("已找到");
  await expect(page.locator(".meaning li")).toContainText("有道释义");
  await page.getByRole("tab", { name: /Free Dictionary API/ }).click();
  await expect(page.locator(".meaning li")).toContainText("English definition");
  await expect(page.locator(".examples")).toHaveCount(0);
  await page.getByRole("tab", { name: /有道词典/ }).click();
  await expect(page.locator(".meaning li")).toContainText("有道释义");
  await expect(page.locator(".examples")).toContainText("Youdao-only example.");
  await page.screenshot({
    path: "artifacts/screenshots/multiple-sources.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 1400 });
  await page.evaluate(
    () => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/screenshots/multiple-sources-mobile.png",
    fullPage: false,
  });
});

test("legacy local entries stay offline until a missing source is explicitly requested", async ({
  page,
}) => {
  const state = await mock(page);
  state.words = [summaries[0]];
  let requests = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/lookupsource")) requests++;
  });
  await page.goto("/");
  await search(page, "hello");
  await expect(
    page.getByRole("tab", { name: /Free Dictionary API/ }),
  ).toContainText("已找到");
  await expect(page.getByRole("tab", { name: /有道词典/ })).toContainText(
    "未查询",
  );
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "有道词典 · 查询此来源" }).click();
  await expect(page.getByRole("tab", { name: /有道词典/ })).toContainText(
    "已找到",
  );
  expect(requests).toBe(1);
});

test("a failed source stays visible and can be retried without losing the other result", async ({
  page,
}) => {
  await mock(page);
  let attempts = 0;
  await page.route("**/api/lookupsource", async (route) => {
    const { value, provider } = route.request().postDataJSON();
    if (provider === "Free Dictionary API" && attempts++ === 0) {
      await route.fulfill({ status: 400, json: { error: "无法连接词典服务" } });
    } else {
      const result = { ...entry(value), provider };
      await route.fulfill({ json: { ...result, sources: [result] } });
    }
  });
  await page.goto("/");
  await search(page, "hello");
  await expect(
    page.getByRole("tab", { name: /Free Dictionary API/ }),
  ).toContainText("连接失败");
  await expect(page.locator(".meaning li")).toBeVisible();
  await page
    .getByRole("button", { name: "Free Dictionary API · 重试" })
    .click();
  await expect(
    page.getByRole("tab", { name: /Free Dictionary API/ }),
  ).toContainText("已找到");
});

test("late source results do not interrupt pronunciation", async ({ page }) => {
  await mock(page);
  let finishSlow;
  const slow = new Promise((resolve) => {
    finishSlow = resolve;
  });
  await page.route("**/api/lookupsource", async (route) => {
    const { value, provider } = route.request().postDataJSON();
    if (provider === "Free Dictionary API") await slow;
    const result = { ...entry(value), provider };
    await route.fulfill({ json: { ...result, sources: [result] } });
  });
  await page.route("**/api/pronounce", (route) =>
    route.fulfill({ json: "data:audio/mpeg;base64,AA==" }),
  );
  await page.addInitScript(() => {
    window.__stops = 0;
    window.AudioContext = class {
      async resume() {}
      async suspend() {}
      async decodeAudioData() {
        return {};
      }
      createBufferSource() {
        return {
          connect() {},
          disconnect() {},
          start() {},
          stop() {
            window.__stops++;
          },
        };
      }
    };
  });
  await page.goto("/");
  await page.locator("#word-input").fill("hello");
  await page.locator("#search-button").click();
  await expect(page.locator(".word-heading h2")).toHaveText("hello");
  await page.getByRole("button", { name: "播放在线发音" }).click();
  await expect(page.locator("#play")).toHaveText("停止");
  finishSlow();
  await expect(
    page.getByRole("tab", { name: /Free Dictionary API/ }),
  ).toContainText("已找到");
  await expect(page.locator("#play")).toHaveText("停止");
  expect(await page.evaluate(() => window.__stops)).toBe(0);
  await page.locator("#play").click();
  expect(await page.evaluate(() => window.__stops)).toBe(1);
});
