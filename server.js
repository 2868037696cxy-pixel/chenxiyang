import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import { EventEmitter } from "events";
import { parse as parseCsv } from "csv-parse";
import puppeteer from "puppeteer";
import ExcelJS from "exceljs";
import morgan from "morgan";

const app = express();
const PORT = process.env.PORT || 3000;

const countries = ["ALL", "PL", "RO", "IT", "GR", "HR", "BG", "HU", "CZ", "SK"];
const outputDir = path.join(os.homedir(), "Desktop", "已完成数据提取");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const jobEmitter = new EventEmitter();
let activeJob = null;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(express.static(path.join(process.cwd(), "public")));

function emitEvent(event) {
  jobEmitter.emit("event", {
    timestamp: new Date().toISOString(),
    ...event,
  });
}

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const listener = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  jobEmitter.on("event", listener);

  req.on("close", () => {
    jobEmitter.removeListener("event", listener);
  });
});

app.post("/api/run", upload.single("keywords"), async (req, res) => {
  if (activeJob) {
    return res.status(409).json({ error: "已有抓取任务正在执行，请稍后再试。" });
  }

  const mode = req.body.mode;
  if (!mode || !["global", "multi"].includes(mode)) {
    return res.status(400).json({ error: "请选择有效的抓取模式。" });
  }

  const keywords = await readKeywords(req.file);
  if (!keywords.length) {
    return res.status(400).json({ error: "请上传包含关键词的文件。" });
  }

  activeJob = { id: Date.now().toString() };
  emitEvent({ type: "status", message: "任务开始执行", jobId: activeJob.id });

  runScrape({ mode, keywords }).catch((error) => {
    console.error(error);
    emitEvent({ type: "error", message: error.message || "抓取任务失败" });
  }).finally(() => {
    activeJob = null;
  });

  return res.json({ jobId: activeJob.id });
});

async function readKeywords(file) {
  if (!file) {
    return [];
  }

  const content = file.buffer.toString("utf8");
  if (!content.trim()) {
    return [];
  }

  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === ".csv") {
    const records = await parseCsvContent(content);
    return [...new Set(records.flat().filter(Boolean))];
  }

  return [...new Set(content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

async function ensureOutputDir() {
  await fs.promises.mkdir(outputDir, { recursive: true });
}

function parseCsvContent(content) {
  return new Promise((resolve, reject) => {
    parseCsv(
      content,
      {
        relax_column_count: true,
        trim: true,
        skip_empty_lines: true,
      },
      (error, records) => {
        if (error) {
          reject(error);
        } else {
          resolve(records);
        }
      }
    );
  });
}

async function runScrape({ mode, keywords }) {
  await ensureOutputDir();
  emitEvent({ type: "log", message: `关键词共 ${keywords.length} 个` });

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(60000);

    await loginIfNeeded(page);

    const results = [];
    let processed = 0;

    if (mode === "global") {
      for (const keyword of keywords) {
        emitEvent({ type: "log", message: `抓取全域数据：${keyword}` });
        const count = await fetchAdsCount(page, keyword, "ALL");
        results.push({ keyword, count });
        processed += 1;
        emitEvent({ type: "progress", value: processed / keywords.length });
      }
      const filePath = await exportGlobal(results);
      emitEvent({
        type: "done",
        mode,
        filePath,
        message: `全域统计完成，文件已保存：${filePath}`,
      });
    } else {
      const selectedCountries = countries.filter((c) => c !== "ALL");
      const totalSteps = keywords.length * selectedCountries.length;

      for (const keyword of keywords) {
        for (const country of selectedCountries) {
          emitEvent({ type: "log", message: `抓取 ${country} 数据：${keyword}` });
          const count = await fetchAdsCount(page, keyword, country);
          results.push({ keyword, country, count });
          processed += 1;
          emitEvent({ type: "progress", value: processed / totalSteps });
        }
      }
      const filePath = await exportMultiCountry(results);
      emitEvent({
        type: "done",
        mode,
        filePath,
        message: `多国统计完成，文件已保存：${filePath}`,
      });
    }
  } catch (error) {
    emitEvent({ type: "error", message: error.message || "抓取失败" });
    throw error;
  } finally {
    await browser.close();
  }
}

async function loginIfNeeded(page) {
  emitEvent({ type: "log", message: "正在打开 Facebook Ads Library" });
  await page.goto("https://www.facebook.com/ads/library/", { waitUntil: "networkidle2" });

  const needsLogin = await page.$('input[name="email"]');
  if (!needsLogin) {
    emitEvent({ type: "log", message: "检测到已有登录会话" });
    return;
  }

  const email = process.env.FB_EMAIL;
  const password = process.env.FB_PASSWORD;
  if (!email || !password) {
    emitEvent({ type: "log", message: "未提供 Facebook 登录凭证，尝试手动登录" });
    await page.waitForTimeout(5000);
    return;
  }

  emitEvent({ type: "log", message: "正在自动登录 Facebook" });
  await page.type('input[name="email"]', email, { delay: 40 });
  await page.type('input[name="pass"]', password, { delay: 40 });
  await Promise.all([
    page.click('button[name="login"]'),
    page.waitForNavigation({ waitUntil: "networkidle2" }),
  ]);
  emitEvent({ type: "log", message: "登录成功" });
}

async function fetchAdsCount(page, keyword, country) {
  const url = new URL("https://www.facebook.com/ads/library/api/");
  url.searchParams.set("search_type", "keyword_exact_phrase");
  url.searchParams.set("media_type", "all");
  url.searchParams.set("country", country);
  url.searchParams.set("query", keyword);
  url.searchParams.set("limit", "1");
  url.searchParams.set("offset", "0");

  try {
    const data = await page.evaluate(async (apiUrl) => {
      const response = await fetch(apiUrl, {
        headers: {
          "accept": "application/json, text/plain, */*",
        },
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }
      return response.json();
    }, url.toString());

    const count = data?.data?.total_count ?? 0;
    emitEvent({ type: "log", message: `获取到 ${keyword} (${country}) 广告数量：${count}` });
    return count;
  } catch (error) {
    emitEvent({ type: "log", message: `获取 ${keyword} (${country}) 数据失败：${error.message}` });
    return 0;
  }
}

async function exportGlobal(records) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("正在投放");
  worksheet.columns = [
    { header: "关键词", key: "keyword", width: 40 },
    { header: "广告数量（正在投放）", key: "count", width: 25 },
  ];
  records.forEach((row) => worksheet.addRow(row));

  const filePath = path.join(outputDir, "正在投放广告数量.xlsx");
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

async function exportMultiCountry(records) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("多国统计");
  worksheet.columns = [
    { header: "国家", key: "country", width: 12 },
    { header: "关键词", key: "keyword", width: 40 },
    { header: "广告数量", key: "count", width: 15 },
  ];
  records.forEach((row) => worksheet.addRow(row));

  const filePath = path.join(outputDir, "多国广告数量统计.xlsx");
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

app.get("/api/config", (req, res) => {
  res.json({ countries });
});

app.use((req, res) => {
  res.status(404).json({ error: "未找到请求的资源" });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
