import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { webhookUrl } = await request.json();

    if (!webhookUrl) {
      return NextResponse.json({ error: "Webhook URL is required" }, { status: 400 });
    }

    const payload = {
      username: "FocusTodo Bot",
      avatar_url: "https://raw.githubusercontent.com/kirinwaffle00-a11y/my-todo-app/main/public/icon-192x192.png",
      embeds: [
        {
          title: "🚀 テスト通知成功！",
          description: "FocusTodo から Discord への接続が正常に確認できました！\nこれですべての通知機能をご利用いただけます。",
          color: 0x818cf8, // Indigo accent color (#818cf8)
          timestamp: new Date().toISOString(),
          footer: {
            text: "FocusTodo Webhook Test",
          },
        },
      ],
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Discord API Error: ${errText}` }, { status: res.status });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error sending test discord notification:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
