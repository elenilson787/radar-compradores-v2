import { NextRequest, NextResponse } from "next/server";
import { analyzeText } from "@/lib/scoring";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Texto obrigatório" }, { status: 400 });
  return NextResponse.json(analyzeText(text, body.campaign, body.publishedAt));
}
