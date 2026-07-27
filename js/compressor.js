(() => {
  "use strict";

  const MAX_BYTES = 50 * 1024 * 1024;

  const QUALITY = {
    high: { scale: 1.5, jpeg: 0.82 },
    medium: { scale: 1.2, jpeg: 0.62 },
    low: { scale: 0.9, jpeg: 0.42 },
  };

  const els = {
    form: document.getElementById("uploadForm"),
    dropZone: document.getElementById("dropZone"),
    fileInput: document.getElementById("fileInput"),
    fileMeta: document.getElementById("fileMeta"),
    fileName: document.getElementById("fileName"),
    fileSize: document.getElementById("fileSize"),
    clearFile: document.getElementById("clearFile"),
    options: document.getElementById("options"),
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
    year: document.getElementById("year"),
  };

  let selectedFile = null;
  let objectUrl = null;

  if (els.year) {
    els.year.textContent = String(new Date().getFullYear());
  }

  // pdf.js worker
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
    setProgress(0, "Preparando…");
    els.downloadBtn.removeAttribute("href");
  }

  function clearSelection() {
    selectedFile = null;
    els.fileInput.value = "";
    els.fileMeta.hidden = true;
    els.options.disabled = true;
    els.compressBtn.disabled = true;
    resetResult();
    setStatus("");
  }

  function isPdf(file) {
    const nameOk = /\.pdf$/i.test(file.name || "");
    const typeOk =
      !file.type ||
      file.type === "application/pdf" ||
      file.type === "application/x-pdf";
    return nameOk || typeOk;
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
    els.fileName.textContent = file.name;
    els.fileSize.textContent = formatBytes(file.size);
    els.fileMeta.hidden = false;
    els.options.disabled = false;
    els.compressBtn.disabled = false;
    setStatus(`Arquivo pronto: ${file.name}`);
  }

  function getSelectedQuality() {
    const checked = els.form.querySelector('input[name="quality"]:checked');
    return QUALITY[checked?.value] || QUALITY.medium;
  }

  async function compressPdf(file, quality) {
    if (!window.pdfjsLib || !window.jspdf?.jsPDF) {
      throw new Error("Bibliotecas de PDF não carregaram. Verifique a conexão.");
    }

    const { jsPDF } = window.jspdf;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const total = pdf.numPages;

    let out = null;

    for (let pageNum = 1; pageNum <= total; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: quality.scale });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      const imgData = canvas.toDataURL("image/jpeg", quality.jpeg);

      // PDF points: 1pt = 1/72"; pdf.js viewport at scale 1 ≈ CSS px at 96dpi.
      // Convert rendered pixels back to points for page size.
      const pxToPt = 72 / 96;
      const pageWidth = (canvas.width / quality.scale) * pxToPt;
      const pageHeight = (canvas.height / quality.scale) * pxToPt;
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

      const pct = (pageNum / total) * 100;
      setProgress(pct, `Comprimindo página ${pageNum} de ${total}…`);
      // Yield so the UI can update
      await new Promise((r) => setTimeout(r, 0));
    }

    const blob = out.output("blob");
    return blob;
  }

  // Drop zone interactions
  els.dropZone.addEventListener("click", () => els.fileInput.click());
  els.dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  els.fileInput.addEventListener("change", () => {
    acceptFile(els.fileInput.files?.[0]);
  });

  ["dragenter", "dragover"].forEach((evt) => {
    els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropZone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropZone.classList.remove("is-dragover");
    });
  });

  els.dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    acceptFile(file);
  });

  els.clearFile.addEventListener("click", clearSelection);
  els.resetBtn.addEventListener("click", clearSelection);

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedFile) {
      setStatus("Nenhum arquivo escolhido.", true);
      return;
    }

    els.compressBtn.disabled = true;
    els.options.disabled = true;
    els.resultPanel.hidden = true;
    els.progressPanel.hidden = false;
    setProgress(2, "Lendo PDF…");
    setStatus("Processando no navegador…");

    try {
      const quality = getSelectedQuality();
      const compressed = await compressPdf(selectedFile, quality);

      revokeObjectUrl();
      objectUrl = URL.createObjectURL(compressed);

      const original = selectedFile.size;
      const next = compressed.size;
      const reduction = original > 0 ? ((1 - next / original) * 100) : 0;
      const grew = next >= original;

      els.statOriginal.textContent = formatBytes(original);
      els.statCompressed.textContent = formatBytes(next);
      els.statReduction.textContent = grew
        ? "Sem redução"
        : `${reduction.toFixed(1)}%`;

      const base = selectedFile.name.replace(/\.pdf$/i, "") || "documento";
      els.downloadBtn.href = objectUrl;
      els.downloadBtn.download = `${base}-comprimido.pdf`;

      els.resultPanel.hidden = false;
      setProgress(100, "Concluído");
      setStatus(
        grew
          ? "Compressão concluída, mas o arquivo não ficou menor (comum em PDFs já otimizados)."
          : "Compressão concluída com sucesso."
      );
    } catch (err) {
      console.error(err);
      setStatus(err?.message || "Falha ao comprimir o PDF.", true);
      els.progressPanel.hidden = true;
    } finally {
      els.compressBtn.disabled = !selectedFile;
      els.options.disabled = !selectedFile;
    }
  });
})();
