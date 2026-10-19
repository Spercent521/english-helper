import {
  createIcons,
  Search,
  Library,
  HardDrive,
  ArrowRight,
  ArrowUpRight,
  ArrowDownUp,
  Volume2,
  Check,
  Globe,
  LoaderCircle,
  Square,
} from "lucide";
import "./style.css";

const icons = {
  Search,
  Library,
  HardDrive,
  ArrowRight,
  ArrowUpRight,
  ArrowDownUp,
  Volume2,
  Check,
  Globe,
  LoaderCircle,
  Square,
};
const refreshIcons = () => createIcons({ icons });
const $ = (id) => document.getElementById(id);
const escape = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let current;
let busy = false;
let playing = false;
let playbackState = "idle";
let audioContext;
let source;
let playbackID = 0;
let accent = "us";
let listID = 0;
let words = [];
const providers = ["Free Dictionary API", "有道词典"];
let sourceStates = {};
let selectedProvider = "";
let lookupID = 0;
let activeEntry;

async function call(method, value, option) {
  if (window.go?.main?.App)
    return window.go.main.App[method](value, ...(option ? [option] : []));
  const response = await fetch(`/api/${method.toLowerCase()}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      value,
      ...(method === "LookupSource"
        ? { provider: option }
        : { accent: option }),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").className = error ? "error" : "";
}
function view(name) {
  stop();
  $("search-view").hidden = name !== "search";
  $("library-view").hidden = name !== "library";
  $("breadcrumb").textContent =
    name === "search" ? "词典 / 查单词" : "词典 / 单词库";
  document
    .querySelectorAll(".nav")
    .forEach((el) => el.classList.toggle("active", el.dataset.view === name));
  if (name === "library")
    loadWords().catch((e) => message(String(e.message || e), true));
}
function date(raw) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(raw));
}
function wordRows(items) {
  return items
    .map(
      (w) =>
        `<button class="word-row" data-word="${escape(w.word)}"><div><strong>${escape(w.word)}</strong><span class="row-phonetic">${escape(w.phonetic)}</span><p>${escape(w.brief)}</p></div><time>${date(w.savedAt)}</time><i data-lucide="arrow-up-right"></i></button>`,
    )
    .join("");
}
async function loadWords() {
  const id = ++listID;
  const loaded = await call("List", $("sort").value);
  if (id !== listID) return;
  words = loaded;
  $("count").textContent = words.length;
  $("library-count").textContent = `${words.length} 个已保存单词`;
  $("library-list").innerHTML = words.length
    ? wordRows(words)
    : '<div class="library-empty">还没有收录单词</div>';
  const recent = [...words]
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, 3);
  $("recent-list").innerHTML = wordRows(recent);
  $("recent-section").hidden = !words.length;
  refreshIcons();
}
const parts = {
  noun: "名词",
  verb: "动词",
  adjective: "形容词",
  adverb: "副词",
  interjection: "感叹词",
  preposition: "介词",
  pronoun: "代词",
  conjunction: "连词",
};
function phonetic(entry) {
  return (
    entry.phonetics?.find((p) => p.accent === accent)?.text ||
    entry.phonetic ||
    entry.phonetics?.find((p) => p.text)?.text ||
    ""
  );
}
function render(entry) {
  current = entry;
  const savedSources = entry.sources?.length ? entry.sources : [entry];
  for (const item of savedSources) {
    sourceStates[item.provider || "Free Dictionary API"] = {
      status: "ready",
      entry: item,
    };
  }
  if (!selectedProvider || sourceStates[selectedProvider]?.status !== "ready") {
    selectedProvider =
      providers.find((p) => sourceStates[p]?.status === "ready") || "";
  }
  const selected = sourceStates[selectedProvider]?.entry;
  activeEntry = selected
    ? {
        ...entry,
        ...selected,
        word: entry.word,
        savedAt: entry.savedAt,
        cached: entry.cached,
        examples: selected.examples || [],
      }
    : entry;
  entry = activeEntry;
  $("empty-state").hidden = true;
  $("result").innerHTML = `<article class="entry">
    <div class="entry-meta"><span class="saved-badge"><i data-lucide="${entry.cached ? "hard-drive" : "check"}"></i>${entry.cached ? "来自本地词库" : "已存入词库"}</span><span>${date(entry.savedAt)}</span></div>
    <div class="source-tabs" role="tablist" aria-label="词典来源">${providers
      .map((p) => {
        const state = sourceStates[p] || { status: "idle" };
        const label = {
          ready: "已找到",
          loading: "查询中",
          idle: "未查询",
          missing: "未收录",
          error: "连接失败",
        }[state.status];
        return `<button role="tab" data-provider="${escape(p)}" aria-selected="${selectedProvider === p}" aria-controls="source-panel" id="tab-${providers.indexOf(p)}">${escape(p)}<span class="source-status ${state.status}">${label}</span></button>`;
      })
      .join("")}</div>
    <div class="source-actions">${providers
      .filter((p) =>
        ["idle", "error", "missing"].includes(
          sourceStates[p]?.status || "idle",
        ),
      )
      .map(
        (p) =>
          `<button data-fetch-provider="${escape(p)}">${escape(p)} · ${sourceStates[p]?.status === "idle" || !sourceStates[p] ? "查询此来源" : "重试"}</button>`,
      )
      .join("")}</div>
    <div id="source-panel" role="tabpanel" aria-labelledby="tab-${providers.indexOf(selectedProvider)}">
    <div class="word-heading"><div><h2>${escape(entry.word)}</h2><span class="phonetic">${escape(phonetic(entry))}</span></div><div class="pronunciation"><div class="accent-switch" role="group" aria-label="发音口音"><button data-accent="uk" aria-pressed="${accent === "uk"}">英音</button><button data-accent="us" aria-pressed="${accent === "us"}">美音</button></div><button id="play" class="play" title="播放在线发音" aria-label="播放在线发音"><i data-lucide="volume-2"></i><span>听发音</span></button></div></div>
    <div class="audio-source">有道 · 在线发音</div>
    <div class="meanings">${entry.meanings.map((m) => `<section class="meaning"><h3>${escape(m.partOfSpeech)}<span>${escape(parts[m.partOfSpeech] || "")}</span></h3><ol>${m.definitions.map((d) => `<li><div>${escape(d.definition)}</div>${d.example ? `<blockquote>${escape(d.example)}</blockquote>` : ""}</li>`).join("")}</ol></section>`).join("")}</div>
    ${(entry.examples || []).length ? `<section class="examples"><h3>例句</h3>${entry.examples.map((e) => `<blockquote><p>${escape(e.sentence)}</p><p class="translation">${escape(e.translation)}</p>${e.source ? `<cite>${escape(e.source)}</cite>` : ""}</blockquote>`).join("")}</section>` : ""}
    <div class="entry-source"><i data-lucide="globe"></i><span>${escape(entry.provider || "Free Dictionary API")}${entry.license?.name ? " · " + escape(entry.license.name) : ""}${entry.examples?.length || entry.meanings.some((m) => m.definitions.some((d) => d.example)) ? "" : " · 此词条暂无例句"}</span></div>
    </div>
  </article>`;
  $("play").addEventListener("click", play);
  playButton(playbackState);
  refreshIcons();
}
async function lookup(word) {
  const id = ++lookupID;
  busy = true;
  stop();
  current = undefined;
  activeEntry = undefined;
  selectedProvider = "";
  sourceStates = {};
  $("result").innerHTML = "";
  view("search");
  $("word-input").value = word;
  $("search-button").disabled = true;
  $("search-button").innerHTML =
    '<i class="spin" data-lucide="loader-circle"></i>';
  message("正在查询…");
  refreshIcons();
  try {
    const entry = await call("Cached", word);
    if (id !== lookupID) return;
    if (entry.word) {
      render(entry);
      message("");
    } else {
      await Promise.all(
        providers.map((provider) => fetchSource(word, provider, id)),
      );
      if (id !== lookupID) return;
      if (!current)
        message(
          providers
            .map((p) => `${p}：${sourceStates[p]?.error || "未返回结果"}`)
            .join("；"),
          true,
        );
    }
    if (id !== lookupID) return;
    await loadWords();
  } catch (error) {
    if (id === lookupID) message(String(error.message || error), true);
  } finally {
    if (id !== lookupID) return;
    busy = false;
    $("search-button").disabled = false;
    $("search-button").innerHTML = '<i data-lucide="arrow-right"></i>';
    refreshIcons();
  }
}
async function fetchSource(word, provider, id = lookupID) {
  if (sourceStates[provider]?.status === "loading") return;
  sourceStates[provider] = { status: "loading" };
  if (current) render(current);
  else message("正在查询词典来源…");
  try {
    const entry = await call("LookupSource", word, provider);
    if (id !== lookupID) return;
    const found = entry.sources?.find((s) => s.provider === provider) || entry;
    sourceStates[provider] = { status: "ready", entry: found };
    // Preserve a source the user is reading when another response arrives.
    if (!selectedProvider) selectedProvider = provider;
    const merged = providers.flatMap((p) =>
      sourceStates[p]?.entry ? [sourceStates[p].entry] : [],
    );
    render({ ...entry, sources: merged });
    message("");
    await loadWords();
  } catch (error) {
    if (id !== lookupID) return;
    const text = String(error.message || error);
    sourceStates[provider] = {
      status: text.includes("未找到") ? "missing" : "error",
      error: text,
    };
    if (current) render(current);
    else if (!busy) message(`${provider}：${text}`, true);
  }
}
function playButton(state = "idle") {
  playbackState = state;
  const button = $("play");
  if (!button) return;
  button.innerHTML = `<i ${state === "loading" ? 'class="spin"' : ""} data-lucide="${state === "loading" ? "loader-circle" : state === "playing" ? "square" : "volume-2"}"></i><span>${state === "loading" ? "获取中" : state === "playing" ? "停止" : "听发音"}</span>`;
  button.setAttribute(
    "aria-label",
    state === "idle" ? "播放在线发音" : "停止播放",
  );
  button.title = state === "idle" ? "播放在线发音" : "停止播放";
  refreshIcons();
}
function stop() {
  playbackID++;
  playing = false;
  if (source) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* Already ended. */
    }
    source.disconnect();
    source = undefined;
  }
  playButton();
}
async function play() {
  if (!current) return;
  if (playing) {
    stop();
    return;
  }
  const id = ++playbackID;
  const word = current.word;
  playing = true;
  playButton("loading");
  message("");
  try {
    // Unlock the audio context during the user's click, before awaiting the network.
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    const recording = await call("Pronounce", word, accent);
    if (id !== playbackID) return;
    const bytes = Uint8Array.from(atob(recording.split(",")[1]), (c) =>
      c.charCodeAt(0),
    );
    const buffer = await audioContext.decodeAudioData(bytes.buffer);
    if (id !== playbackID) return;
    source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      if (id === playbackID) stop();
    };
    source.start();
    playButton("playing");
  } catch (error) {
    if (id === playbackID) {
      stop();
      message(`发音播放失败：${error.message || error}`, true);
    }
  }
}
document
  .querySelectorAll(".nav")
  .forEach((el) => el.addEventListener("click", () => view(el.dataset.view)));
$("all-words").addEventListener("click", () => view("library"));
$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  lookup($("word-input").value);
});
$("sort").addEventListener("change", () =>
  loadWords().catch((e) => message(String(e.message || e), true)),
);
document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-provider]");
  if (
    tab &&
    sourceStates[tab.dataset.provider]?.status === "ready" &&
    current
  ) {
    stop();
    selectedProvider = tab.dataset.provider;
    render(current);
  }
  const fetch = e.target.closest("[data-fetch-provider]");
  if (fetch && current) fetchSource(current.word, fetch.dataset.fetchProvider);
  const el = e.target.closest("[data-word]");
  if (el) lookup(el.dataset.word);
  const choice = e.target.closest("[data-accent]");
  if (choice) {
    stop();
    accent = choice.dataset.accent;
    document
      .querySelectorAll("[data-accent]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", b.dataset.accent === accent),
      );
    if (current)
      document.querySelector(".phonetic").textContent = phonetic(
        activeEntry || current,
      );
  }
});
document.addEventListener("keydown", (event) => {
  if (
    !event.target.matches("[data-provider]") ||
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  )
    return;
  const tabs = [...document.querySelectorAll("[data-provider]")].filter(
    (tab) => sourceStates[tab.dataset.provider]?.status === "ready",
  );
  if (!tabs.length) return;
  const index = tabs.indexOf(event.target);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  event.preventDefault();
  const provider = tabs[next].dataset.provider;
  stop();
  selectedProvider = provider;
  render(current);
  document.querySelector(`[data-provider="${provider}"]`).focus();
});
refreshIcons();
loadWords().catch((e) => message(`词库读取失败：${e.message || e}`, true));
