import { NextResponse } from "next/server";

const PRIORITY_LABEL = {
  high: "🔥 高",
  medium: "⚡ 中",
  low: "🌱 低",
};

export async function POST(request: Request) {
  try {
    const { webhookUrl, task } = await request.json();

    if (!webhookUrl || !task) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const priorityText = PRIORITY_LABEL[task.priority as keyof typeof PRIORITY_LABEL] || "中";
    
    const payload = {
      username: "FocusTodo Bot",
      avatar_url: "https://raw.githubusercontent.com/kirinwaffle00-a11y/my-todo-app/main/public/icon-192x192.png",
      content: `新しいタスクが追加されました：**${task.text}**（優先度：${priorityText}）`,
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
    console.error("Error sending add task notification:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
