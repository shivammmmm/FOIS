import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

const POLL_MS = 25000;
const SEEN_ID_CAP = 500;

function seenKey(userId) {
  return `fois_alarm_seen_${userId}`;
}

function loadSeenIds(userId) {
  try {
    const raw = window.localStorage.getItem(seenKey(userId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveSeenIds(userId, idsSet) {
  try {
    const trimmed = [...idsSet].slice(-SEEN_ID_CAP);
    window.localStorage.setItem(seenKey(userId), JSON.stringify(trimmed));
  } catch {
    // localStorage unavailable — alarm dedup just won't survive a reload.
  }
}

/**
 * Alarm-style notification popup: unlike the bell dropdown (silent, only
 * shown when opened), this stays on screen the moment a NEW notification
 * arrives and does not go away until the user acknowledges it. Only alarms
 * for notifications that arrive after the alarm starts watching — the
 * existing unread backlog at first login is baselined silently so it
 * doesn't dump dozens of popups on the user at once.
 */
export default function NotificationAlarm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [queue, setQueue] = useState([]);
  const [acking, setAcking] = useState(false);
  const seenIdsRef = useRef(new Set());
  const baselinedRef = useRef(false);

  useEffect(() => {
    if (!user?.id) return undefined;
    seenIdsRef.current = loadSeenIds(user.id);
    baselinedRef.current = seenIdsRef.current.size > 0;
    setQueue([]);

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await base44.notifications.list({ page: 1, limit: 100 });
        if (cancelled) return;
        const unread = (response?.items || []).filter((item) => !item.is_read);

        if (!baselinedRef.current) {
          unread.forEach((item) => seenIdsRef.current.add(item.id));
          saveSeenIds(user.id, seenIdsRef.current);
          baselinedRef.current = true;
          return;
        }

        const fresh = unread.filter((item) => !seenIdsRef.current.has(item.id));
        if (fresh.length === 0) return;

        fresh.forEach((item) => seenIdsRef.current.add(item.id));
        saveSeenIds(user.id, seenIdsRef.current);
        setQueue((prev) => [...prev, ...fresh]);
      } catch {
        // Silent — the bell icon already surfaces load failures.
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.id]);

  if (!user?.id || queue.length === 0) return null;

  const current = queue[0];

  const acknowledge = async () => {
    setAcking(true);
    try {
      await base44.notifications.markRead(current.id).catch(() => undefined);
    } finally {
      setQueue((prev) => prev.slice(1));
      setAcking(false);
    }
  };

  const viewAll = () => {
    setQueue((prev) => prev.slice(1));
    navigate("/admin/notifications");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fade-in">
      <div className="w-full max-w-sm rounded-xl border border-primary/30 bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between bg-primary/10 px-4 py-3 border-b border-primary/20">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
            </span>
            <span className="text-sm font-bold text-foreground">Alert{queue.length > 1 ? ` (1 of ${queue.length})` : ""}</span>
          </div>
          <button
            type="button"
            onClick={() => setQueue((prev) => prev.slice(1))}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Dismiss (still marked unread)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-2">
          <div className="flex items-start gap-2">
            <Bell className="h-4 w-4 mt-0.5 text-primary shrink-0" />
            <div className="text-sm font-semibold text-foreground">{current.title || "Notification"}</div>
          </div>
          <div className="whitespace-pre-line text-xs leading-5 text-muted-foreground pl-6">
            {current.message || ""}
          </div>
        </div>

        <div className="flex gap-2 border-t border-border p-3">
          <button
            type="button"
            onClick={viewAll}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            View All
          </button>
          <button
            type="button"
            onClick={acknowledge}
            disabled={acking}
            className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {acking ? "..." : "Acknowledge"}
          </button>
        </div>
      </div>
    </div>
  );
}
