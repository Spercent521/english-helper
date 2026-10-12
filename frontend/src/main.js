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
let audioContext;
let source;
let playbackID = 0;
let accent = "us";
let listID = 0;
let words = [];

async function call(method, value, accent) {
  if (window.go?.main?.App)
    return window.go.main.App[method](value, ...(accent ? [accent] : []));
  const response = await fetch(`/api/${method.toLowerCase()}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, accent }),
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
  $("empty-state").hidden = true;
  $("result").innerHTML = `<article class="entry">
    <div class="entry-meta"><span class="saved-badge"><i data-lucide="${entry.cached ? "hard-drive" : "check"}"></i>${entry.cached ? "来自本地词库" : "已存入词库"}</span><span>${date(entry.savedAt)}</span></div>
    <div class="word-heading"><div><h2>${escape(entry.word)}</h2><span class="phonetic">${escape(phonetic(entry))}</span></div><div class="pronunciation"><div class="accent-switch" role="group" aria-label="发音口音"><button data-accent="uk" aria-pressed="${accent === "uk"}">英音</button><button data-accent="us" aria-pressed="${accent === "us"}">美音</button></div><button id="play" class="play" title="播放在线发音" aria-label="播放在线发音"><i data-lucide="volume-2"></i><span>听发音</span></button></div></div>
    <div class="audio-source">有道 · 在线发音</div>
    <div class="meanings">${entry.meanings.map((m) => `<section class="meaning"><h3>${escape(m.partOfSpeech)}<span>${escape(parts[m.partOfSpeech] || "")}</span></h3><ol>${m.definitions.map((d) => `<li><div>${escape(d.definition)}</div>${d.example ? `<blockquote>${escape(d.example)}</blockquote>` : ""}</li>`).join("")}</ol></section>`).join("")}</div>
    ${(entry.examples || []).length ? `<section class="examples"><h3>例句</h3>${entry.examples.map((e) => `<blockquote><p>${escape(e.sentence)}</p><p class="translation">${escape(e.translation)}</p>${e.source ? `<cite>${escape(e.source)}</cite>` : ""}</blockquote>`).join("")}</section>` : ""}
    <div class="entry-source"><i data-lucide="globe"></i><span>${escape(entry.provider || "Free Dictionary API")}${entry.license?.name ? " · " + escape(entry.license.name) : ""}${entry.examples?.length || entry.meanings.some((m) => m.definitions.some((d) => d.example)) ? "" : " · 此词条暂无例句"}</span></div>
  </article>`;
  $("play").addEventListener("click", play);
  refreshIcons();
}
async function lookup(word) {
  if (busy) return;
  busy = true;
  stop();
  view("search");
  $("word-input").value = word;
  $("search-button").disabled = true;
  $("search-button").innerHTML =
    '<i class="spin" data-lucide="loader-circle"></i>';
  message("正在查询…");
  refreshIcons();
  try {
    const entry = await call("Lookup", word);
    render(entry);
    message("");
    await loadWords();
  } catch (error) {
    message(String(error.message || error), true);
  } finally {
    busy = false;
    $("search-button").disabled = false;
    $("search-button").innerHTML = '<i data-lucide="arrow-right"></i>';
    refreshIcons();
  }
}
function playButton(state = "idle") {
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
      document.querySelector(".phonetic").textContent = phonetic(current);
  }
});
refreshIcons();
loadWords().catch((e) => message(`词库读取失败：${e.message || e}`, true));
