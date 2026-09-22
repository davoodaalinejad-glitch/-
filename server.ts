import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// In-memory rate cache
interface CachedRates {
  timestamp: number;
  rates: Record<string, {
    price: number; // in Toman or USD
    currency: "TMN" | "USD";
    change24h?: number;
    nameFa: string;
    category: "currency" | "gold" | "crypto" | "stock";
    source: string;
    lastUpdated: string;
  }>;
  sourcesStatus: {
    alanchand: boolean;
    wallex: boolean;
    navasan?: boolean;
    tsetmc?: boolean;
  };
}

let ratesCache: CachedRates | null = null;
const CACHE_TTL_MS = 45 * 1000; // 45 seconds cache

// Default baseline rates for fallback in case of internet throttling/network timeout
const BASELINE_RATES: Record<string, { price: number; currency: "TMN" | "USD"; nameFa: string; category: "currency" | "gold" | "crypto" | "stock"; source: string }> = {
  // Currencies (from alanchand.com)
  USD_FREE: { price: 230700, currency: "TMN", nameFa: "دلار آمریکا (آزاد)", category: "currency", source: "alanchand.com" },
  EUR_FREE: { price: 264600, currency: "TMN", nameFa: "یورو", category: "currency", source: "alanchand.com" },
  AED_FREE: { price: 62810, currency: "TMN", nameFa: "درهم امارات", category: "currency", source: "alanchand.com" },
  GBP_FREE: { price: 305600, currency: "TMN", nameFa: "پوند انگلیس", category: "currency", source: "alanchand.com" },
  CAD_FREE: { price: 164400, currency: "TMN", nameFa: "دلار کانادا", category: "currency", source: "alanchand.com" },
  TRY_FREE: { price: 4800, currency: "TMN", nameFa: "لیر ترکیه", category: "currency", source: "alanchand.com" },
  CNY_FREE: { price: 34540, currency: "TMN", nameFa: "یوان چین", category: "currency", source: "alanchand.com" },

  // Gold & Coins (from alanchand.com)
  GOLD_18K: { price: 24054670, currency: "TMN", nameFa: "طلای ۱۸ عیار (هر گرم)", category: "gold", source: "alanchand.com" },
  GOLD_24K: { price: 32072890, currency: "TMN", nameFa: "طلای ۲۴ عیار (هر گرم)", category: "gold", source: "alanchand.com" },
  GOLD_MESGHAL: { price: 104200000, currency: "TMN", nameFa: "مثقال طلای آبشده", category: "gold", source: "alanchand.com" },
  GOLD_OUNCE: { price: 4322, currency: "USD", nameFa: "انس جهانی طلا", category: "gold", source: "alanchand.com" },
  COIN_EMAMI: { price: 236000000, currency: "TMN", nameFa: "سکه امامی (طرح جدید)", category: "gold", source: "alanchand.com" },
  COIN_BAHAR: { price: 232000000, currency: "TMN", nameFa: "سکه تمام بهار آزادی", category: "gold", source: "alanchand.com" },
  COIN_NIM: { price: 120000000, currency: "TMN", nameFa: "نیم سکه بهار آزادی", category: "gold", source: "alanchand.com" },
  COIN_ROB: { price: 63000000, currency: "TMN", nameFa: "ربع سکه بهار آزادی", category: "gold", source: "alanchand.com" },
  COIN_GERAMI: { price: 33000000, currency: "TMN", nameFa: "سکه یک گرمی", category: "gold", source: "alanchand.com" },

  // Cryptocurrencies (from Wallex)
  USDT_TMN: { price: 230500, currency: "TMN", nameFa: "تتر (USDT)", category: "crypto", source: "wallex.ir" },
  BTC_TMN: { price: 15450000000, currency: "TMN", nameFa: "بیت‌کوین (BTC)", category: "crypto", source: "wallex.ir" },
  BTC_USD: { price: 67500, currency: "USD", nameFa: "بیت‌کوین دلاری", category: "crypto", source: "wallex.ir" },
  ETH_TMN: { price: 580000000, currency: "TMN", nameFa: "اتریوم (ETH)", category: "crypto", source: "wallex.ir" },
  ETH_USD: { price: 2530, currency: "USD", nameFa: "اتریوم دلاری", category: "crypto", source: "wallex.ir" },
  SOL_TMN: { price: 35000000, currency: "TMN", nameFa: "سولانا (SOL)", category: "crypto", source: "wallex.ir" },
  TON_TMN: { price: 1250000, currency: "TMN", nameFa: "تون‌کوین (TON)", category: "crypto", source: "wallex.ir" },
  DOGE_TMN: { price: 31000, currency: "TMN", nameFa: "دوج‌کوین (DOGE)", category: "crypto", source: "wallex.ir" },
  TRX_TMN: { price: 38000, currency: "TMN", nameFa: "ترون (TRX)", category: "crypto", source: "wallex.ir" },

  // Stocks & Gold Funds (Manual User Valuation)
  STOCK_FOOLAD: { price: 540, currency: "TMN", nameFa: "فولاد مبارکه (فولاد)", category: "stock", source: "دستی" },
  STOCK_KHODRO: { price: 285, currency: "TMN", nameFa: "ایران خودرو (خودرو)", category: "stock", source: "دستی" },
  STOCK_FEMELLI: { price: 710, currency: "TMN", nameFa: "ملی مس (فملی)", category: "stock", source: "دستی" },
  STOCK_SHASTA: { price: 128, currency: "TMN", nameFa: "سرمایه‌گذاری تامین اجتماعی (شستا)", category: "stock", source: "دستی" },
  STOCK_VEBMELAT: { price: 245, currency: "TMN", nameFa: "بانک ملت (وبملت)", category: "stock", source: "دستی" },
  FUND_AYAR: { price: 7850, currency: "TMN", nameFa: "صندوق طلای عیار (عیار)", category: "stock", source: "دستی" },
  FUND_KAHROBA: { price: 8120, currency: "TMN", nameFa: "صندوق طلای کهربا (کهربا)", category: "stock", source: "دستی" },
  FUND_TALA: { price: 34500, currency: "TMN", nameFa: "صندوق طلای لوتوس (طلا)", category: "stock", source: "دستی" },
  FUND_ZARFAM: { price: 6240, currency: "TMN", nameFa: "صندوق طلای زرفام (زرفام)", category: "stock", source: "دستی" },
  FUND_GOHAR: { price: 19800, currency: "TMN", nameFa: "صندوق طلای گوهر (گوهر)", category: "stock", source: "دستی" },
};

async function fetchAlanChandRates(customToken?: string): Promise<{
  success: boolean;
  data: Partial<Record<string, number>>;
  sourceLabel: string;
}> {
  const token = customToken || process.env.ALANCHAND_API_TOKEN;
  const extracted: Partial<Record<string, number>> = {};
  let usedApi = false;

  // 1. If token is provided, attempt api.alanchand.com
  if (token && token.trim()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const headers = {
        Authorization: `Bearer ${token.trim()}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      };

      const [currRes, goldRes] = await Promise.allSettled([
        fetch("https://api.alanchand.com/?type=currency&symbols=usd,eur,gbp,aed,cny,try,cad,aud", {
          headers,
          signal: controller.signal,
        }),
        fetch("https://api.alanchand.com/?type=gold&symbols=18ayar,sekkeh,bahar,nim,rob,sek,abshodeh,usd_xau", {
          headers,
          signal: controller.signal,
        }),
      ]);
      clearTimeout(timer);

      const parseApiPrice = (val: any) => {
        if (!val) return null;
        const n = parseFloat(String(val).replace(/,/g, ""));
        return isNaN(n) ? null : n;
      };

      if (currRes.status === "fulfilled" && currRes.value.ok) {
        const json = await currRes.value.json();
        const items = Array.isArray(json) ? json : (json?.data || json?.result || json);
        if (typeof items === "object" && items !== null) {
          usedApi = true;
          for (const [k, v] of Object.entries(items)) {
            const sym = k.toLowerCase();
            const p = parseApiPrice(typeof v === "object" ? (v as any)?.price || (v as any)?.sell : v);
            if (p) {
              if (sym.includes("usd")) extracted.USD_FREE = p;
              else if (sym.includes("eur")) extracted.EUR_FREE = p;
              else if (sym.includes("aed")) extracted.AED_FREE = p;
              else if (sym.includes("gbp")) extracted.GBP_FREE = p;
              else if (sym.includes("cny")) extracted.CNY_FREE = p;
              else if (sym.includes("try")) extracted.TRY_FREE = p;
              else if (sym.includes("cad")) extracted.CAD_FREE = p;
              else if (sym.includes("aud")) extracted.AUD_FREE = p;
            }
          }
        }
      }

      if (goldRes.status === "fulfilled" && goldRes.value.ok) {
        const json = await goldRes.value.json();
        const items = Array.isArray(json) ? json : (json?.data || json?.result || json);
        if (typeof items === "object" && items !== null) {
          usedApi = true;
          for (const [k, v] of Object.entries(items)) {
            const sym = k.toLowerCase();
            const p = parseApiPrice(typeof v === "object" ? (v as any)?.price || (v as any)?.sell : v);
            if (p) {
              const tmn = p > 50000000 ? Math.round(p / 10) : Math.round(p);
              if (sym.includes("18") || sym.includes("ayar")) {
                extracted.GOLD_18K = tmn;
                extracted.GOLD_24K = Math.round(tmn * (24 / 18));
              } else if (sym.includes("sekkeh") || sym.includes("emami")) {
                extracted.COIN_EMAMI = tmn;
              } else if (sym.includes("bahar")) {
                extracted.COIN_BAHAR = tmn;
              } else if (sym.includes("nim")) {
                extracted.COIN_NIM = tmn;
              } else if (sym.includes("rob")) {
                extracted.COIN_ROB = tmn;
              } else if (sym.includes("sek") || sym.includes("gerami")) {
                extracted.COIN_GERAMI = tmn;
              } else if (sym.includes("abshodeh") || sym.includes("mesghal")) {
                extracted.GOLD_MESGHAL = tmn;
              } else if (sym.includes("xau") || sym.includes("ons")) {
                extracted.GOLD_OUNCE = p;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("api.alanchand.com request failed, falling back to alanchand.com scraping", e);
    }
  }

  // 2. If API was not used or didn't yield enough symbols, scrape alanchand.com real-time pages
  if (Object.keys(extracted).length < 5) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);

      const [homeRes, goldRes] = await Promise.allSettled([
        fetch("https://alanchand.com", {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
          },
          signal: controller.signal,
        }),
        fetch("https://alanchand.com/gold-price", {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
          },
          signal: controller.signal,
        }),
      ]);
      clearTimeout(timer);

      const toLatinDigits = (s: string) =>
        s.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d).toString()).replace(/,/g, "").trim();

      // Parse Currencies from https://alanchand.com
      if (homeRes.status === "fulfilled" && homeRes.value.ok) {
        const homeHtml = await homeRes.value.text();
        const $home = cheerio.load(homeHtml);

        $home("tr[onclick*='currencies-price/']").each((_, tr) => {
          const onclick = $home(tr).attr("onclick") || "";
          const match = onclick.match(/currencies-price\/([a-z-]+)/);
          if (!match) return;
          const code = match[1];
          const sellText = toLatinDigits($home(tr).find("td.sellPrice").text());
          const val = parseFloat(sellText);
          if (!isNaN(val) && val > 0) {
            if (code === "usd") extracted.USD_FREE = val;
            else if (code === "eur") extracted.EUR_FREE = val;
            else if (code === "aed") extracted.AED_FREE = val;
            else if (code === "gbp") extracted.GBP_FREE = val;
            else if (code === "cny") extracted.CNY_FREE = val;
            else if (code === "try") extracted.TRY_FREE = val;
            else if (code === "cad") extracted.CAD_FREE = val;
            else if (code === "aud") extracted.AUD_FREE = val;
          }
        });
      }

      // Parse Gold & Coins from https://alanchand.com/gold-price
      if (goldRes.status === "fulfilled" && goldRes.value.ok) {
        const goldHtml = await goldRes.value.text();
        const $gold = cheerio.load(goldHtml);

        $gold('script[type="application/ld+json"]').each((_, el) => {
          try {
            const json = JSON.parse($gold(el).html() || "{}");
            if (json.itemListElement && Array.isArray(json.itemListElement)) {
              for (const item of json.itemListElement) {
                const product = item.item;
                if (!product || !product.offers || !product.offers.price) continue;
                const url = (product.url || "").toLowerCase();
                const priceRaw = parseFloat(product.offers.price);
                if (isNaN(priceRaw) || priceRaw <= 0) continue;

                // alanchand JSON-LD IRR -> Toman (/ 10)
                const isRial = product.offers.priceCurrency === "IRR" || priceRaw > 20000000;
                const tmnVal = isRial ? Math.round(priceRaw / 10) : Math.round(priceRaw);

                if (url.includes("18ayar")) {
                  extracted.GOLD_18K = tmnVal;
                  extracted.GOLD_24K = Math.round(tmnVal * (24 / 18));
                } else if (url.includes("abshodeh")) {
                  extracted.GOLD_MESGHAL = tmnVal;
                } else if (url.includes("sekkeh")) {
                  extracted.COIN_EMAMI = tmnVal;
                } else if (url.includes("bahar")) {
                  extracted.COIN_BAHAR = tmnVal;
                } else if (url.includes("nim")) {
                  extracted.COIN_NIM = tmnVal;
                } else if (url.includes("rob")) {
                  extracted.COIN_ROB = tmnVal;
                } else if (url.includes("sek")) {
                  extracted.COIN_GERAMI = tmnVal;
                } else if (url.includes("usd_xau")) {
                  extracted.GOLD_OUNCE = priceRaw;
                }
              }
            }
          } catch (e) {
            // ignore JSON parse error
          }
        });
      }
    } catch (err: any) {
      console.warn("alanchand.com scraping error:", err?.message);
    }
  }

  return {
    success: Object.keys(extracted).length > 0,
    data: extracted,
    sourceLabel: usedApi ? "api.alanchand.com (زنده)" : "alanchand.com (الان چند)",
  };
}

async function fetchWallexRates(): Promise<{ success: boolean; data: Partial<Record<string, { priceTmn: number; priceUsd?: number; change24h?: number }>> }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch("https://api.wallex.ir/v1/markets", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return { success: false, data: {} };
    const json = await res.json();
    const symbols = json?.result?.symbols || {};

    const extracted: Partial<Record<string, { priceTmn: number; priceUsd?: number; change24h?: number }>> = {};

    const usdtTmn = parseFloat(symbols.USDTTMN?.stats?.lastPrice || "0");
    if (usdtTmn > 0) {
      extracted.USDT_TMN = {
        priceTmn: Math.round(usdtTmn),
        change24h: parseFloat(symbols.USDTTMN?.stats?.["24h_ch"] || "0"),
      };
    }

    const mapCrypto = (symKey: string, tmnKey: string, usdKey?: string) => {
      const tmnItem = symbols[`${symKey}TMN`];
      const usdtItem = symbols[`${symKey}USDT`];
      const pTmn = parseFloat(tmnItem?.stats?.lastPrice || "0");
      const pUsd = parseFloat(usdtItem?.stats?.lastPrice || "0");
      const ch = parseFloat(tmnItem?.stats?.["24h_ch"] || usdtItem?.stats?.["24h_ch"] || "0");

      if (pTmn > 0) {
        extracted[tmnKey] = {
          priceTmn: Math.round(pTmn),
          priceUsd: pUsd > 0 ? pUsd : (usdtTmn > 0 ? pTmn / usdtTmn : undefined),
          change24h: ch,
        };
      } else if (pUsd > 0 && usdtTmn > 0) {
        extracted[tmnKey] = {
          priceTmn: Math.round(pUsd * usdtTmn),
          priceUsd: pUsd,
          change24h: ch,
        };
      }

      if (usdKey && pUsd > 0) {
        extracted[usdKey] = {
          priceTmn: Math.round(pUsd * (usdtTmn || 90000)),
          priceUsd: pUsd,
          change24h: ch,
        };
      }
    };

    mapCrypto("BTC", "BTC_TMN", "BTC_USD");
    mapCrypto("ETH", "ETH_TMN", "ETH_USD");
    mapCrypto("SOL", "SOL_TMN", "SOL_USD");
    mapCrypto("TON", "TON_TMN", "TON_USD");
    mapCrypto("DOGE", "DOGE_TMN");
    mapCrypto("TRX", "TRX_TMN");

    return { success: Object.keys(extracted).length > 0, data: extracted };
  } catch (error: any) {
    console.warn("Wallex fetch error:", error?.message);
    return { success: false, data: {} };
  }
}

// Master Rates API endpoint
app.get("/api/rates", async (req, res) => {
  const forceRefresh = req.query.refresh === "true";
  const customToken = (req.query.token as string) || (req.headers["x-alanchand-token"] as string);
  const now = Date.now();

  if (!forceRefresh && !customToken && ratesCache && (now - ratesCache.timestamp < CACHE_TTL_MS)) {
    return res.json({
      cached: true,
      timestamp: ratesCache.timestamp,
      rates: ratesCache.rates,
      sourcesStatus: ratesCache.sourcesStatus,
    });
  }

  // Fetch concurrently from Alan Chand (currencies & gold) and Wallex (cryptocurrencies)
  const [alanChandResult, wallexResult] = await Promise.all([
    fetchAlanChandRates(customToken),
    fetchWallexRates(),
  ]);

  const combinedRates: CachedRates["rates"] = {};
  const dateStr = new Date().toLocaleTimeString("fa-IR");

  // Populate from Baseline first
  for (const [key, base] of Object.entries(BASELINE_RATES)) {
    combinedRates[key] = {
      price: base.price,
      currency: base.currency,
      change24h: 0,
      nameFa: base.nameFa,
      category: base.category,
      source: base.source,
      lastUpdated: dateStr,
    };
  }

  // Update Alan Chand rates
  if (alanChandResult.success) {
    for (const [key, val] of Object.entries(alanChandResult.data)) {
      if (val && combinedRates[key]) {
        combinedRates[key].price = val;
        combinedRates[key].source = alanChandResult.sourceLabel;
        combinedRates[key].lastUpdated = dateStr;
      }
    }
  }

  // Update Wallex rates
  if (wallexResult.success) {
    for (const [key, item] of Object.entries(wallexResult.data)) {
      if (item && combinedRates[key]) {
        combinedRates[key].price = item.priceTmn;
        if (item.change24h !== undefined) {
          combinedRates[key].change24h = item.change24h;
        }
        combinedRates[key].source = "wallex.ir (زنده)";
        combinedRates[key].lastUpdated = dateStr;
      }
    }
    // Also update USD_FREE if needed
    if (wallexResult.data.USDT_TMN?.priceTmn && !alanChandResult.data.USD_FREE) {
      if (combinedRates.USD_FREE) {
        combinedRates.USD_FREE.price = wallexResult.data.USDT_TMN.priceTmn;
      }
    }
  }

  // Update gold calculation links if gold 18k is available but mesghal isn't
  if (combinedRates.GOLD_18K && combinedRates.GOLD_18K.price > 0) {
    if (!alanChandResult.data.GOLD_MESGHAL) {
      combinedRates.GOLD_MESGHAL.price = Math.round(combinedRates.GOLD_18K.price * 4.3318);
    }
  }

  ratesCache = {
    timestamp: now,
    rates: combinedRates,
    sourcesStatus: {
      alanchand: alanChandResult.success,
      wallex: wallexResult.success,
      navasan: false,
      tsetmc: false,
    },
  };

  res.json({
    cached: false,
    timestamp: now,
    rates: combinedRates,
    sourcesStatus: ratesCache.sourcesStatus,
  });
});

// Test custom source endpoint
app.post("/api/rates/test-source", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ success: false, message: "آدرس نامعتبر است" });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const contentType = response.headers.get("content-type") || "";
    let sample = "";
    if (contentType.includes("json")) {
      const j = await response.json();
      sample = JSON.stringify(j).slice(0, 200);
    } else {
      const t = await response.text();
      sample = t.slice(0, 200);
    }

    res.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      sample,
    });
  } catch (error: any) {
    res.json({
      success: false,
      message: error?.message || "خطا در برقراری ارتباط با سایت",
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Portfolio Tracker Server running on port ${PORT}`);
  });
}

startServer();
