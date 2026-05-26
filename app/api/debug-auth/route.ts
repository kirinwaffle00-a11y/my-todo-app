import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "❌ NOT SET",
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID
      ? "✅ SET (length: " + process.env.GOOGLE_CLIENT_ID.length + ")"
      : "❌ NOT SET",
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET
      ? "✅ SET (length: " + process.env.GOOGLE_CLIENT_SECRET.length + ")"
      : "❌ NOT SET",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET
      ? "✅ SET (length: " + process.env.NEXTAUTH_SECRET.length + ")"
      : "❌ NOT SET",
  });
}
