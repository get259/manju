import "./style.css";

type ViewMode = "workspace" | "library";

type Shot = {
  index: number;
  text: string;
  imageId?: number;
  imageUrl?: string;
  videoId?: number;
  videoUrl?: string;
  seconds: "5" | "10";
  imageLoading?: boolean;
  videoLoading?: boolean;
};

type ScriptResponse = {
  text?: string;
  shots?: Array<{ index: number; text: string }>;
  error?: string;
  details?: string;
};

type ImageResponse = {
  imageId?: number;
  imageUrl?: string;
  error?: string;
  details?: string;
};

type VideoResponse = {
  videoId?: number;
  videoUrl?: string;
  error?: string;
  details?: string;
};

type ResourceItem = {
  kind: "image" | "video";
  type?: "image" | "video";
  id: number;
  localUrl: string;
  shotIndex: number | null;
  shotText: string | null;
  createdAt: string;
  meta?: {
    resultSize?: string | null;
    requestedSize?: string | null;
    sound?: string | null;
    requestedSeconds?: string | null;
  };
};

type SequenceValidateResponse = {
  ok: boolean;
  reasons: string[];
  checks: {
    sameMimeType: boolean;
    sameVideoSize: boolean;
    sameSoundSetting: boolean;
    hasMissingVideos: boolean;
  };
};

type SequenceMergeResponse = {
  videoId?: number;
  videoUrl?: string;
  error?: string;
  details?: string;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

const state: {
  view: ViewMode;
  shots: Shot[];
  resources: ResourceItem[];
  sequenceVideoIds: number[];
  sequenceReport: SequenceValidateResponse | null;
} = {
  view: "workspace",
  shots: [],
  resources: [],
  sequenceVideoIds: [],
  sequenceReport: null
};

app.innerHTML = `
  <main class="shell">
    <header class="header">
      <div class="brand">
        <div class="logo" aria-hidden="true"></div>
        <div>
          <h1>AI 漫剧导演台</h1>
          <p>分镜可编辑，一镜一图，一图一视频。</p>
        </div>
      </div>
      <nav class="tabs">
        <button id="tabWorkspace" class="tab is-active" type="button">创作流程</button>
        <button id="tabLibrary" class="tab" type="button">资源库</button>
      </nav>
    </header>

    <section id="viewWorkspace" class="view">
      <section class="card hero">
        <div class="heroTop">
          <h2>Step 1 · 生成分镜脚本（1~5）</h2>
          <span id="status" class="status" aria-live="polite"></span>
        </div>
        <textarea id="prompt" class="input prompt" rows="5" placeholder="输入剧情想法，例如：地铁站偶遇引发误会，最终和解，4个分镜。"></textarea>
        <div class="actions">
          <button id="btnScript" class="btn primary" type="button">生成分镜</button>
        </div>
      </section>

      <section class="card shots">
        <div class="shotsHead">
          <h2>Step 2 · 编辑分镜并按镜出图/出视频</h2>
          <button id="btnReloadResources" class="btn ghost" type="button">刷新资源库</button>
        </div>
        <div id="shotsList" class="shotsList"></div>
      </section>
    </section>

    <section id="viewLibrary" class="view is-hidden">
      <section class="card">
        <div class="libraryHead">
          <h2>本地资源库（SQLite）</h2>
          <button id="btnLibraryRefresh" class="btn ghost" type="button">刷新</button>
        </div>
        <div class="sequenceBox">
          <div class="sequenceHead">
            <h3>待拼接序列</h3>
            <div class="sequenceHeadActions">
              <button id="btnValidateSequence" class="btn ghost" type="button">校验序列兼容性</button>
              <button id="btnMergeSequence" class="btn secondary" type="button">一键合并</button>
            </div>
          </div>
          <div id="sequenceList" class="sequenceList"></div>
          <div id="sequenceReport" class="sequenceReport"></div>
        </div>
        <div id="libraryGrid" class="libraryGrid"></div>
      </section>
    </section>
  </main>
`;

const $tabWorkspace = document.querySelector<HTMLButtonElement>("#tabWorkspace")!;
const $tabLibrary = document.querySelector<HTMLButtonElement>("#tabLibrary")!;
const $viewWorkspace = document.querySelector<HTMLDivElement>("#viewWorkspace")!;
const $viewLibrary = document.querySelector<HTMLDivElement>("#viewLibrary")!;

const $status = document.querySelector<HTMLSpanElement>("#status")!;
const $prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const $btnScript = document.querySelector<HTMLButtonElement>("#btnScript")!;
const $shotsList = document.querySelector<HTMLDivElement>("#shotsList")!;
const $libraryGrid = document.querySelector<HTMLDivElement>("#libraryGrid")!;
const $btnReloadResources = document.querySelector<HTMLButtonElement>("#btnReloadResources")!;
const $btnLibraryRefresh = document.querySelector<HTMLButtonElement>("#btnLibraryRefresh")!;
const $sequenceList = document.querySelector<HTMLDivElement>("#sequenceList")!;
const $sequenceReport = document.querySelector<HTMLDivElement>("#sequenceReport")!;
const $btnValidateSequence = document.querySelector<HTMLButtonElement>("#btnValidateSequence")!;
const $btnMergeSequence = document.querySelector<HTMLButtonElement>("#btnMergeSequence")!;

function setStatus(text: string) {
  $status.textContent = text;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function switchView(view: ViewMode) {
  state.view = view;
  const workspace = view === "workspace";
  $viewWorkspace.classList.toggle("is-hidden", !workspace);
  $viewLibrary.classList.toggle("is-hidden", workspace);
  $tabWorkspace.classList.toggle("is-active", workspace);
  $tabLibrary.classList.toggle("is-active", !workspace);
}

async function callScript(prompt: string): Promise<ScriptResponse> {
  const res = await fetch("/api/scripts/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
  return (await res.json()) as ScriptResponse;
}

async function callImage(shotText: string, shotIndex: number): Promise<ImageResponse> {
  const res = await fetch("/api/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shotText, shotIndex })
  });
  return (await res.json()) as ImageResponse;
}

async function callVideo(shot: Shot): Promise<VideoResponse> {
  const res = await fetch("/api/videos/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shotText: shot.text,
      shotIndex: shot.index,
      imageId: shot.imageId,
      seconds: shot.seconds
    })
  });
  return (await res.json()) as VideoResponse;
}

async function loadResources() {
  const res = await fetch("/api/resources?limit=300");
  const json = (await res.json()) as { items?: ResourceItem[] };
  state.resources = json.items || [];
  renderLibrary();
}

async function deleteResource(kind: "image" | "video", id: number): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`/api/resources/${kind}/${id}`, { method: "DELETE" });
  return (await res.json()) as { ok?: boolean; error?: string };
}

async function validateSequence() {
  if (state.sequenceVideoIds.length === 0) {
    state.sequenceReport = null;
    renderSequence();
    return;
  }
  const res = await fetch("/api/sequences/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoIds: state.sequenceVideoIds })
  });
  state.sequenceReport = (await res.json()) as SequenceValidateResponse;
  renderSequence();
}

async function mergeSequence(): Promise<SequenceMergeResponse> {
  const res = await fetch("/api/sequences/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoIds: state.sequenceVideoIds })
  });
  return (await res.json()) as SequenceMergeResponse;
}

function renderSequence() {
  if (state.sequenceVideoIds.length === 0) {
    $sequenceList.innerHTML = `<div class="empty">点击资源库中的“加入序列”来组装视频顺序。</div>`;
    $sequenceReport.textContent = "";
    $btnMergeSequence.disabled = true;
    return;
  }

  $btnMergeSequence.disabled = state.sequenceVideoIds.length < 2;

  $sequenceList.innerHTML = state.sequenceVideoIds
    .map(
      (id, index) => `
      <div class="sequenceItem">
        <span>#${id}</span>
        <div class="sequenceActions">
          <button class="mini" data-action="up" data-id="${id}" ${index === 0 ? "disabled" : ""}>上移</button>
          <button class="mini" data-action="down" data-id="${id}" ${index === state.sequenceVideoIds.length - 1 ? "disabled" : ""}>下移</button>
          <button class="mini" data-action="remove" data-id="${id}">移除</button>
        </div>
      </div>
    `
    )
    .join("");

  if (!state.sequenceReport) {
    $sequenceReport.textContent = "";
    return;
  }

  $sequenceReport.innerHTML = state.sequenceReport.ok
    ? `<div class="ok">序列兼容，可进入拼接阶段（待接入 FFmpeg）。</div>`
    : `<div class="warn">不兼容：${state.sequenceReport.reasons.join("；")}</div>`;
}

function renderLibrary() {
  if (state.resources.length === 0) {
    $libraryGrid.innerHTML = `<div class="empty">还没有资源。先在创作流程中生成。</div>`;
    return;
  }

  $libraryGrid.innerHTML = state.resources
    .map((item) => {
      const title = item.kind === "image" ? `图片 #${item.id}` : `视频 #${item.id}`;
      const shotText = item.shotText ? escapeHtml(item.shotText) : "";
      const media =
        item.kind === "image"
          ? `<img src="${item.localUrl}" alt="${title}" loading="lazy" />`
          : `<video src="${item.localUrl}" controls preload="metadata"></video>`;
      const isVideo = item.kind === "video" || item.type === "video";
      const inSeq = isVideo && state.sequenceVideoIds.includes(item.id);
      return `
        <article class="resourceItem">
          <div class="resourceMedia">${media}</div>
          <div class="resourceMeta">
            <div class="resourceTop">
              <span class="tag">${item.kind === "image" ? "图片" : "视频"}</span>
              <span>${title}</span>
            </div>
            <div class="resourceTime">${item.createdAt}</div>
            ${shotText ? `<pre class="resourceShot">${shotText}</pre>` : ""}
            ${
              isVideo
                ? `<div class="resourceCtrl"><button class="mini" data-action="toggle-seq" data-id="${item.id}">${
                    inSeq ? "移出序列" : "加入序列"
                  }</button></div>`
                : ""
            }
            <div class="resourceCtrl dangerRow">
              <button class="mini danger" data-action="delete-resource" data-kind="${item.kind}" data-id="${item.id}">删除</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderShots() {
  if (state.shots.length === 0) {
    $shotsList.innerHTML = `<div class="empty">先生成分镜脚本，然后逐个分镜操作。</div>`;
    return;
  }

  $shotsList.innerHTML = state.shots
    .map((shot, i) => {
      const imageButtonText = shot.imageLoading ? "图片生成中..." : "生成图片";
      const videoButtonText = shot.videoLoading ? "视频生成中..." : `生成视频（${shot.seconds}s）`;
      const imageDisabled = shot.imageLoading ? "disabled" : "";
      const videoDisabled = shot.videoLoading || !shot.imageId ? "disabled" : "";
      const imagePreview = shot.imageUrl
        ? `<div class="shotMedia"><img src="${shot.imageUrl}" alt="shot-image-${shot.index}" /></div>`
        : `<div class="shotMediaPlaceholder">暂无图片</div>`;
      const videoPreview = shot.videoUrl
        ? `<div class="shotMedia"><video src="${shot.videoUrl}" controls preload="metadata"></video></div>`
        : `<div class="shotMediaPlaceholder">暂无视频</div>`;

      return `
        <article class="shotCard" data-shot-index="${i}">
          <div class="shotHead">
            <h3>分镜 ${shot.index}</h3>
            <div class="inlineControl">
              <label>时长</label>
              <select class="secondsSelect" data-shot-index="${i}">
                <option value="5" ${shot.seconds === "5" ? "selected" : ""}>5s</option>
                <option value="10" ${shot.seconds === "10" ? "selected" : ""}>10s</option>
              </select>
            </div>
          </div>

          <textarea class="input shotEditor" data-shot-index="${i}" rows="7">${escapeHtml(shot.text)}</textarea>

          <div class="shotActions">
            <button class="btn primary shotImageBtn" data-shot-index="${i}" ${imageDisabled}>${imageButtonText}</button>
            <button class="btn secondary shotVideoBtn" data-shot-index="${i}" ${videoDisabled}>${videoButtonText}</button>
          </div>

          <div class="shotMediaGrid">
            <div>
              <div class="mediaTitle">图片</div>
              ${imagePreview}
            </div>
            <div>
              <div class="mediaTitle">视频</div>
              ${videoPreview}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

$tabWorkspace.addEventListener("click", () => switchView("workspace"));
$tabLibrary.addEventListener("click", async () => {
  switchView("library");
  await loadResources();
});

$btnScript.addEventListener("click", async () => {
  const prompt = $prompt.value.trim();
  if (!prompt) {
    setStatus("请先输入提示词");
    return;
  }

  $btnScript.disabled = true;
  $btnScript.textContent = "生成中...";
  setStatus("正在生成分镜...");
  state.shots = [];
  renderShots();

  try {
    const r = await callScript(prompt);
    if (r.error) {
      setStatus(`生成失败：${r.error}`);
      return;
    }

    const shots = (r.shots || []).slice(0, 5);
    state.shots = shots.map((it) => ({ index: it.index, text: it.text, seconds: "5" }));
    renderShots();
    setStatus(state.shots.length > 0 ? "分镜已生成，可逐镜编辑与出图/出视频" : "未生成有效分镜");
  } catch {
    setStatus("网络异常");
  } finally {
    $btnScript.disabled = false;
    $btnScript.textContent = "生成分镜";
  }
});

$shotsList.addEventListener("input", (event) => {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLTextAreaElement && target.classList.contains("shotEditor")) {
    const i = Number.parseInt(target.dataset.shotIndex || "", 10);
    if (!Number.isFinite(i)) return;
    const shot = state.shots[i];
    if (!shot) return;
    shot.text = target.value;
  }

  if (target instanceof HTMLSelectElement && target.classList.contains("secondsSelect")) {
    const i = Number.parseInt(target.dataset.shotIndex || "", 10);
    if (!Number.isFinite(i)) return;
    const shot = state.shots[i];
    if (!shot) return;
    shot.seconds = target.value === "10" ? "10" : "5";
    renderShots();
  }
});

$shotsList.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;

  if (target instanceof HTMLButtonElement && target.classList.contains("shotImageBtn")) {
    const i = Number.parseInt(target.dataset.shotIndex || "", 10);
    if (!Number.isFinite(i)) return;
    const shot = state.shots[i];
    if (!shot) return;
    const text = shot.text.trim();
    if (!text) {
      setStatus(`分镜 ${shot.index} 内容为空`);
      return;
    }

    shot.imageLoading = true;
    renderShots();
    setStatus(`分镜 ${shot.index} 图片生成中...`);

    try {
      const r = await callImage(text, shot.index);
      if (r.error || !r.imageUrl || typeof r.imageId !== "number") {
        setStatus(`分镜 ${shot.index} 图片生成失败`);
      } else {
        shot.imageId = r.imageId;
        shot.imageUrl = r.imageUrl;
        shot.videoId = undefined;
        shot.videoUrl = undefined;
        setStatus(`分镜 ${shot.index} 图片生成完成`);
        await loadResources();
      }
    } catch {
      setStatus(`分镜 ${shot.index} 图片生成异常`);
    } finally {
      shot.imageLoading = false;
      renderShots();
    }
    return;
  }

  if (target instanceof HTMLButtonElement && target.classList.contains("shotVideoBtn")) {
    const i = Number.parseInt(target.dataset.shotIndex || "", 10);
    if (!Number.isFinite(i)) return;
    const shot = state.shots[i];
    if (!shot || !shot.imageId) return;
    const text = shot.text.trim();
    if (!text) {
      setStatus(`分镜 ${shot.index} 内容为空`);
      return;
    }

    shot.videoLoading = true;
    renderShots();
    setStatus(`分镜 ${shot.index} 视频生成中...`);

    try {
      const r = await callVideo(shot);
      if (r.error || !r.videoUrl || typeof r.videoId !== "number") {
        setStatus(`分镜 ${shot.index} 视频生成失败`);
      } else {
        shot.videoId = r.videoId;
        shot.videoUrl = r.videoUrl;
        setStatus(`分镜 ${shot.index} 视频生成完成`);
        await loadResources();
      }
    } catch {
      setStatus(`分镜 ${shot.index} 视频生成异常`);
    } finally {
      shot.videoLoading = false;
      renderShots();
    }
  }
});

$btnReloadResources.addEventListener("click", async () => {
  await loadResources();
  setStatus("资源库已刷新");
});

$btnLibraryRefresh.addEventListener("click", async () => {
  await loadResources();
});

$btnValidateSequence.addEventListener("click", async () => {
  await validateSequence();
});

$btnMergeSequence.addEventListener("click", async () => {
  if (state.sequenceVideoIds.length < 2) {
    $sequenceReport.innerHTML = `<div class="warn">至少需要 2 个视频才能合并。</div>`;
    return;
  }

  $btnMergeSequence.disabled = true;
  $btnMergeSequence.textContent = "合并中...";

  try {
    const merged = await mergeSequence();
    if (!merged.videoId || !merged.videoUrl) {
      $sequenceReport.innerHTML = `<div class="warn">合并失败：${merged.error || merged.details || "未知错误"}</div>`;
      return;
    }

    $sequenceReport.innerHTML = `<div class="ok">合并成功：视频 #${merged.videoId}</div>`;
    state.sequenceVideoIds = [merged.videoId];
    state.sequenceReport = null;
    await loadResources();
    renderSequence();
    setStatus(`已完成合并，生成视频 #${merged.videoId}`);
  } catch {
    $sequenceReport.innerHTML = `<div class="warn">合并失败：网络异常</div>`;
  } finally {
    $btnMergeSequence.textContent = "一键合并";
    renderSequence();
  }
});

$sequenceList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (!(target instanceof HTMLButtonElement)) return;
  const action = target.dataset.action;
  const id = Number.parseInt(target.dataset.id || "", 10);
  if (!Number.isFinite(id)) return;

  const idx = state.sequenceVideoIds.findIndex((v) => v === id);
  if (idx < 0) return;

  if (action === "remove") {
    state.sequenceVideoIds.splice(idx, 1);
  } else if (action === "up" && idx > 0) {
    [state.sequenceVideoIds[idx - 1], state.sequenceVideoIds[idx]] = [state.sequenceVideoIds[idx], state.sequenceVideoIds[idx - 1]];
  } else if (action === "down" && idx < state.sequenceVideoIds.length - 1) {
    [state.sequenceVideoIds[idx + 1], state.sequenceVideoIds[idx]] = [state.sequenceVideoIds[idx], state.sequenceVideoIds[idx + 1]];
  }

  state.sequenceReport = null;
  renderSequence();
  renderLibrary();
});

$libraryGrid.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (!(target instanceof HTMLButtonElement)) return;
  const action = target.dataset.action;
  const id = Number.parseInt(target.dataset.id || "", 10);
  if (!Number.isFinite(id)) return;

  if (action === "toggle-seq") {
    const idx = state.sequenceVideoIds.findIndex((v) => v === id);
    if (idx >= 0) state.sequenceVideoIds.splice(idx, 1);
    else state.sequenceVideoIds.push(id);

    state.sequenceReport = null;
    renderSequence();
    renderLibrary();
    return;
  }

  if (action === "delete-resource") {
    const kind = target.dataset.kind === "video" ? "video" : "image";
    deleteResource(kind, id)
      .then(async (resp) => {
        if (!resp.ok) {
          setStatus(`删除失败：${resp.error || "未知错误"}`);
          return;
        }

        if (kind === "video") {
          state.sequenceVideoIds = state.sequenceVideoIds.filter((v) => v !== id);
          state.sequenceReport = null;
          renderSequence();
        }

        await loadResources();
        setStatus(`已删除${kind === "video" ? "视频" : "图片"} #${id}`);
      })
      .catch(() => {
        setStatus("删除失败：网络异常");
      });
  }
});

renderShots();
renderSequence();
loadResources().catch(() => void 0);
