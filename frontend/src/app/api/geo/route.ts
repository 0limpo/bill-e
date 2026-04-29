export const runtime = "edge";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const override = url.searchParams.get("country");
  const country = (override || req.headers.get("x-vercel-ip-country") || "XX").toUpperCase();
  return Response.json({ country });
}
