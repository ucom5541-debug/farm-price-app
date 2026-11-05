import http from "http";
import fs from "fs";
import { Agent, fetch as undiciFetch } from "undici";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

const srimuangAgent = new Agent({
  connect: {
    ca: [
      ...tls.rootCertificates,
      fs.readFileSync(
        new URL("../RapidSSLTLSRSACAG1.crt.pem", import.meta.url),
        "utf8"
      ),
    ],
  },
});


const PORT = Number(process.env.PORT || 3001);
// Always use the history file next to this server.js, regardless of cwd.
const HISTORY_FILE = new URL("./price-history.json", import.meta.url);
let priceHistory = [];

// Do not quietly overwrite history if the JSON file is absent or damaged.
if (!fs.existsSync(HISTORY_FILE)) {
  throw new Error("ไม่พบ server/price-history.json กรุณากู้คืนจากไฟล์สำรองก่อน");
}
try {
  priceHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  if (!Array.isArray(priceHistory)) {
    throw new Error("รูปแบบข้อมูลประวัติราคาต้องเป็น Array");
  }
  console.log("โหลดประวัติราคา:", priceHistory.length, "รายการ");
} catch (error) {
  console.error("ไม่สามารถอ่านประวัติราคาได้ หยุดเพื่อป้องกันข้อมูลสูญหาย:", error);
  throw error;
}

function bangkokDate(timestamp = Date.now()) {
  if (timestamp === null || typeof timestamp === "boolean") return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function readPriceHistory() {
  const records = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  if (!Array.isArray(records) || records.some((record) => !record || typeof record !== "object" ||
      typeof record.crop !== "string" || typeof record.timestamp !== "string" ||
      !Number.isFinite(Date.parse(record.timestamp)) ||
      ![undefined, 1, 2, 3].includes(record.schemaVersion) ||
      (record.schemaVersion === 3 && (!Array.isArray(record.markets) ||
        record.date !== bangkokDate(record.timestamp))))) {
    throw new Error("รูปแบบประวัติไม่ถูกต้อง หยุดเพื่อป้องกันข้อมูลสูญหาย");
  }
  return records;
}

function historyMarketKey(market) {
  return typeof market?.market === "string" && market.market.trim() ? market.market : null;
}

function historyMarketCompatible(market, cropKey, existing = []) {
  const crop = CROPS[cropKey];
  if (!crop || market.unit !== "บาท/กก.") return false;
  if (market.market === "ตลาดสี่มุมเมือง") {
    if (market.productId !== crop.simummuangProductId || market.productName !== crop.simummuangProductName ||
        market.selectedSize !== crop.simummuangSize || !isSimumuangKg(market.sourceUnit)) return false;
  } else if (market.market === "ตลาดศรีเมือง ราชบุรี") {
    // Missing identity remains unknown; a known different product is rejected.
    if (market.productName && ![crop.name, crop.srimuangKeyword].includes(market.productName)) return false;
  } else return false;
  return !existing.some((saved) => saved.unit !== market.unit ||
    (saved.selectedSize && market.selectedSize && saved.selectedSize !== market.selectedSize));
}

function persistedMarket(market) {
  return {
    market: market.market, productId: market.productId ?? null,
    productName: market.productName ?? null, selectedSize: market.selectedSize ?? null,
    unit: market.unit, sourceUnit: market.sourceUnit ?? null,
    min: market.min, max: market.max, mid: market.mid,
    sourceUpdatedAt: market.sourceUpdatedAt ?? null,
    action_date: market.action_date ?? null, fetchedAt: market.fetchedAt ?? null,
    quality: market.quality, freshness: market.freshness, status: market.status,
    source: market.source ?? null,
  };
}

function validatedHistoricalMarket(market, record) {
  if (market?.quality?.status !== "valid" ||
      !["current", "unknown_timestamp"].includes(market.freshness?.status)) return null;
  // Evaluate historical eligibility at the observation time, never at today's time.
  const checked = validateMarketPrice({ ...market, available: true,
    validated: true, dataCompleteness: { complete: true } }, Date.parse(record.timestamp), { ...(record.pricePolicy ?? {
      currentMaxAgeMs: 24 * 3600000, staleMaxAgeMs: 48 * 3600000, futureToleranceMs: 0 }),
      allowUnknownTimestamp: true });
  return checked.available && checked.historyEligible ? { ...checked,
    freshness: { ...checked.freshness, evaluatedAt: record.timestamp, scope: "at_observation" } } : null;
}

function buildDailyHistory(records, cropKey = null) {
  const groups = new Map();
  records.forEach((record, index) => {
    if (cropKey && record.crop !== cropKey) return;
    const date = bangkokDate(record.timestamp);
    if (!date) return;
    const key = `${record.crop}:${date}`;
    if (!groups.has(key)) groups.set(key, { date, records: [] });
    groups.get(key).records.push({ record, index });
  });
  const result = [];
  for (const group of groups.values()) {
    const legacy = group.records.filter(({ record }) => !Array.isArray(record.markets));
    if (legacy.length) {
      // Unknown source provenance cannot safely be combined with market events.
      const usableLegacy = legacy.filter(({ record }) => Number.isFinite(Number(record.averagePrice)) && Number(record.averagePrice) > 0);
      if (!usableLegacy.length) continue;
      const preferred = [...usableLegacy].sort((a, b) =>
        Number(Number(b.record.minPrice) > 0) - Number(Number(a.record.minPrice) > 0) ||
        Number(Number(b.record.sourceCount) >= 2) - Number(Number(a.record.sourceCount) >= 2) ||
        Date.parse(b.record.timestamp) - Date.parse(a.record.timestamp))[0].record;
      result.push(preferred);
      continue;
    }
    const occupied = new Set();
    const markets = [];
    for (const { record } of group.records) {
      for (const market of record.markets) {
        const key = historyMarketKey(market);
        if (!key || occupied.has(key)) continue;
        // First observation wins even if invalid; never substitute a later price.
        occupied.add(key);
        const checked = validatedHistoricalMarket(market, record);
        if (checked && !markets.some((saved) => saved.unit !== checked.unit ||
            (saved.selectedSize && checked.selectedSize && saved.selectedSize !== checked.selectedSize))) {
          markets.push(checked);
        }
      }
    }
    if (!markets.length) continue;
    const first = group.records[0].record;
    const last = group.records[group.records.length - 1].record;
    result.push({ schemaVersion: 3, dailyView: true, freshnessScope: "at_observation", crop: first.crop, name: first.name,
      date: group.date, timestamp: last.timestamp, firstObservedAt: first.timestamp,
      averagePrice: average(markets.map((market) => market.mid)),
      medianPrice: median(markets.map((market) => market.mid)),
      minPrice: Math.min(...markets.map((market) => market.min)),
      maxPrice: Math.max(...markets.map((market) => market.max)),
      sourceCount: markets.length, unit: "บาท/กก.",
      priceStatus: !markets.every((market) => market.verifiedCurrent) ? "unverified_freshness" :
        markets.every((market) => market.productId && market.productName && market.selectedSize) ? "current" : "unverified_metadata",
      metadataStatus: markets.every((market) => market.productId && market.productName && market.selectedSize) ? "complete" : "incomplete_source_identity",
      markets: markets.map(persistedMarket), recordCount: group.records.length,
      recordIndexes: group.records.map(({ index }) => index) });
  }
  return result.sort((a, b) => bangkokDate(a.timestamp).localeCompare(bangkokDate(b.timestamp)) ||
    a.crop.localeCompare(b.crop));
}

function atomicWriteHistory(records) {
  const text = JSON.stringify(records, null, 2);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length !== records.length) throw new Error("ประวัติ JSON ไม่สมบูรณ์");
  const temporary = new URL(`./.price-history.${process.pid}.${randomUUID()}.tmp`, HISTORY_FILE);
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    const verified = JSON.parse(fs.readFileSync(temporary, "utf8"));
    if (JSON.stringify(verified) !== JSON.stringify(parsed)) throw new Error("ตรวจสอบไฟล์ชั่วคราวไม่ผ่าน");
    fs.renameSync(temporary, HISTORY_FILE);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function savePriceHistory(cropKey, data) {
  if (!data || data.historyEligible === false || !Array.isArray(data.markets)) return false;
  const now = Date.now();
  const valid = data.markets.map((market) => validateMarketPrice(market, now))
    .filter((market) => market.available && market.historyEligible);
  if (!valid.length || !Number.isFinite(data.averagePrice) ||
      Math.abs(data.averagePrice - average(valid.map((market) => market.mid))) > 1e-9) return false;
  const lock = new URL("./.price-history.json.lock", HISTORY_FILE);
  let lockFd;
  try {
    // Cooperative local writers only: fail rather than remove another writer's lock.
    try { lockFd = fs.openSync(lock, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") throw new Error("history_busy: มีผู้เขียนประวัติอยู่แล้ว ห้ามลบ lock อัตโนมัติ");
      throw error;
    }
    // Reload inside the lock so another process's completed append cannot be lost.
    const diskHistory = readPriceHistory();
    const today = bangkokDate(now);
    const daily = diskHistory.filter((record) => record.crop === cropKey && bangkokDate(record.timestamp) === today);
    if (daily.some((record) => !Array.isArray(record.markets))) {
      console.warn(`legacy_history_requires_review: ${cropKey} ${today}`);
      priceHistory = diskHistory;
      return false;
    }
    const occupied = new Set(daily.flatMap((record) => record.markets).map(historyMarketKey));
    const existing = daily.flatMap((record) => record.markets
      .map((market) => validatedHistoricalMarket(market, record)).filter(Boolean));
    const additions = [];
    for (const market of valid) {
      const key = historyMarketKey(market);
      if (!key || occupied.has(key) || !historyMarketCompatible(market, cropKey, [...existing, ...additions])) continue;
      occupied.add(key);
      additions.push(market);
    }
    if (!additions.length) { priceHistory = diskHistory; return false; }
    const event = { schemaVersion: 3, recordType: "market_append", eventId: randomUUID(),
      crop: cropKey, name: data.name, date: today, timestamp: new Date(now).toISOString(),
      pricePolicy: { ...PRICE_POLICY }, markets: additions.map(persistedMarket) };
    const nextHistory = [...diskHistory, event];
    atomicWriteHistory(nextHistory);
    priceHistory = nextHistory;
    return true;
  } finally {
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      fs.unlinkSync(lock);
    }
  }
}
// ==========================================
// พืชที่เราติดตาม
// ==========================================

const CROPS = {
  shallot: {
    name: "หอมแบ่ง",
    simummuangProductId: "698aaceeee6cbda61dfbd207",
    simummuangProductName: "ต้นหอม",
    simummuangSize: "large",
    srimuangKeyword: "ต้นหอม",
    talaadthaiKeyword: "ต้นหอม",
    talaadthaiUrl:
      "https://talaadthai.com/products/spring-onion-9707-2366",
    simummuangKeywords: ["หอมแบ่ง", "ต้นหอม"],
  },

  kale: {
    name: "คะน้า",
    simummuangProductId: "698aacecee6cbda61dfbd1c3",
    simummuangProductName: "ต้นคะน้า",
    simummuangSize: "large",
    srimuangKeyword: "คะน้าต้น",
    talaadthaiKeyword: "คะน้าต้น",
    talaadthaiUrl:
      "https://talaadthai.com/products/chinese-kale-9714-2382",
    simummuangKeywords: ["คะน้า"],
  },

  pakchoi: {
    name: "กวางตุ้ง",
    simummuangProductId: "698aacedee6cbda61dfbd1e5",
    simummuangProductName: "กวางตุ้งใบ",
    simummuangSize: "large",
    srimuangKeyword: "ผักกวางตุ้งธรรมดา",
    talaadthaiKeyword: "กวางตุ้งดอก",
    talaadthaiUrl:
      "https://talaadthai.com/products/bok-choy-9730-2488",
    simummuangKeywords: ["กวางตุ้ง"],
  },

  chili: {
    name: "พริก",
    simummuangProductId: "698aacebee6cbda61dfbd16f",
    simummuangProductName: "พริกจินดาแดง",
    simummuangSize: "large",
    srimuangKeyword: "พริกจินดาแดง",
    talaadthaiKeyword: "พริกขี้หนูแดง",
    talaadthaiUrl:
      "https://talaadthai.com/products/bird-s-eye-chili-9661-2369",
    simummuangKeywords: [
      "พริกจินดาแดง",
      "พริกขี้หนูแดง",
      "พริก",
    ],
  },

    coriander: {
    name: "ผักชี",
    simummuangProductId: "698aaceeee6cbda61dfbd20e",
    simummuangProductName: "ผักชีไทย",
    simummuangSize: "large",
    srimuangKeyword: "ผักชี",
    talaadthaiKeyword: "ผักชีไทย",
    talaadthaiUrl:
      "https://talaadthai.com/products/coriander-9675-2364",
    simummuangKeywords: ["ผักชี", "ผักชีไทย"],
  },
    cucumber: {
    name: "แตงกวา",
    simummuangProductId: "6989c1bd2f44a006e423550e",
    simummuangProductName: "แตงกวา",
    simummuangSize: "large",
    srimuangKeyword: "แตงกวา",
    talaadthaiKeyword: "แตงกวาอ่อน",
    talaadthaiUrl:
      "https://talaadthai.com/products/cucumber-9704-2424",
    simummuangKeywords: ["แตงกวา", "แตงกวาอ่อน", "แตงกวาไทย"],
  },

  longbean: {
    name: "ถั่วฝักยาว",
    simummuangProductId: "6989c1be2f44a006e423552f",
    simummuangProductName: "ถั่วฝักยาว เนื้อ",
    simummuangSize: "large",
    srimuangKeyword: "ถั่วฝักยาว",
    talaadthaiKeyword: "ถั่วฝักยาว",
    talaadthaiUrl:
      "https://talaadthai.com/products/long-beans-9699-2363",
    simummuangKeywords: ["ถั่วฝักยาว"],
  },

  celery: {
    name: "ขึ้นฉ่าย",
    simummuangProductId: "698aaceeee6cbda61dfbd22a",
    simummuangProductName: "ขึ้นฉ่าย/ตั้งโอ๋ ดิน",
    simummuangSize: "large",
    srimuangKeyword: "ขึ้นฉ่าย",
    talaadthaiKeyword: "คึ่นช่าย",
    talaadthaiUrl:
      "https://talaadthai.com/products/chinese-celery-9712-2367",
    simummuangKeywords: [
      "ขึ้นฉ่าย",
      "คึ่นช่าย",
      "คื่นฉ่าย",
      "ตั้งโอ๋ไทย",
    ],
  },

  morningglory: {
    name: "ผักบุ้งจีน",
    simummuangProductId: "698aacf1ee6cbda61dfbd2b8",
    simummuangProductName: "ผักบุ้งจีน",
    simummuangSize: "large",
    srimuangKeyword: "ผักบุ้งจีน",
    talaadthaiKeyword: "ผักบุ้งจีน",
    talaadthaiUrl:
      "https://talaadthai.com/products/morning-glory-9672-2373",
    simummuangKeywords: ["ผักบุ้งจีน", "ผักบุ้ง"],
  },

  cabbage: {
    name: "กะหล่ำปลี",
    simummuangProductId: "698aacefee6cbda61dfbd246",
    simummuangProductName: "กะหล่ำปลีเขียว",
    simummuangSize: "large",
    srimuangKeyword: "กะหล่ำปลี",
    talaadthaiKeyword: "กะหล่ำปลี",
    talaadthaiUrl:
      "https://talaadthai.com/products/cabbage-9725-2495",
    simummuangKeywords: ["กะหล่ำปลี"],
  },

};

// ==========================================
// URL ตลาด
// ==========================================

const SRIMUANG_URL =
  "https://www.taladsrimuang.com/site/product/report_all.php?id=1";

const SIMUMUANG_API =
  "https://api.simummuangmarket.com/api/app/products?page=1&limit=20&isShow=true&sortBy=sort_th&sortOrder=asc";

// ==========================================
// Utility
// ==========================================

function round2(number) {
  return Math.round(number * 100) / 100;
}

function midpoint(min, max) {
  return round2((Number(min) + Number(max)) / 2);
}

function average(numbers) {
  if (!numbers.length) return null;

  return round2(
    numbers.reduce((sum, value) => sum + value, 0) /
      numbers.length
  );
}

function median(numbers) {
  if (!numbers.length) return null;

  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return round2(
      (sorted[middle - 1] + sorted[middle]) / 2
    );
  }

  return sorted[middle];
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#039;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {

  const response = await (new URL(url).hostname === "www.taladsrimuang.com" ? undiciFetch : fetch)(url, {
    dispatcher: new URL(url).hostname === "www.taladsrimuang.com"
  ? srimuangAgent
  : undefined,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/json",
      "User-Agent":
        "Mozilla/5.0 Farm-Dashboard/1.0",
    },

    redirect: "follow",

    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(
      `${url} ตอบกลับ ${response.status}`
    );
  }

  return response.text();
}

// ==========================================
// ตลาดศรีเมือง ราชบุรี
// ==========================================

function extractSrimuangPrice(text, keyword) {
  const index = text.indexOf(keyword);

  if (index === -1) {
    return null;
  }

  // อ่านเฉพาะข้อความหลังชื่อสินค้า
  const snippet = text.slice(index, index + 120);

  // ราคาแบบ 50.00 -60.00
  const rangeMatch = snippet.match(
    /(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/
  );

  if (rangeMatch) {
    return {
      min: Number(rangeMatch[1]),
      max: Number(rangeMatch[2]),
    };
  }

  // ราคาตัวเดียว
  const singleMatch = snippet.match(
    /(\d+(?:\.\d+)?)/
  );

  if (singleMatch) {
    const price = Number(singleMatch[1]);

    return {
      min: price,
      max: price,
    };
  }

  return null;
}
console.log("SRIMUANG URL:", SRIMUANG_URL);

async function getSrimuangPrice(crop) {
  try {
    const html = await fetchText(SRIMUANG_URL);
    const text = cleanHtml(html);

    const price = extractSrimuangPrice(
      text,
      crop.srimuangKeyword
    );

    if (!price) {
      return {
        market: "ตลาดศรีเมือง ราชบุรี",
        available: false,
        reason: "ไม่พบสินค้า",
      };
    }

    return {
      market: "ตลาดศรีเมือง ราชบุรี",
      available: true,
      min: price.min,
      max: price.max,
      mid: midpoint(price.min, price.max),
      unit: "บาท/กก.",
      source: SRIMUANG_URL,
    };
  } catch (error) {
console.error("SRIMUANG ERROR:", error.message);
console.error("SRIMUANG CAUSE:", error.cause);

    return {
      market: "ตลาดศรีเมือง ราชบุรี",
      available: false,
      status: "load_failed",
      reason: "ตลาดโหลดข้อมูลไม่สำเร็จ: " + error.message,
    };
  }
}

// ==========================================
// ตลาดไท
// ==========================================



// ==========================================
// ตลาดสี่มุมเมือง
// ถ้าดึงได้ก็เอามารวม
// ถ้าดึงไม่ได้ ระบบยังทำงานต่อ
// ==========================================

// Verified identity candidates from the read-only API audit on 2026-11-04.
// Confirmed primaries and large size are configured in CROPS. Other entries remain
// identity-checked alternatives for a future explicit product selector, never fallbacks.
const SIMUMUANG_PRODUCTS = {
  "หอมแบ่ง": [
    {
      "id": "698aaceeee6cbda61dfbd207",
      "name": "ต้นหอม"
    }
  ],
  "คะน้า": [
    {
      "id": "698aacecee6cbda61dfbd1c3",
      "name": "ต้นคะน้า"
    },
    {
      "id": "698aacecee6cbda61dfbd1ca",
      "name": "ยอดคะน้า"
    },
    {
      "id": "698aacedee6cbda61dfbd1d1",
      "name": "คะน้าต้นอ้วน/คะน้าเห็ดหอม"
    },
    {
      "id": "698ad7eb3d0ee904ee3d45cc",
      "name": "คะน้าฮ่องกง"
    }
  ],
  "กวางตุ้ง": [
    {
      "id": "698aacedee6cbda61dfbd1e5",
      "name": "กวางตุ้งใบ"
    },
    {
      "id": "698aacedee6cbda61dfbd1d7",
      "name": "กวางตุ้งดอก"
    },
    {
      "id": "698ad7f33d0ee904ee3d46d8",
      "name": "กวางตุ้งจีน"
    },
    {
      "id": "698aacedee6cbda61dfbd1de",
      "name": "กวางตุ้งไต้หวัน"
    }
  ],
  "พริก": [
    {
      "id": "698aacebee6cbda61dfbd16f",
      "name": "พริกจินดาแดง"
    },
    {
      "id": "698aacebee6cbda61dfbd168",
      "name": "พริกจินดาเขียว"
    },
    {
      "id": "698aaceaee6cbda61dfbd161",
      "name": "พริกขี้หนูสวนม้ง(เชียงใหม่)"
    },
    {
      "id": "698aacecee6cbda61dfbd1a2",
      "name": "พริกสวนหอม"
    }
  ],
  "ผักชี": [
    {
      "id": "698aaceeee6cbda61dfbd20e",
      "name": "ผักชีไทย"
    }
  ],
  "ขึ้นฉ่าย": [
    {
      "id": "698aaceeee6cbda61dfbd22a",
      "name": "ขึ้นฉ่าย/ตั้งโอ๋ ดิน"
    },
    {
      "id": "698aacefee6cbda61dfbd231",
      "name": "ขึ้นฉ่าย/ตั้งโอ๋ ล้าง"
    },
    {
      "id": "698ad7f33d0ee904ee3d46c5",
      "name": "ขึ้นฉ่าย /ตั้งโอ๋ จีน"
    }
  ],
  "ผักบุ้งจีน": [
    {
      "id": "698aacf1ee6cbda61dfbd2b8",
      "name": "ผักบุ้งจีน"
    }
  ],
  "แตงกวา": [
    {
      "id": "6989c1bd2f44a006e423550e",
      "name": "แตงกวา"
    }
  ],
  "ถั่วฝักยาว": [
    {
      "id": "6989c1be2f44a006e423552f",
      "name": "ถั่วฝักยาว เนื้อ"
    },
    {
      "id": "6989c1be2f44a006e4235536",
      "name": "ถั่วฝักยาว เกษตร"
    }
  ],
  "กะหล่ำปลี": [
    {
      "id": "698aacefee6cbda61dfbd246",
      "name": "กะหล่ำปลีเขียว"
    },
    {
      "id": "698aacefee6cbda61dfbd23f",
      "name": "กะหล่ำปลี ขาว"
    },
    {
      "id": "698ad7eb3d0ee904ee3d45c0",
      "name": "กะหล่ำปลีหัวใจ"
    },
    {
      "id": "698ad7eb3d0ee904ee3d45b9",
      "name": "กะหล่ำปลี ม่วง"
    },
    {
      "id": "698ad7ea3d0ee904ee3d45a6",
      "name": "กะหล่ำปลี จีน"
    }
  ]
};

function getSimumuangName(item) {
  return (
    item?.th?.name ||
    item?.name ||
    ""
  );
}

function inspectSimumuangPrices(item) {
  const parse = (value) => {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  return ["small", "medium", "large"].map((size) => {
    const group = item?.price?.[size];
    const raw = group ?? null;
    const min = parse(group?.min);
    const max = parse(group?.max);
    let status;
    if (group == null || (min === 0 && max === 0)) status = "missing_price";
    else if (min === null || max === null) status = "invalid_value";
    else if (min === 0 || max === 0) status = "incomplete_range";
    else if (min > max) status = "invalid_range";
    else status = "valid";
    return { size, raw, status, min: status === "valid" ? min : null,
      max: status === "valid" ? max : null };
  });
}

function getSimumuangRange(item, size) {
  const ranges = inspectSimumuangPrices(item).filter((range) => range.status === "valid");
  // Never merge different sizes or silently choose between them.
  return (size ? ranges.find((range) => range.size === size) :
    ranges.length === 1 ? ranges[0] : null) || null;
}

function getSimumuangUnit(item) {
  const unit = item?.prod_unit_id;
  return { id: unit?._id ?? null, th: unit?.th?.name ?? null, en: unit?.en?.name ?? null };
}

function isSimumuangKg(unit) {
  // Both labels must agree; do not use a piece price as a kilogram price.
  return unit?.th === "กิโลกรัม" && unit?.en === "kg";
}

// Trial policy, configurable without changing API URLs or source timestamps.
function policyNumber(name, fallback, allowZero = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!raw.trim()) throw new Error(`Invalid price policy: ${name}`);
  const value = Number(raw);
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`Invalid price policy: ${name}`);
  }
  return value;
}
function policyBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw !== "true" && raw !== "false") throw new Error(`Invalid price policy: ${name}`);
  return raw === "true";
}
const PRICE_POLICY = Object.freeze({
  currentMaxAgeMs: policyNumber("PRICE_CURRENT_MAX_HOURS", 24) * 60 * 60 * 1000,
  staleMaxAgeMs: policyNumber("PRICE_STALE_MAX_HOURS", 48) * 60 * 60 * 1000,
  futureToleranceMs: policyNumber("PRICE_FUTURE_TOLERANCE_SECONDS", 0, true) * 1000,
  allowUnknownTimestamp: policyBoolean("PRICE_ALLOW_UNKNOWN_TIMESTAMP", true),
});
if (![PRICE_POLICY.currentMaxAgeMs, PRICE_POLICY.staleMaxAgeMs, PRICE_POLICY.futureToleranceMs].every(Number.isFinite) ||
    PRICE_POLICY.staleMaxAgeMs < PRICE_POLICY.currentMaxAgeMs) {
  throw new Error("PRICE_STALE_MAX_HOURS must not be less than PRICE_CURRENT_MAX_HOURS");
}

function inspectPriceFreshness(timestamp, now = Date.now(), policy = PRICE_POLICY) {
  // Require an explicit timezone, not a host-local or coerced timestamp.
  const match = typeof timestamp === "string" && timestamp.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
  );
  const milliseconds = match ? Date.parse(timestamp) : NaN;
  const validCalendar = match && Number(match[2]) >= 1 && Number(match[2]) <= 12 &&
    Number(match[3]) >= 1 && Number(match[3]) <= new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() &&
    Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) < 60;
  if (!validCalendar || !Number.isFinite(milliseconds) || milliseconds > now + policy.futureToleranceMs) {
    return { status: "invalid_timestamp", sourceUpdatedAt: timestamp ?? null,
      ageMs: null, timezone: "Asia/Bangkok" };
  }
  const ageMs = Math.max(0, now - milliseconds);
  const sameDay = bangkokDate(milliseconds) === bangkokDate(now);
  const status = ageMs > policy.staleMaxAgeMs ? "expired" :
    sameDay && ageMs <= policy.currentMaxAgeMs ? "current" : "stale";
  return { status, sourceUpdatedAt: timestamp, ageMs, timezone: "Asia/Bangkok" };
}

function validateMarketPrice(market, now = Date.now(), policy = PRICE_POLICY) {
  const base = { ...market, sourceUpdatedAt: market.sourceUpdatedAt ?? market.updatedAt ?? null,
    fetchedAt: market.fetchedAt ?? null };
  const reject = (status, reason) => ({ ...base, available: false, historyEligible: false,
    verifiedCurrent: false, status, reason, quality: { status, reason } });
  if (!market.available) return { ...base, historyEligible: false, verifiedCurrent: false,
    quality: market.quality ?? { status: market.status ?? "unavailable", reason: market.reason ?? "ไม่มีข้อมูลราคา" } };
  if (["invalid_range", "invalid_mid", "invalid_value", "unsupported_unit"].includes(market.status)) {
    return reject(market.status, market.reason || "ข้อมูลราคาถูกปฏิเสธจากต้นทาง");
  }
  const values = [market.min, market.max, market.mid];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) {
    return reject("invalid_value", "ข้อมูลราคาต้องเป็นตัวเลขบวกที่ถูกต้อง");
  }
  if (market.min > market.max) return reject("invalid_range", "ช่วงราคาผิดปกติ: ราคาต่ำสุดสูงกว่าราคาสูงสุด");
  if (market.mid < market.min || market.mid > market.max ||
      Math.abs(market.mid - midpoint(market.min, market.max)) > 1e-9) {
    return reject("invalid_mid", "ราคากลางไม่สอดคล้องกับช่วงราคา");
  }
  if (market.unit !== "บาท/กก.") return reject("unsupported_unit", "หน่วยสินค้าไม่ใช่บาทต่อกิโลกรัม");
  const simummuang = market.market === "ตลาดสี่มุมเมือง";
  if (market.dataCompleteness?.complete === false) return reject("incomplete_data", "ตลาดโหลดข้อมูลไม่สำเร็จหรือโหลดไม่ครบ");
  if (simummuang && (!market.validated || !market.selectedSize ||
      !isSimumuangKg(market.sourceUnit) || market.dataCompleteness?.complete !== true)) {
    return reject("unverified_price", "ข้อมูลสินค้า ขนาด หน่วย หรือความครบถ้วนยังไม่ผ่านการตรวจสอบ");
  }
  const freshness = !simummuang && base.sourceUpdatedAt === null ?
    { status: "unknown_timestamp", sourceUpdatedAt: null, ageMs: null, timezone: "Asia/Bangkok" } :
    inspectPriceFreshness(base.sourceUpdatedAt, now, policy);
  const quality = { status: "valid" };
  const reason = { stale: "ราคาเก่า ไม่ใช้คำนวณราคาปัจจุบัน", expired: "ราคาหมดอายุ ไม่ใช้คำนวณ",
    invalid_timestamp: "เวลาราคาต้นทางไม่ถูกต้องหรือไม่สามารถอ่านได้",
    unknown_timestamp: "ไม่สามารถยืนยันเวลาราคา" }[freshness.status];
  const eligible = freshness.status === "current" ||
    (freshness.status === "unknown_timestamp" && policy.allowUnknownTimestamp);
  return { ...base, quality, freshness, available: eligible, historyEligible: eligible,
    verifiedCurrent: freshness.status === "current",
    status: freshness.status === "current" ? "valid" : freshness.status,
    ...(reason ? { reason } : {}) };
}

let simuMuangItemsCache = null;
let simuMuangCacheTime = 0;
const SIMUMUANG_CACHE_MS = 5 * 60 * 1000;
let simuMuangLoadingPromise = null;

async function loadSimumuangItems() {
  const allItems = [];
  const seen = new Set();
  const pages = [];
  let expected = null;
  try {
    for (let page = 1; page <= (expected?.totalPages ?? 1); page++) {
      if (page > 1) await new Promise((resolve) => setTimeout(resolve, 500));
      const url = "https://api.simummuangmarket.com/api/app/products" +
        `?page=${page}` + "&limit=20";
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 Farm-Dashboard/1.0" },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`page ${page}: HTTP ${response.status}`);
      const { data } = await response.json();
      if (!Array.isArray(data?.data) || !Number.isSafeInteger(data.total) || data.total < 0 ||
          !Number.isSafeInteger(data.totalPages) || data.totalPages < 1 || data.totalPages > 60 ||
          data.currentPage !== page || data.perPage !== 20 ||
          data.itemCount !== data.data.length ||
          data.totalPages !== Math.max(1, Math.ceil(data.total / data.perPage))) {
        throw new Error(`page ${page}: invalid pagination/schema`);
      }
      expected ??= { total: data.total, totalPages: data.totalPages };
      if (data.total !== expected.total || data.totalPages !== expected.totalPages) {
        throw new Error(`page ${page}: pagination changed`);
      }
      const expectedCount = page < expected.totalPages ? 20 : expected.total - (page - 1) * 20;
      if (data.data.length !== expectedCount) throw new Error(`page ${page}: incomplete page`);
      for (const item of data.data) {
        if (typeof item?._id !== "string" || !item._id || seen.has(item._id)) {
          throw new Error(`page ${page}: duplicate or missing product id`);
        }
        seen.add(item._id);
        allItems.push(item);
      }
      pages.push(page);
    }
    if (allItems.length !== expected.total) throw new Error("incomplete total");
    return { items: allItems, dataCompleteness: { complete: true, ...expected,
      loadedPages: pages, loadedCount: allItems.length }, fetchedAt: new Date(Date.now()).toISOString() };
  } catch (error) {
    error.dataCompleteness = { complete: false, ...expected, loadedPages: pages,
      failedPage: pages.length + 1, loadedCount: allItems.length, reason: error.message };
    throw error;
  }
}

async function getSimumuangPrice(crop) {
  try {
    let snapshot;
    if (simuMuangItemsCache && Date.now() - simuMuangCacheTime < SIMUMUANG_CACHE_MS) {
      snapshot = simuMuangItemsCache;
    } else {
      if (!simuMuangLoadingPromise) {
        const loading = loadSimumuangItems().then((loaded) => {
          simuMuangItemsCache = loaded;
          simuMuangCacheTime = Date.now();
          return loaded;
        });
        simuMuangLoadingPromise = loading;
        // Reset once per load, including rejection; concurrent readers share it.
        loading.then(() => { if (simuMuangLoadingPromise === loading) simuMuangLoadingPromise = null; },
          () => { if (simuMuangLoadingPromise === loading) simuMuangLoadingPromise = null; });
      }
      snapshot = await simuMuangLoadingPromise;
    }
    return validateMarketPrice({ ...getSimumuangPriceFromItems(crop, snapshot.items),
      fetchedAt: snapshot.fetchedAt, dataCompleteness: snapshot.dataCompleteness });
  } catch (error) {
    return { market: "ตลาดสี่มุมเมือง", available: false, status: "incomplete_data",
      reason: "ตลาดโหลดข้อมูลไม่สำเร็จ: " + error.message,
      productId: crop.simummuangProductId ?? null, productName: crop.simummuangProductName ?? null,
      selectedSize: crop.simummuangSize ?? null, fetchedAt: new Date(Date.now()).toISOString(),
      dataCompleteness: error.dataCompleteness ?? { complete: false } };
  }
}

function getSimumuangPriceFromItems(crop, allItems) {
  const proposals = SIMUMUANG_PRODUCTS[crop.name] || [];
  const candidates = allItems.flatMap((item) => {
    const identity = proposals.find((proposal) => proposal.id === item?._id &&
      proposal.name === getSimumuangName(item));
    if (!identity) return [];
    const unit = getSimumuangUnit(item);
    const sizes = inspectSimumuangPrices(item);
    return [{ productId: identity.id, productName: identity.name, unit, sizes,
      isShow: item.isShow ?? null, isActive: item.isActive ?? null,
      updatedAt: item.price?.updatedAt ?? null, action_date: item.price?.action_date ?? null,
      productUpdatedAt: item.updatedAt ?? null,
      reasons: [...(!isSimumuangKg(unit) ? ["unsupported_unit"] : []),
        ...sizes.filter((range) => range.status !== "valid")
          .map((range) => `${range.size}:${range.status}`)] }];
  });
  const selected = candidates.find((item) => item.productId === crop.simummuangProductId);
  const configuredName = crop.simummuangProductName ??
    proposals.find((item) => item.id === crop.simummuangProductId)?.name ?? null;
  const base = { market: "ตลาดสี่มุมเมือง", available: false, candidates, proposals,
    productId: crop.simummuangProductId ?? null, productName: configuredName,
    selectedSize: crop.simummuangSize ?? null,
    sourceUpdatedAt: selected?.updatedAt ?? null, action_date: selected?.action_date ?? null,
    freshness: selected ? inspectPriceFreshness(selected.updatedAt) : null,
    isShow: selected?.isShow ?? null, sourceUnit: selected?.unit ?? null };
  const reject = (status, reason, extra = {}) => ({ ...base, status, reason, ...extra });
  const observedPrimary = allItems.find((item) => item?._id === crop.simummuangProductId);
  if (observedPrimary && getSimumuangName(observedPrimary) !== configuredName) {
    return reject("product_identity_mismatch", "ชื่อสินค้าหลักไม่ตรงกับรหัสที่ยืนยัน ต้องตรวจสอบข้อมูล");
  }
  if (new Set(candidates.map((item) => item.productId)).size !== candidates.length) {
    return reject("duplicate_product", "รหัสสินค้าซ้ำ ต้องตรวจสอบข้อมูล");
  }
  if (!selected) return reject(crop.simummuangProductId ? "selected_product_not_found" :
    candidates.length ? "selection_required" : "product_not_found",
    crop.simummuangProductId ? "ไม่พบรหัสสินค้าหลักที่ยืนยันไว้ ห้ามใช้สินค้าอื่นแทน" :
    candidates.length ? "รอยืนยันรหัสสินค้าหลัก" : "ไม่พบรหัสและชื่อสินค้าที่ตรวจสอบแล้ว");
  if (!isSimumuangKg(selected.unit)) return reject("unsupported_unit", "หน่วยสินค้าไม่ใช่กิโลกรัม");
  const validSizes = selected.sizes.filter((range) => range.status === "valid");
  const range = crop.simummuangSize ? validSizes.find((entry) => entry.size === crop.simummuangSize) :
    validSizes.length === 1 ? validSizes[0] : null;
  if (!range) {
    if (crop.simummuangSize) {
      const inspected = selected.sizes.find((entry) => entry.size === crop.simummuangSize);
      const status = inspected?.status ?? "invalid_value";
      const messages = { invalid_range: "ช่วงราคาผิดปกติ: ราคาต่ำสุดสูงกว่าราคาสูงสุด",
        incomplete_range: "ช่วงราคาไม่ครบ มีราคาศูนย์ด้านเดียว", missing_price: "ไม่มีราคา",
        invalid_value: "ข้อมูลราคาไม่ถูกต้อง" };
      return reject("selected_size_unavailable", "ขนาดที่เลือกใช้ไม่ได้: " + (messages[status] ?? "ไม่มีช่วงราคาที่ผ่านการตรวจสอบ"),
        { selectedSizeStatus: status, quality: { status, size: crop.simummuangSize } });
    }
    return reject(validSizes.length > 1 ? "size_selection_required" : "no_valid_price",
      validSizes.length ? "ต้องยืนยันขนาดสินค้า" : "ไม่มีช่วงราคาที่ผ่านการตรวจสอบ");
  }
  return { ...base, ...selected, available: true, status: "valid", validated: true,
    selectedSize: range.size, size: range.size, min: range.min, max: range.max,
    mid: midpoint(range.min, range.max), unit: "บาท/กก.", sourceUnit: selected.unit,
    source: "https://www.simummuangmarket.com/pricing" };
}
// ==========================================
// รวมหลายตลาด + ราคากลาง
// ==========================================

async function getCropMarketData(
  cropKey
) {
  const crop = CROPS[cropKey];

  if (!crop) return null;

  const collect = async (load, market) => {
    try {
      const result = await load(crop);
      return validateMarketPrice({ ...result,
        productName: result.productName ?? null,
        fetchedAt: result.fetchedAt ?? new Date(Date.now()).toISOString() });
    } catch (error) {
      return { market, available: false, historyEligible: false, status: "load_failed",
        reason: "ตลาดโหลดข้อมูลไม่สำเร็จ", fetchedAt: new Date(Date.now()).toISOString(),
        quality: { status: "load_failed" } };
    }
  };
  const markets = await Promise.all([
    collect(getSrimuangPrice, "ตลาดศรีเมือง ราชบุรี"),
    collect(getSimumuangPrice, "ตลาดสี่มุมเมือง"),
  ]);

  console.log(
  "MARKET CHECK:",
  cropKey,
  markets.map((m) => ({
    market: m.market,
    available: m.available,
    mid: m.mid,
    reason: m.reason,
  }))
);

  // เอาเฉพาะตลาดที่มีราคาจริง
  const usableMarkets =
    markets.filter(
      (market) =>
        market.available &&
        Number.isFinite(market.mid)
    );

  const midPrices =
    usableMarkets.map(
      (market) => market.mid
    );

  const lows =
    usableMarkets.map(
      (market) => market.min
    );

  const highs =
    usableMarkets.map(
      (market) => market.max
    );

    const result = {
    key: cropKey,
    name: crop.name,

    markets,

    sourceCount:
      usableMarkets.length,
    historyEligible: usableMarkets.some((market) => market.historyEligible),
    priceStatus: !usableMarkets.length ? "no_usable_price" :
      usableMarkets.every((market) => market.verifiedCurrent) ? "current" : "unverified_freshness",
    fetchedAt: new Date(Date.now()).toISOString(),

    // ราคากลางแบบค่าเฉลี่ย
    averagePrice: average(midPrices),
    // Median เก็บไว้ใช้เทียบ
    medianPrice:
      median(midPrices),

    minPrice:
      lows.length
        ? Math.min(...lows)
        : null,

    maxPrice:
      highs.length
        ? Math.max(...highs)
        : null,

    unit: "บาท/กก.",

    updatedAt:
      new Date().toISOString(),
  };
return result;
}

// ==========================================
// Server
// ==========================================

const server = http.createServer(
  async (req, res) => {
    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Content-Type",
      "application/json; charset=utf-8"
    );

    const url = new URL(
      req.url,
      `http://localhost:${PORT}`
    );

    // -----------------------
    // ทดสอบ Server
    // -----------------------

    if (url.pathname === "/") {
      res.writeHead(200);

      return res.end(
        JSON.stringify({
          status: "ok",
          message:
            "Farm Dashboard Multi-Market Server ทำงานแล้ว",
        })
      );
    }

    // -----------------------
    // ราคาพืชทุกตัว
    // -----------------------

    if (
      url.pathname === "/api/prices"
    ) {
      try {
        const cropKeys =
          Object.keys(CROPS);

        const results =
          await Promise.all(
            cropKeys.map(
              getCropMarketData
            )
          );

        res.writeHead(200);

        return res.end(
          JSON.stringify({
            status: "ok",
            data: results,
          })
        );
      } catch (error) {
        res.writeHead(500);

        return res.end(
          JSON.stringify({
            status: "error",
            message: error.message,
          })
        );
      }
    }

    // -----------------------
    // ราคาพืชเฉพาะตัว
    //
    // /api/price?crop=shallot
    // -----------------------

    if (
      url.pathname === "/api/price"
    ) {
      const cropKey =
        url.searchParams.get(
          "crop"
        );

      if (!CROPS[cropKey]) {
        res.writeHead(400);

        return res.end(
          JSON.stringify({
            status: "error",
            message:
              "ไม่พบพืชที่ต้องการ",
          })
        );
      }

      const result =
        await getCropMarketData(
          cropKey
        );

      res.writeHead(200);

      return res.end(
        JSON.stringify({
          status: "ok",
          data: result,
        })
      );
    }
// ==============================
// Price History API
// ==============================
if (url.pathname === "/api/history") {
  const cropKey = url.searchParams.get("crop");

  let history;
  try {
    const records = readPriceHistory();
    history = buildDailyHistory(records, cropKey);
    priceHistory = records;
  } catch (error) {
    res.writeHead(500);
    return res.end(JSON.stringify({ status: "error", message: "อ่านประวัติราคาไม่สำเร็จ กรุณาตรวจสอบไฟล์ต้นฉบับ" }));
  }

  res.writeHead(200);

  return res.end(
    JSON.stringify({
      status: "ok",
      count: history.length,
      data: history,
    })
  );
}
// Public GET endpoints must never trigger a history write.
if (url.pathname === "/api/save-daily-prices") {
  res.writeHead(403);
  return res.end(JSON.stringify({
    status: "error",
    message: "ปิดการสั่งบันทึกผ่าน HTTP แล้ว: ใช้ GitHub Actions หรือ --save-once",
  }));
}
// -----------------------
    // Compatibility
    // ให้ App.jsx เดิมยังเรียกได้
    // -----------------------

    if (
      url.pathname ===
      "/api/simumuang"
    ) {
      try {
        const cropKeys =
          Object.keys(CROPS);

        const results =
          await Promise.all(
            cropKeys.map(
              getCropMarketData
            )
          );

        const converted =
          results.map(
            (crop) => ({
              _id: crop.key,

              th: {
                name: crop.name,
              },

              price: {
                min:
                  crop.minPrice,
                medium:
                  crop.averagePrice,
                max:
                  crop.maxPrice,
              },

              averagePrice:
                crop.averagePrice,

              medianPrice:
                crop.medianPrice,

              markets:
                crop.markets,

              sourceCount:
                crop.sourceCount,
              priceStatus: crop.priceStatus,
              fetchedAt: crop.fetchedAt,
            })
          );

        res.writeHead(200);

        return res.end(
          JSON.stringify({
            message:
              "multi market prices",

            data: {
              data: converted,
              itemCount:
                converted.length,
            },

            statusCode: 200,
          })
        );
      } catch (error) {
        res.writeHead(500);

        return res.end(
          JSON.stringify({
            status: "error",
            message:
              error.message,
          })
        );
      }
    }

    // -----------------------
    // 404
    // -----------------------

    res.writeHead(404);

    res.end(
      JSON.stringify({
        status: "error",
        message: "ไม่พบ API",
      })
    );
  }
);

async function saveDailyPrices() {
  console.log("เริ่มบันทึกราคา (เวลาไทย):", bangkokDate());
  let saved = 0;
  let skipped = 0;
  let eligible = 0;
  let unchanged = 0;
  let failed = 0;

  for (const cropKey of Object.keys(CROPS)) {
    try {
      const data = await getCropMarketData(cropKey);
      // Save with at least one verified market; sourceCount records reliability.
      if (data && data.historyEligible !== false && data.sourceCount >= 1 && Number.isFinite(data.averagePrice)) {
        eligible += 1;
        if (savePriceHistory(cropKey, data)) {
          saved += 1;
          console.log(`บันทึก ${data.name}: ${data.averagePrice} บาท/กก. (${data.sourceCount} ตลาด)`);
        } else {
          skipped += 1;
          unchanged += 1;
          console.warn(`ข้ามข้อมูลซ้ำหรือไม่ผ่านเกณฑ์: ${cropKey}`);
        }
      } else {
        skipped += 1;
        console.warn(`ไม่มีข้อมูลราคาให้บันทึก: ${cropKey}`);
      }
    } catch (error) {
      skipped += 1;
      failed += 1;
      console.error(`บันทึก ${cropKey} ไม่สำเร็จ:`, error);
    }
  }
  console.log(`เสร็จแล้ว: บันทึก ${saved} รายการ, ข้าม ${skipped} รายการ`);
  return { saved, skipped, eligible, unchanged, failed };
}

function saveOnceExitCode(result) {
  return result.failed > 0 || (result.saved === 0 && result.eligible === 0) ? 1 : 0;
}

// GitHub Actions runs this command once per day and commits the resulting file.
// Render serves history from the repository snapshot and does NOT modify it.
if (process.argv.includes("--save-once")) {
  try {
    const result = await saveDailyPrices();
    process.exitCode = saveOnceExitCode(result);
    if (process.exitCode) console.error("ไม่มีราคาที่ผ่านเกณฑ์ หรือเขียนประวัติล้มเหลว");
    else if (result.saved === 0) console.log("ไม่มีตลาดใหม่ที่ต้องเพิ่ม: ประวัติไม่เปลี่ยน ไม่ต้อง Commit ซ้ำ");
  } catch (error) {
    console.error("บันทึกรายวันล้มเหลว:", error);
    process.exitCode = 1;
  } finally {
    await srimuangAgent.close();
  }
} else {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Farm Dashboard Server running on http://localhost:${PORT}`);
    console.log("History persistence: read-only on web server; GitHub Actions saves daily prices.");
  });
}
