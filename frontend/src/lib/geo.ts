export type PaymentRail = "blocked" | "international";

const BLOCKED_COUNTRIES = new Set(["CL"]);

export async function getCountryCode(): Promise<string> {
  if (typeof window === "undefined") return "XX";
  try {
    const url = new URL(window.location.href);
    const override = url.searchParams.get("country");
    const target = override ? `/api/geo?country=${encodeURIComponent(override)}` : "/api/geo";
    const res = await fetch(target);
    if (!res.ok) return "XX";
    const data = (await res.json()) as { country?: string };
    return (data.country || "XX").toUpperCase();
  } catch {
    return "XX";
  }
}

export function getPaymentRail(country: string): PaymentRail {
  return BLOCKED_COUNTRIES.has(country.toUpperCase()) ? "blocked" : "international";
}
