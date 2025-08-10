import { NextResponse } from "next/server";

export async function POST(req: Request) {
  console.log("🧪 PIPELINE TEST ENDPOINT DISABLED");

    return new NextResponse(JSON.stringify({
    success: false,
    message: "Test pipeline endpoint has been disabled to prevent duplicate triggers. Use the main application instead."
    }), { 
    status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
} 