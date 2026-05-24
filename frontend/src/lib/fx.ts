/**
 * Currency detection + USD-to-local FX conversion for the tip line.
 *
 * Bill-e doesn't store the bill's currency anywhere — bills are formatted as
 * a generic "$" amount with locale-detected decimal places. To show the tip
 * (always charged in USD via Polar) in the same currency the host saw on the
 * receipt, we infer the local currency from the user's IP-based country code
 * (the same source the rest of the app uses for payment routing).
 *
 * FX rates come from open.er-api.com (free, no key) and are cached in
 * localStorage for 24h. If anything fails, callers fall back to showing
 * the tip in USD only.
 */

import { getCountryCode } from "./geo";

/** Subset of countries Bill-e expects to see — extend as needed. */
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // LATAM
  AR: "ARS",
  BO: "BOB",
  BR: "BRL",
  CL: "CLP",
  CO: "COP",
  CR: "CRC",
  DO: "DOP",
  EC: "USD",
  GT: "GTQ",
  HN: "HNL",
  MX: "MXN",
  NI: "NIO",
  PA: "USD",
  PE: "PEN",
  PR: "USD",
  PY: "PYG",
  SV: "USD",
  UY: "UYU",
  VE: "VES",

  // North America
  CA: "CAD",
  US: "USD",

  // Europe — Eurozone aliases
  AT: "EUR",
  BE: "EUR",
  CY: "EUR",
  DE: "EUR",
  EE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  MT: "EUR",
  NL: "EUR",
  PT: "EUR",
  SI: "EUR",
  SK: "EUR",
  // Europe — non-Eurozone
  CH: "CHF",
  CZ: "CZK",
  DK: "DKK",
  GB: "GBP",
  HU: "HUF",
  NO: "NOK",
  PL: "PLN",
  SE: "SEK",

  // APAC
  AU: "AUD",
  CN: "CNY",
  HK: "HKD",
  ID: "IDR",
  IN: "INR",
  JP: "JPY",
  KR: "KRW",
  MY: "MYR",
  NZ: "NZD",
  PH: "PHP",
  SG: "SGD",
  TH: "THB",
  TW: "TWD",
  VN: "VND",
};

const STORAGE_KEY = "bille-fx-usd-rates-v1";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CachedRates {
  fetchedAt: number;
  rates: Record<string, number>;
}

function readCache(): CachedRates | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRates;
    if (!parsed.fetchedAt || !parsed.rates) return null;
    if (Date.now() - parsed.fetchedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(rates: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedRates = { fetchedAt: Date.now(), rates };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota exceeded or disabled — ignore */
  }
}

async function fetchUsdRates(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.result !== "success" || !data?.rates) return null;
    return data.rates as Record<string, number>;
  } catch {
    return null;
  }
}

/** USD→localCurrency rate, with 24h cache. Null if FX unavailable. */
export async function getUsdToLocalRate(currency: string): Promise<number | null> {
  if (currency === "USD") return 1;

  const cached = readCache();
  if (cached && cached.rates[currency] != null) return cached.rates[currency];

  const rates = await fetchUsdRates();
  if (!rates) return null;
  writeCache(rates);
  return rates[currency] ?? null;
}

/** Currency code inferred from the user's IP-based country. "USD" fallback. */
export async function getLocalCurrency(): Promise<string> {
  try {
    const country = await getCountryCode();
    return COUNTRY_TO_CURRENCY[country.toUpperCase()] || "USD";
  } catch {
    return "USD";
  }
}

/** One-shot helper: returns {currency, rate} for the tip line. */
export async function getLocalFx(): Promise<{ currency: string; rate: number } | null> {
  const currency = await getLocalCurrency();
  const rate = await getUsdToLocalRate(currency);
  if (rate == null) return null;
  return { currency, rate };
}
