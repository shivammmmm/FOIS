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
 * Small corner toast for new notifications: unlike the bell dropdown (silent,
 * only shown when opened), this surfaces the moment a NEW notification
 * arrives. It is intentionally non-blocking — no backdrop, no centered
 * modal — so it never interrupts work on the main screen; full details
 * always live behind the bell icon. Only alarms for notifications that
 * arrive after it starts watching — the existing unread backlog at first
 * login is baselined silently so it doesn't dump dozens of toasts at once.
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

  const acknowledgeAll = async () => {
    setAcking(true);
    try {
      await base44.notifications.markAllRead().catch(() => undefined);
    } finally {
      setQueue([]);
      setAcking(false);
    }
  };

  const viewAll = () => {
    setQueue((prev) => prev.slice(1));
    navigate("/admin/notifications");
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-72 animate-fade-in pointer-events-none">
      <div className="pointer-events-auto rounded-lg border border-primary/30 bg-card shadow-lg overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <Bell className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate text-xs font-semibold text-foreground" title={current.title || "Notification"}>
              {current.title || "Notification"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setQueue((prev) => prev.slice(1))}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Dismiss (still marked unread)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px]">
          {queue.length > 1 ? (
            <span className="text-muted-foreground">+{queue.length - 1} more</span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={viewAll} className="font-semibold text-muted-foreground hover:underline">
              View
            </button>
            {queue.length > 1 ? (
              <button type="button" onClick={acknowledgeAll} disabled={acking} className="font-semibold text-primary hover:underline disabled:opacity-60">
                {acking ? "..." : "Ack All"}
              </button>
            ) : (
              <button type="button" onClick={acknowledge} disabled={acking} className="font-semibold text-primary hover:underline disabled:opacity-60">
                {acking ? "..." : "Ack"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
