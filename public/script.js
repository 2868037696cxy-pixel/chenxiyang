const form = document.getElementById("scrape-form");
const logContainer = document.getElementById("log");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const fileInput = document.getElementById("keywords");
const keywordText = document.getElementById("keywords-text");
const template = document.getElementById("log-entry-template");
const countryField = document.getElementById("country-field");
const countryList = document.getElementById("country-list");
const selectAllBtn = countryField.querySelector('[data-action="select-all"]');
const clearAllBtn = countryField.querySelector('[data-action="clear-all"]');
const modeRadios = form.querySelectorAll('input[name="mode"]');

const MAX_LOG_ITEMS = 300;

let eventSource;
let isRunning = false;
let supportedCountries = [];
let defaultCountries = [];
let eventStreamInterrupted = false;
const submitButton = form.querySelector("button[type='submit']");

initEventSource();
loadConfig();
updateCountryVisibility();

form.addEventListener("submit", handleSubmit);
modeRadios.forEach((radio) => radio.addEventListener("change", updateCountryVisibility));
selectAllBtn.addEventListener("click", () => selectAllCountries(true));
clearAllBtn.addEventListener("click", () => selectAllCountries(false));

function initEventSource() {
  if (eventSource) {
    eventSource.close();
  }
  eventSource = new EventSource("/events");
  eventSource.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    handleEvent(payload);
  });
  eventSource.addEventListener("error", () => {
    if (!eventStreamInterrupted) {
      eventStreamInterrupted = true;
      appendLog("事件流连接中断，正在尝试重新连接...");
    }
  });
  eventSource.addEventListener("open", () => {
    const wasInterrupted = eventStreamInterrupted;
    if (wasInterrupted) {
      appendLog("事件流连接已恢复。");
    }
    eventStreamInterrupted = false;
    syncStatusWithServer(wasInterrupted);
  });
}

function handleEvent(event) {
  const { type, message, value, filePath, timestamp, countries } = event;

  if (type === "progress") {
    const percent = Math.round((value ?? 0) * 100);
    progressBar.style.width = `${percent}%`;
    progressBar.setAttribute("aria-valuenow", String(percent));
    progressText.textContent = `任务进度：${percent}%`;
    return;
  }

  if (type === "done") {
    isRunning = false;
    submitButton.disabled = false;
    progressBar.style.width = "100%";
    progressBar.setAttribute("aria-valuenow", "100");
    const countrySuffix = Array.isArray(countries) && countries.length ? `（国家：${countries.join(", ")}）` : "";
    progressText.textContent = `任务完成，文件已输出：${filePath}${countrySuffix}`;
  }

  if (type === "error") {
    isRunning = false;
    submitButton.disabled = false;
    progressBar.style.width = "0%";
    progressBar.setAttribute("aria-valuenow", "0");
    progressText.textContent = message || "任务失败";
  }

  if (message) {
    appendLog(message, timestamp);
  }
}

async function syncStatusWithServer(wasInterrupted = false) {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("无法获取任务状态");
    }

    const data = await response.json();
    const wasRunning = isRunning;

    if (data.running) {
      isRunning = true;
      submitButton.disabled = true;
      const statusMessage = data.jobId
        ? `任务正在执行（ID: ${data.jobId}），请稍候...`
        : "任务正在执行，请稍候...";
      progressText.textContent = statusMessage;
      if (!wasRunning || wasInterrupted) {
        appendLog(
          data.jobId
            ? `已恢复与正在执行任务（ID: ${data.jobId}）的连接。`
            : "已恢复与正在执行任务的连接。"
        );
      }
    } else {
      isRunning = false;
      submitButton.disabled = false;
      if (wasRunning || wasInterrupted) {
        appendLog("检测到服务器已无运行中的任务，界面已重置。");
        progressBar.style.width = "0%";
        progressBar.setAttribute("aria-valuenow", "0");
        progressText.textContent = "当前没有正在执行的任务。";
      }
    }
  } catch (error) {
    appendLog(`同步任务状态失败：${error.message}`);
  }
}

function appendLog(message, timestamp) {
  const clone = template.content.cloneNode(true);
  const timeEl = clone.querySelector("time");
  const msgEl = clone.querySelector("p");
  timeEl.textContent = new Date(timestamp || Date.now()).toLocaleString();
  msgEl.textContent = message;
  logContainer.prepend(clone);

  while (logContainer.children.length > MAX_LOG_ITEMS) {
    logContainer.removeChild(logContainer.lastElementChild);
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error("服务器未返回国家配置");
    }
    const data = await response.json();
    supportedCountries = (data.countries || []).filter((code) => code !== "ALL");
    defaultCountries = data.defaultMultiCountries || supportedCountries;
    renderCountryList(defaultCountries);
  } catch (error) {
    appendLog(`加载国家配置失败：${error.message}`);
  }
}

function renderCountryList(preselected = []) {
  countryList.innerHTML = "";
  supportedCountries.forEach((code) => {
    const label = document.createElement("label");
    label.className = "checkbox";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "countries";
    input.value = code;
    input.checked = preselected.length === 0 || preselected.includes(code);

    const span = document.createElement("span");
    span.textContent = code;

    label.appendChild(input);
    label.appendChild(span);
    countryList.appendChild(label);
  });
}

function updateCountryVisibility() {
  const mode = form.querySelector('input[name="mode"]:checked').value;
  const isMulti = mode === "multi";
  countryField.classList.toggle("hidden", !isMulti);

  if (isMulti && countryList.children.length === 0) {
    renderCountryList(defaultCountries);
  }
}

function selectAllCountries(checked) {
  countryList.querySelectorAll('input[name="countries"]').forEach((input) => {
    input.checked = checked;
  });
}

function getSelectedCountries() {
  return Array.from(countryList.querySelectorAll('input[name="countries"]:checked')).map(
    (input) => input.value
  );
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isRunning) {
    return;
  }

  const hasFile = fileInput.files && fileInput.files.length > 0;
  const manualKeywords = (keywordText.value || "").trim();
  const mode = form.querySelector('input[name="mode"]:checked').value;

  if (!hasFile && !manualKeywords) {
    alert("请上传关键词文件或直接填写关键词");
    return;
  }

  let selectedCountries = [];
  if (mode === "multi") {
    selectedCountries = getSelectedCountries();
    if (!selectedCountries.length) {
      alert("请至少选择一个国家进行统计");
      return;
    }
  }

  const formData = new FormData(form);
  if (!hasFile) {
    formData.delete("keywords");
  }
  formData.set("keywordText", manualKeywords);

  formData.delete("countries");
  if (mode === "multi") {
    selectedCountries.forEach((country) => {
      formData.append("countries", country);
    });
  }

  try {
    isRunning = true;
    submitButton.disabled = true;
    progressBar.style.width = "0%";
    progressBar.setAttribute("aria-valuenow", "0");
    progressText.textContent = "任务已提交，等待服务器启动 Puppeteer...";
    appendLog("任务已提交，等待执行");

    const response = await fetch("/api/run", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "提交失败" }));
      throw new Error(payload.error || "提交失败");
    }

    const { jobId } = await response.json();
    appendLog(`任务已开始：${jobId}`);
  } catch (error) {
    isRunning = false;
    submitButton.disabled = false;
    progressText.textContent = error.message || "提交失败";
    appendLog(`错误：${error.message}`);
  }
}
