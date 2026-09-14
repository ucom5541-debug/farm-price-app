import http from "http";
import fs from "fs";

const PORT = 3001;
const HISTORY_FILE = "./server/price-history.json";
let priceHistory = [];

try {
  if (fs.existsSync(HISTORY_FILE)) {
    const savedData = fs.readFileSync(HISTORY_FILE, "utf8");
    priceHistory = JSON.parse(savedData);

    console.log("โหลดประวัติราคา:", priceHistory.length, "รายการ");
  }
} catch (error) {
  console.error("โหลดประวัติราคาไม่สำเร็จ:", error);
  priceHistory = [];
}
function savePriceHistory(cropKey, data) {
  if (!data || !Number.isFinite(data.averagePrice)) {
    return;
  }

  // หารายการล่าสุดของพืชชนิดนี้
  const lastItem = [...priceHistory]
    .reverse()
    .find((item) => item.crop === cropKey);

  // ถ้าราคาเหมือนรายการล่าสุด ไม่บันทึกซ้ำ
const today = new Date().toISOString().slice(0, 10);

const lastDate = lastItem
  ? new Date(lastItem.timestamp).toISOString().slice(0, 10)
  : null;

if (
  lastItem &&
  lastItem.averagePrice === data.averagePrice &&
  lastDate === today
) {
  return;
}
  priceHistory.push({
    crop: cropKey,
    name: data.name,
    averagePrice: data.averagePrice,
    minPrice: data.minPrice,
    maxPrice: data.maxPrice,
    sourceCount: data.sourceCount,
    timestamp: new Date().toISOString(),
  });

  // เก็บประวัติสูงสุด 5000 รายการ
  if (priceHistory.length > 5000) {
    priceHistory.shift();
  }
  try {
  fs.writeFileSync(
    HISTORY_FILE,
    JSON.stringify(priceHistory, null, 2),
    "utf8"
  );
} catch (error) {
  console.error("บันทึกประวัติราคาไม่สำเร็จ:", error);
}
}
// ==========================================
// พืชที่เราติดตาม
// ==========================================

const CROPS = {
  shallot: {
    name: "หอมแบ่ง",
    srimuangKeyword: "ต้นหอม",
    talaadthaiKeyword: "ต้นหอม",
    talaadthaiUrl:
      "https://talaadthai.com/products/spring-onion-9707-2366",
    simummuangKeywords: ["หอมแบ่ง", "ต้นหอม"],
  },

  kale: {
    name: "คะน้า",
    srimuangKeyword: "คะน้าต้น",
    talaadthaiKeyword: "คะน้าต้น",
    talaadthaiUrl:
      "https://talaadthai.com/products/chinese-kale-9714-2382",
    simummuangKeywords: ["คะน้า"],
  },

  pakchoi: {
    name: "กวางตุ้ง",
    srimuangKeyword: "ผักกวางตุ้งธรรมดา",
    talaadthaiKeyword: "กวางตุ้งดอก",
    talaadthaiUrl:
      "https://talaadthai.com/products/bok-choy-9730-2488",
    simummuangKeywords: ["กวางตุ้ง"],
  },

  chili: {
    name: "พริก",
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
    srimuangKeyword: "ผักชี",
    talaadthaiKeyword: "ผักชีไทย",
    talaadthaiUrl:
      "https://talaadthai.com/products/coriander-9675-2364",
    simummuangKeywords: ["ผักชี", "ผักชีไทย"],
  },
    cucumber: {
    name: "แตงกวา",
    srimuangKeyword: "แตงกวา",
    talaadthaiKeyword: "แตงกวาอ่อน",
    talaadthaiUrl:
      "https://talaadthai.com/products/cucumber-9704-2424",
    simummuangKeywords: ["แตงกวา", "แตงกวาอ่อน", "แตงกวาไทย"],
  },

  longbean: {
    name: "ถั่วฝักยาว",
    srimuangKeyword: "ถั่วฝักยาว",
    talaadthaiKeyword: "ถั่วฝักยาว",
    talaadthaiUrl:
      "https://talaadthai.com/products/long-beans-9699-2363",
    simummuangKeywords: ["ถั่วฝักยาว"],
  },

  celery: {
    name: "ขึ้นฉ่าย",
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
    srimuangKeyword: "ผักบุ้งจีน",
    talaadthaiKeyword: "ผักบุ้งจีน",
    talaadthaiUrl:
      "https://talaadthai.com/products/morning-glory-9672-2373",
    simummuangKeywords: ["ผักบุ้งจีน", "ผักบุ้ง"],
  },

  cabbage: {
    name: "กะหล่ำปลี",
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
  const response = await fetch(url, {
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
    return {
      market: "ตลาดศรีเมือง ราชบุรี",
      available: false,
      reason: error.message,
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

function getSimumuangName(item) {
  return (
    item?.th?.name ||
    item?.name ||
    ""
  );
}

function getSimumuangRange(item) {
  const groups = [
    item?.price?.small,
    item?.price?.medium,
    item?.price?.large,
  ].filter(Boolean);

  const values = [];

  for (const group of groups) {
   if (
  Number.isFinite(Number(group.min)) &&
  Number(group.min) > 0
) {
  values.push(Number(group.min));
}

   if (
  Number.isFinite(Number(group.max)) &&
  Number(group.max) > 0
) {
  values.push(Number(group.max));
}
  }

  if (!values.length) return null;

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
let simuMuangItemsCache = null;
let simuMuangCacheTime = 0;
const SIMUMUANG_CACHE_MS = 5 * 60 * 1000;
let simuMuangLoadingPromise = null;

async function getSimumuangPrice(crop) {
  try {
    if (
  simuMuangItemsCache &&
  Date.now() - simuMuangCacheTime < SIMUMUANG_CACHE_MS
) {
  const allItems = simuMuangItemsCache;

  return getSimumuangPriceFromItems(crop, allItems);
}
if (simuMuangLoadingPromise) {
  const allItems = await simuMuangLoadingPromise;

  return getSimumuangPriceFromItems(crop, allItems);
}
simuMuangLoadingPromise = (async () => {
    const allItems = [];
    const MAX_PAGES = 60;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        "https://api.simummuangmarket.com/api/app/products" +
        `?page=${page}` +
        "&limit=20" ;

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 Farm-Dashboard/1.0",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.log(
          `SIMUMUANG PAGE ${page}: HTTP ${response.status}`
        );

        if (page === 1) {
          throw new Error(
            `API ตอบกลับ ${response.status}`
          );
        }

        break;
      }

      const json = await response.json();

      const pageItems =
        json?.data?.data || [];

      console.log(
        `SIMUMUANG PAGE ${page}:`,
        pageItems.length,
        "รายการ"
      );

      if (pageItems.length === 0) {
        break;
      }

      allItems.push(...pageItems);
    }

    console.log(
      "SIMUMUANG TOTAL ITEMS:",
      allItems.length
    );
    simuMuangItemsCache = allItems;
simuMuangCacheTime = Date.now();
return allItems;
})();

const loadedItems = await simuMuangLoadingPromise;
simuMuangLoadingPromise = null;
return getSimumuangPriceFromItems(crop, loadedItems);

} catch (error) {
  simuMuangLoadingPromise = null;

  return {
    market: "ตลาดสี่มุมเมือง",
    available: false,
    reason: error.message,
  };
}
} 

function getSimumuangPriceFromItems(crop, allItems) {
  const fallbackKeywords = {
    "หอมแบ่ง": ["ต้นหอม", "หอมแบ่ง", "หอม"],
    "คะน้า": ["คะน้า"],
    "กวางตุ้ง": ["กวางตุ้ง"],
    "พริก": ["พริก"],
    "ผักชี": ["ผักชี"],
    "แตงกวา": ["แตงกวา"],
    "ถั่วฝักยาว": ["ถั่วฝักยาว"],
    "ขึ้นฉ่าย": ["ขึ้นฉ่าย", "คื่นช่าย"],
    "ผักบุ้งจีน": ["ผักบุ้ง", "ผักบุ้งจีน"],
    "กะหล่ำปลี": ["กะหล่ำ", "กะหล่ำปลี"],
  };

  const searchKeywords = [
    ...(crop.simumuangKeywords || []),
    ...(fallbackKeywords[crop.name] || []),
  ];

  const found = allItems.find((item) => {
    const name = getSimumuangName(item);

    return searchKeywords.some(
      (keyword) => name.includes(keyword)
    );
  });

  console.log(
  "SIMUMUANG MATCH:",
  crop.name,
  "=>",
  found ? getSimumuangName(found) : "NOT FOUND"
);

console.log(
  "SIMUMUANG RAW PRICE:",
  found?.price
);

  if (!found) {
    return {
      market: "ตลาดสี่มุมเมือง",
      available: false,
      reason: "วันนี้ API ไม่พบสินค้ารายการนี้",
    };
  }

  const price = getSimumuangRange(found);

  if (!price) {
    return {
      market: "ตลาดสี่มุมเมือง",
      available: false,
      reason: "ไม่มีข้อมูลราคา",
    };
  }

  return {
    market: "ตลาดสี่มุมเมือง",
    available: true,
    productName: getSimumuangName(found),
    min: price.min,
    max: price.max,
    mid: midpoint(price.min, price.max),
    unit: "บาท/กก.",
    source: "https://www.simummuangmarket.com/pricing",
  };
}
// ==========================================
// รวมหลายตลาด + ราคากลาง
// ==========================================

async function getCropMarketData(
  cropKey
) {
  const crop = CROPS[cropKey];

  if (!crop) return null;

  const markets = await Promise.all([
    getSrimuangPrice(crop),
    getSimumuangPrice(crop),
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
  savePriceHistory(cropKey, result);
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

  let history = priceHistory;

  if (cropKey) {
    history = priceHistory.filter(
      (item) => item.crop === cropKey
    );
  }

  res.writeHead(200);

  return res.end(
    JSON.stringify({
      status: "ok",
      count: history.length,
      data: history,
    })
  );
}    // -----------------------
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
  console.log("เริ่มบันทึกราคาอัตโนมัติ...");

  for (const cropKey of Object.keys(CROPS)) {
    try {
      const data = await getCropMarketData(cropKey);

      // บันทึกเฉพาะเมื่อได้ครบ 2 ตลาด
      if (data && data.sourceCount === 2) {
        savePriceHistory(cropKey, data);

        console.log(
          `บันทึก ${data.name}: ${data.averagePrice} บาท/กก.`
        );
      } else {
        console.log(
          `ข้าม ${cropKey}: ข้อมูลยังไม่ครบ 2 ตลาด`
        );
      }
    } catch (error) {
      console.error(
        `บันทึก ${cropKey} ไม่สำเร็จ:`,
        error.message
      );
    }
  }

  console.log("บันทึกราคาอัตโนมัติเสร็จแล้ว");
}

function scheduleDailyPrices() {
  const now = new Date();

  const nextRun = new Date();
  nextRun.setHours(7, 0, 0, 0);

  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  const delay = nextRun.getTime() - now.getTime();

  console.log(
    "บันทึกราคาอัตโนมัติครั้งถัดไป:",
    nextRun.toLocaleString("th-TH")
  );

  setTimeout(async () => {
    await saveDailyPrices();
    scheduleDailyPrices();
  }, delay);
}

scheduleDailyPrices();
server.listen(PORT, () => {
  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    " Farm Dashboard Multi-Market Server"
  );
  console.log(
    ` http://localhost:${PORT}`
  );
  console.log(
    "======================================"
  );
  console.log("");
});