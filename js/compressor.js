(() => {
  "use strict";

  const MAX_BYTES = 50 * 1024 * 1024;
  const QUALITY = { scale: 1.2, jpeg: 0.62 };

  const els = {
    selectBtn: document.getElementById("selectBtn"),
    fileInput: document.getElementById("fileInput"),
    fileLabel: document.getElementById("fileLabel"),
    fileName: document.getElementById("fileName"),
    fileSize: document.getElementById("fileSize"),
    compressBtn: document.getElementById("compressBtn"),
    progressPanel: document.getElementById("progressPanel"),
    progressBar: document.getElementById("progressBar"),
    progressFill: document.getElementById("progressFill"),
    progressLabel: document.getElementById("progressLabel"),
    resultPanel: document.getElementById("resultPanel"),
    statOriginal: document.getElementById("statOriginal"),
    statCompressed: document.getElementById("statCompressed"),
    statReduction: document.getElementById("statReduction"),
    downloadBtn: document.getElementById("downloadBtn"),
    resetBtn: document.getElementById("resetBtn"),
    response: document.getElementById("response"),
  };

  let selectedFile = null;
  let objectUrl = null;
  let busy = false;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function setStatus(message, isError = false) {
    els.response.textContent = message || "";
    els.response.classList.toggle("is-error", Boolean(isError));
  }

  function setProgress(percent, label) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    els.progressFill.style.width = `${value}%`;
    els.progressBar.setAttribute("aria-valuenow", String(value));
    if (label) els.progressLabel.textContent = label;
  }

  function revokeObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function resetResult() {
    revokeObjectUrl();
    els.resultPanel.hidden = true;
    els.progressPanel.hidden = true;
    els.downloadBtn.hidden = true;
    els.resetBtn.hidden = true;
    setProgress(0, "Preparando…");
    els.downloadBtn.removeAttribute("href");
  }

  function clearSelection() {
    selectedFile = null;
    busy = false;
    els.fileInput.value = "";
    els.fileLabel.textContent = "1. Selecionar PDF";
    els.compressBtn.disabled = true;
    resetResult();
    setStatus("");
  }

  function isPdf(file) {
    const name = (file.name || "").toLowerCase();
    return name.endsWith(".pdf") || file.type === "application/pdf" || file.type === "application/x-pdf";
  }

  function acceptFile(file) {
    if (!file) {
      setStatus("Nenhum arquivo escolhido.", true);
      return;
    }
    if (!isPdf(file)) {
      setStatus("Envie apenas arquivos PDF (.pdf).", true);
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus("Arquivo muito grande. Limite: 50 MB.", true);
      return;
    }

    selectedFile = file;
    resetResult();
    els.fileLabel.textContent = file.name;
    els.fileName.textContent = file.name;
    els.fileSize.textContent = formatBytes(file.size);
    els.compressBtn.disabled = false;
    setStatus(`Arquivo pronto · clique em 2. Comprimir`);
  }

  async function compressPdf(file) {
    if (!window.pdfjsLib) {
      throw new Error("pdf.js não carregou. Atualize a página (Ctrl+F5).");
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("jsPDF não carregou. Atualize a página (Ctrl+F5).");
    }

    const { jsPDF } = window.jspdf;
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
    const pdf = await loadingTask.promise;
    const total = pdf.numPages;

    if (!total) {
      throw new Error("PDF sem páginas.");
    }

    let out = null;

    for (let pageNum = 1; pageNum <= total; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: QUALITY.scale });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });

      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
      });
      await renderTask.promise;

      const imgData = canvas.toDataURL("image/jpeg", QUALITY.jpeg);
      const pxToPt = 72 / 96;
      const pageWidth = (canvas.width / QUALITY.scale) * pxToPt;
      const pageHeight = (canvas.height / QUALITY.scale) * pxToPt;
      const orientation = pageWidth >= pageHeight ? "l" : "p";

      if (!out) {
        out = new jsPDF({
          orientation,
          unit: "pt",
          format: [pageWidth, pageHeight],
          compress: true,
        });
      } else {
        out.addPage([pageWidth, pageHeight], orientation);
      }

      out.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");

      canvas.width = 0;
      canvas.height = 0;

      setProgress((pageNum / total) * 100, `Página ${pageNum}/${total}`);
      await new Promise((r) => setTimeout(r, 0));
    }

    return out.output("blob");
  }

  async function onCompress() {
    if (busy) return;

    if (!selectedFile) {
      setStatus("Selecione um PDF primeiro.", true);
      return;
    }

    busy = true;
    els.compressBtn.disabled = true;
    els.selectBtn.disabled = true;
    els.resultPanel.hidden = true;
    els.downloadBtn.hidden = true;
    els.resetBtn.hidden = true;
    els.progressPanel.hidden = false;
    setProgress(2, "Lendo PDF…");
    setStatus("Comprimindo… aguarde");

    try {
      const compressed = await compressPdf(selectedFile);

      revokeObjectUrl();
      objectUrl = URL.createObjectURL(compressed);

      const original = selectedFile.size;
      const next = compressed.size;
      const reduction = original > 0 ? (1 - next / original) * 100 : 0;
      const grew = next >= original;

      els.statOriginal.textContent = formatBytes(original);
      els.statCompressed.textContent = formatBytes(next);
      els.statReduction.textContent = grew ? "Sem redução" : `${reduction.toFixed(1)}%`;

      const base = selectedFile.name.replace(/\.pdf$/i, "") || "documento";
      els.downloadBtn.href = objectUrl;
      els.downloadBtn.download = `${base}-comprimido.pdf`;
      els.downloadBtn.hidden = false;
      els.resetBtn.hidden = false;
      els.resultPanel.hidden = false;
      setProgress(100, "Concluído");
      setStatus(
        grew
          ? "Concluído — o arquivo não ficou menor. Clique em 3. Baixar se quiser."
          : "Concluído — clique em 3. Baixar"
      );
    } catch (err) {
      console.error(err);
      setStatus(err?.message || "Falha ao comprimir o PDF.", true);
      els.progressPanel.hidden = true;
    } finally {
      busy = false;
      els.selectBtn.disabled = false;
      els.compressBtn.disabled = !selectedFile;
    }
  }

  els.selectBtn.addEventListener("click", () => {
    els.fileInput.click();
  });

  els.fileInput.addEventListener("change", () => {
    acceptFile(els.fileInput.files && els.fileInput.files[0]);
  });

  els.compressBtn.addEventListener("click", onCompress);
  els.resetBtn.addEventListener("click", clearSelection);
})();
