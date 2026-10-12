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
  const state = { words: [], lookups: [] };
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
  await page.route("**/api/lookup", async (route) => {
    const { value } = route.request().postDataJSON();
    const word = value.trim().toLowerCase();
    state.lookups.push(word);
    if (!/^[a-z]+$/.test(word)) {
      await route.fulfill({ status: 400, json: { error: "请输入英文单词" } });
      return;
    }
    const cached = state.words.some((w) => w.word === word);
    if (!cached)
      state.words.push(
        summaries.find((w) => w.word === word) || { ...summaries[0], word },
      );
    await route.fulfill({ json: entry(word, cached) });
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
  await expect(page.locator("#search-button")).toBeEnabled();
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
    await search(page, word);
    await expect(page.locator(".saved-badge")).toHaveText("来自本地词库");
  }
});
