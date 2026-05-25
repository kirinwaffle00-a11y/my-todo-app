import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/authOptions";

const GCAL_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// ── POST: Create a Google Calendar event for a task ──────────────────────────
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as any)?.accessToken as string | undefined;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { task } = await request.json();

  if (!task?.dueDate) {
    return NextResponse.json({ error: "No due date on task" }, { status: 400 });
  }

  // Build start / end objects
  let start: Record<string, string>;
  let end: Record<string, string>;

  if (task.dueDate && task.dueTime) {
    const iso = `${task.dueDate}T${task.dueTime}:00`;
    const endDate = new Date(iso);
    endDate.setHours(endDate.getHours() + 1);
    start = { dateTime: iso, timeZone: "Asia/Tokyo" };
    end = { dateTime: endDate.toISOString(), timeZone: "Asia/Tokyo" };
  } else {
    // All-day event
    const nextDay = new Date(task.dueDate);
    nextDay.setDate(nextDay.getDate() + 1);
    start = { date: task.dueDate };
    end = { date: nextDay.toISOString().split("T")[0] };
  }

  const descParts: string[] = [];
  if (task.description) descParts.push(task.description);
  if (task.startDate)   descParts.push(`📅 開始日: ${task.startDate}`);
  descParts.push("---\n⚡ FocusTodo より自動登録");

  const event = {
    summary: `${task.priority === "high" ? "🔥" : task.priority === "medium" ? "⚡" : "🌱"} ${task.text}`,
    description: descParts.join("\n\n"),
    start,
    end,
    colorId: task.priority === "high" ? "11" : task.priority === "medium" ? "5" : "9",
  };

  const res = await fetch(GCAL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Google Calendar API error (POST):", err);
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const created = await res.json();
  return NextResponse.json({ eventId: created.id });
}

// ── DELETE: Remove a Google Calendar event when task is completed ─────────────
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as any)?.accessToken as string | undefined;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { eventId } = await request.json();
  if (!eventId) {
    return NextResponse.json({ error: "No eventId provided" }, { status: 400 });
  }

  const res = await fetch(`${GCAL_API}/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 404 = already deleted, treat as success
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    console.error("Google Calendar API error (DELETE):", err);
    return NextResponse.json({ error: err }, { status: res.status });
  }

  return NextResponse.json({ success: true });
}
