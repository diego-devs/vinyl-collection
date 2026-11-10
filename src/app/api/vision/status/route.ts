import "server-only";
import { connection } from "next/server";
import { getVisionStatus } from "@/server/config";

export async function GET() {
  await connection();
  return Response.json(getVisionStatus(), { headers: { "cache-control": "no-store" } });
}
