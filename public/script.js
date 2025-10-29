const form = document.getElementById("scrape-form");
const logContainer = document.getElementById("log");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const template = document.getElementById("log-entry-template");

let eventSource;
let isRunning = false;

function initEventSource() {
  if (eventSource) {
    eventSource.close();
  }
  eventSource = new EventSource("/events");
  eventSource.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    handleEvent(payload);
  });
}

function handleEvent(event) {
  const { type, message, value, filePath, timestamp } = event;
  if (type === "progress") {
    const percent = Math.round((value ?? 0) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `任务进度：${percent}%`;
    return;
  }

  if (type === "done") {
    isRunning = false;
    form.querySelector("button[type='submit']").disabled = false;
    progressBar.style.width = "100%";
    progressText.textContent = `任务完成，文件已输出：${filePath}`;
  }

  if (type === "error") {
    isRunning = false;
    form.querySelector("button[type='submit']").disabled = false;
    progressText.textContent = message || "任务失败";
  }

  if (message) {
    appendLog(message, timestamp);
  }
}

function appendLog(message, timestamp) {
  const clone = template.content.cloneNode(true);
  const timeEl = clone.querySelector("time");
  const msgEl = clone.querySelector("p");
  timeEl.textContent = new Date(timestamp || Date.now()).toLocaleString();
  msgEl.textContent = message;
  logContainer.prepend(clone);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isRunning) {
    return;
  }

  const formData = new FormData(form);
  if (!formData.get("keywords")) {
    alert("请上传关键词文件");
    return;
  }

  try {
    isRunning = true;
    form.querySelector("button[type='submit']").disabled = true;
    progressBar.style.width = "0%";
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
    form.querySelector("button[type='submit']").disabled = false;
    progressText.textContent = error.message || "提交失败";
    appendLog(`错误：${error.message}`);
  }
});

initEventSource();
