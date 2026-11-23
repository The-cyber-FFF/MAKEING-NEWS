(() => {
  "use strict";

  const WIDTH = 1280;
  const HEIGHT = 1038;
  const MARGIN = 48;
  const CONTENT_WIDTH = WIDTH - MARGIN * 2;
  const GAP = 10;
  const TILE_WIDTH = (CONTENT_WIDTH - GAP) / 2;
  const EXPORT_SCALE = 2;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;

  const SANS = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif';
  const SERIF = 'Georgia, "Times New Roman", "Songti SC", serif';
  const BRAND_SERIF = 'Cambria, Georgia, "Times New Roman", serif';
  const BRAND_COLOR = "#6d141a";
  const INK = "#11100e";
  const MUTED_INK = "#2d2a25";
  const NO_START = new Set("，。、；：！？,.;:!?）)】》〉”’…");
  const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

  const el = {
    title: document.getElementById("titleInput"),
    quote: document.getElementById("quoteInput"),
    file: document.getElementById("imageInput"),
    upload: document.querySelector(".upload"),
    thumb: document.getElementById("uploadThumb"),
    uploadText: document.getElementById("uploadText"),
    uploadHint: document.getElementById("uploadHint"),
    uploadAction: document.getElementById("uploadAction"),
    status: document.getElementById("status"),
    download: document.getElementById("downloadButton"),
    downloadLabel: document.getElementById("downloadLabel"),
    poster: document.getElementById("poster"),
  };

  const state = {
    customImage: null,
    customImageUrl: null,
    customImageName: "",
    defaultPortrait: null,
    dragon: null,
    busy: false,
  };

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  let renderQueued = false;
  let resetLabelTimer = 0;

  const titleFont = (size) => `700 ${size}px ${SANS}`;
  const quoteFont = (size) => `700 ${size}px ${SANS}`;
  const dateFont = (size) => `400 ${size}px ${SERIF}`;
  const brandFont = (size) => `700 ${size}px ${BRAND_SERIF}`;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image-load-failed"));
      image.src = src;
    });
  }

  function setStatus(message = "", isError = false) {
    el.status.textContent = message;
    el.status.classList.toggle("is-error", Boolean(message) && isError);
  }

  function formatDate(date = new Date()) {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  function filenameDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function normalize(value) {
    return value
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function splitHeadline(value) {
    const text = normalize(value);
    if (!text) return [];

    let segments = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (segments.length === 1) {
      const match = segments[0].match(/[，,]/);
      if (match && match.index < segments[0].length - 1) {
        const cut = match.index + 1;
        segments = [segments[0].slice(0, cut), segments[0].slice(cut)];
      }
    }

    return segments;
  }

  function measure(text, font) {
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  }

  function tokenize(text) {
    return text.match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|[^\S\n]+|[\s\S]/gu) || [];
  }

  function wrapText(text, font, maxWidth) {
    const tokens = tokenize(text);
    const lines = [];
    let line = "";

    for (const token of tokens) {
      if (token === "\n") {
        lines.push(line.trimEnd());
        line = "";
        continue;
      }

      const candidate = line + token;
      if (!line || measure(candidate, font) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (NO_START.has(token.charAt(0)) && line) {
        line += token.trimStart();
        lines.push(line.trimEnd());
        line = "";
        continue;
      }

      lines.push(line.trimEnd());
      line = token.trimStart();

      if (line && measure(line, font) > maxWidth) {
        let fragment = "";
        for (const char of Array.from(line)) {
          if (fragment && measure(fragment + char, font) > maxWidth) {
            lines.push(fragment.trimEnd());
            fragment = char;
          } else {
            fragment += char;
          }
        }
        line = fragment;
      }
    }

    if (line.trim()) lines.push(line.trimEnd());
    return lines.length ? lines : [""];
  }

  function ellipsize(text, font, maxWidth) {
    if (measure(text, font) <= maxWidth) return text;
    let result = text;
    while (result.length > 1 && measure(`${result}…`, font) > maxWidth) {
      result = result.slice(0, -1);
    }
    return `${result}…`;
  }

  function layoutTitle(value) {
    const segments = splitHeadline(value);
    const sizes = [80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40];

    if (!segments.length) {
      return {
        lines: [],
        size: 80,
        lineHeight: 94,
        firstBaseline: 150,
        lastBaseline: 150,
      };
    }

    for (const size of sizes) {
      const font = titleFont(size);
      const lines = segments.flatMap((segment) => wrapText(segment, font, CONTENT_WIDTH));
      if (lines.length <= 3) {
        return {
          lines,
          size,
          lineHeight: Math.round(size * 1.175),
          firstBaseline: 150,
          lastBaseline: 150 + Math.max(0, lines.length - 1) * Math.round(size * 1.175),
        };
      }
    }

    const size = sizes[sizes.length - 1];
    const font = titleFont(size);
    const lines = segments.flatMap((segment) => wrapText(segment, font, CONTENT_WIDTH));
    const clipped = lines.slice(0, 3);
    if (lines.length > 3) clipped[2] = ellipsize(clipped[2], font, CONTENT_WIDTH);
    return {
      lines: clipped,
      size,
      lineHeight: Math.round(size * 1.175),
      firstBaseline: 150,
      lastBaseline: 150 + Math.max(0, clipped.length - 1) * Math.round(size * 1.175),
    };
  }

  function layoutQuote(value) {
    const text = normalize(value).replace(/\n+/g, " ");
    if (!text) {
      return { lines: [], size: 34, lineHeight: 46, lastBaseline: 0 };
    }

    const sizes = [34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20];
    for (const size of sizes) {
      const font = quoteFont(size);
      const lines = wrapText(text, font, CONTENT_WIDTH);
      if (lines.length <= 2) {
        return {
          lines,
          size,
          lineHeight: Math.round(size * 1.35),
          lastBaseline: 0,
        };
      }
    }

    const size = sizes[sizes.length - 1];
    const font = quoteFont(size);
    const lines = wrapText(text, font, CONTENT_WIDTH).slice(0, 2);
    lines[lines.length - 1] = ellipsize(lines[lines.length - 1], font, CONTENT_WIDTH);
    return {
      lines,
      size,
      lineHeight: Math.round(size * 1.35),
      lastBaseline: 0,
    };
  }

  function getCopyLayout() {
    const title = layoutTitle(el.title.value);
    const quote = layoutQuote(el.quote.value);

    let quoteBaseline = 0;
    let dateBaseline = 0;

    if (quote.lines.length) {
      quoteBaseline = (title.lines.length ? title.lastBaseline : 178) + 63;
      const quoteLastBaseline = quoteBaseline + (quote.lines.length - 1) * quote.lineHeight;
      dateBaseline = quoteLastBaseline + 53;
    } else {
      dateBaseline = title.lines.length ? title.lastBaseline + 63 : 300;
    }

    const imageTop = Math.max(400, Math.ceil(dateBaseline + 32));

    return {
      title,
      quote,
      quoteBaseline,
      dateBaseline,
      imageTop,
    };
  }

  function drawCover(ctx, image, x, y, width, height, focusX = 0.5, focusY = 0.5) {
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const boxRatio = width / height;

    let sx = 0;
    let sy = 0;
    let sw = image.naturalWidth;
    let sh = image.naturalHeight;

    if (imageRatio > boxRatio) {
      sw = sh * boxRatio;
      sx = (image.naturalWidth - sw) * focusX;
    } else {
      sh = sw / boxRatio;
      sy = (image.naturalHeight - sh) * focusY;
    }

    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  }

  function drawPoster(canvas, scale = 1) {
    const pixelWidth = Math.round(WIDTH * scale);
    const pixelHeight = Math.round(HEIGHT * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Masthead
    ctx.fillStyle = BRAND_COLOR;
    ctx.font = brandFont(24);
    ctx.fillText("arknights", MARGIN, 35);

    const copy = getCopyLayout();

    // Headline
    ctx.fillStyle = INK;
    ctx.font = titleFont(copy.title.size);
    copy.title.lines.forEach((line, index) => {
      ctx.fillText(
        line,
        MARGIN,
        copy.title.firstBaseline + index * copy.title.lineHeight,
      );
    });

    // Quote
    if (copy.quote.lines.length) {
      ctx.fillStyle = INK;
      ctx.font = quoteFont(copy.quote.size);
      copy.quote.lines.forEach((line, index) => {
        ctx.fillText(
          line,
          MARGIN,
          copy.quoteBaseline + index * copy.quote.lineHeight,
        );
      });
    }

    // Date
    ctx.fillStyle = MUTED_INK;
    ctx.font = dateFont(27);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0.9px";
    ctx.fillText(formatDate(), MARGIN, copy.dateBaseline);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    // Image pair: the left portrait is fixed, the right artwork is replaceable.
    const imageHeight = HEIGHT - copy.imageTop;
    const replacement = state.customImage || state.dragon;
    const imageX = MARGIN;
    const dragonX = MARGIN + TILE_WIDTH + GAP;

    ctx.fillStyle = "#f5f3ee";
    ctx.fillRect(imageX, copy.imageTop, TILE_WIDTH, imageHeight);
    drawCover(ctx, state.defaultPortrait, imageX, copy.imageTop, TILE_WIDTH, imageHeight, 0.5, 0.44);

    ctx.fillStyle = "#fbfaf8";
    ctx.fillRect(dragonX, copy.imageTop, TILE_WIDTH, imageHeight);
    drawCover(ctx, replacement, dragonX, copy.imageTop, TILE_WIDTH, imageHeight, 0.5, 0.5);

    return copy;
  }

  function renderPreview() {
    drawPoster(el.poster, Math.min(window.devicePixelRatio || 1, 2));
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => {
      renderQueued = false;
      renderPreview();
    });
  }

  function autoGrow(textarea) {
    textarea.style.height = "auto";
    const nextHeight = Math.max(84, Math.min(textarea.scrollHeight, 170));
    textarea.style.height = `${nextHeight}px`;
  }

  function refreshTextareas() {
    autoGrow(el.title);
    autoGrow(el.quote);
  }

  function setDefaultImageUI() {
    el.thumb.src = window.ARK_ASSETS.dragon.src;
    el.thumb.alt = "默认金龙图案";
    el.uploadText.textContent = "默认金龙";
    el.uploadHint.textContent = "点击或拖入图片进行更换";
    el.uploadAction.textContent = "更换";
  }

  function useFile(file) {
    if (!file) return;

    const typeAllowed = ALLOWED_TYPES.has(file.type) || (file.type === "" && /\.(jpe?g|png|webp|avif|gif)$/i.test(file.name));
    if (!typeAllowed) {
      setStatus("请选择 JPG、PNG 或 WebP 图片。", true);
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setStatus("图片过大，请选择 20MB 以内的文件。", true);
      return;
    }

    setStatus("正在载入图片…");
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";

    image.onload = () => {
      if (state.customImageUrl) URL.revokeObjectURL(state.customImageUrl);
      state.customImage = image;
      state.customImageUrl = url;
      state.customImageName = file.name;
      el.thumb.src = url;
      el.thumb.alt = file.name;
      el.uploadText.textContent = file.name;
      el.uploadHint.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
      el.uploadAction.textContent = "更换";
      setStatus("");
      scheduleRender();
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("图片读取失败，请换一张试试。", true);
    };

    image.src = url;
  }

  async function buildExportCanvas() {
    const canvas = document.createElement("canvas");
    drawPoster(canvas, EXPORT_SCALE);
    return canvas;
  }

  function showResetLabel() {
    window.clearTimeout(resetLabelTimer);
    el.downloadLabel.textContent = "生成图片";
    el.download.disabled = false;
    state.busy = false;
  }

  async function downloadPoster() {
    if (state.busy) return;
    state.busy = true;
    el.download.disabled = true;
    el.downloadLabel.textContent = "正在生成…";
    window.clearTimeout(resetLabelTimer);

    try {
      const canvas = await buildExportCanvas();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("export-failed");

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `arknights-headline-${filenameDate()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      el.downloadLabel.textContent = "已生成，下载中";
      resetLabelTimer = window.setTimeout(showResetLabel, 1200);
    } catch (error) {
      setStatus("生成失败，请再试一次。", true);
      showResetLabel();
    }
  }

  function bindEvents() {
    el.title.addEventListener("input", () => {
      autoGrow(el.title);
      scheduleRender();
    });

    el.quote.addEventListener("input", () => {
      autoGrow(el.quote);
      scheduleRender();
    });

    window.addEventListener("resize", () => {
      refreshTextareas();
    });

    el.file.addEventListener("change", () => {
      useFile(el.file.files && el.file.files[0]);
      el.file.value = "";
    });

    el.upload.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        el.file.click();
      }
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      el.upload.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        el.upload.classList.add("is-dragging");
      });
    });

    el.upload.addEventListener("dragleave", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!el.upload.contains(event.relatedTarget)) {
        el.upload.classList.remove("is-dragging");
      }
    });

    el.upload.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.upload.classList.remove("is-dragging");
      useFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
    });

    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", (event) => event.preventDefault());

    el.download.addEventListener("click", downloadPoster);

    window.addEventListener("beforeunload", () => {
      if (state.customImageUrl) URL.revokeObjectURL(state.customImageUrl);
    });
  }

  async function init() {
    bindEvents();
    setDefaultImageUI();
    refreshTextareas();
    scheduleRender();
    el.download.disabled = true;

    const [portraitResult, dragonResult] = await Promise.allSettled([
      loadImage(window.ARK_ASSETS.portrait.src),
      loadImage(window.ARK_ASSETS.dragon.src),
    ]);

    if (portraitResult.status === "fulfilled") {
      state.defaultPortrait = portraitResult.value;
    }
    if (dragonResult.status === "fulfilled") {
      state.dragon = dragonResult.value;
    }

    try {
      await document.fonts.ready;
    } catch (error) {
      // System fonts are already available; this is only a best-effort wait.
    }

    el.download.disabled = false;
    renderPreview();
  }

  init();
})();
