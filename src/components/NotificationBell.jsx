import { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function NotificationBell({ isAdmin = false }) {
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [feedback, setFeedback] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const rows = await base44.notifications.list();
      setNotifications(rows);
      setUnread(rows.filter((item) => !item.is_read).length);
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const markRead = async (item) => {
    if (!item.is_read) await base44.notifications.markRead(item.id);
    await load();
  };
  const markAll = async () => {
    setMarkingAll(true); setFeedback('');
    try { await base44.notifications.markAllRead(); setNotifications((items) => items.map((item) => ({ ...item, is_read: true }))); setUnread(0); setFeedback('All notifications marked as read.'); }
    catch (error) { setFeedback(error?.message || 'Unable to mark notifications as read.'); }
    finally { setMarkingAll(false); }
  };

  return (
    <div className="relative">
    <button type="button" aria-label="Notifications" onClick={() => { setOpen((value) => !value); load(); }} className="relative p-2 rounded-lg hover:bg-muted transition-colors">
      <Bell className="w-5 h-5 text-muted-foreground" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive rounded-full text-[10px] font-bold text-white flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
    {open && <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><strong className="text-sm">Recent Notifications</strong><button onClick={markAll} disabled={markingAll || unread === 0} className="text-xs text-primary disabled:opacity-50">{markingAll ? 'Marking...' : 'Mark all as read'}</button></div>
      {feedback && <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{feedback}</div>}
      <div className="max-h-96 overflow-y-auto">
        {loading && notifications.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">Loading notifications...</div> :
        notifications.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</div> : notifications.map((item) => <button key={item.id} onClick={() => markRead(item)} className={`block w-full border-b border-border/60 px-4 py-3 text-left hover:bg-muted/40 ${item.is_read ? '' : 'bg-primary/5'}`}><div className="text-sm font-medium">{item.title || 'Notification'}</div><div className="mt-1 text-xs text-muted-foreground">{item.message || ''}</div>{!item.is_read && <span className="mt-1 inline-block text-[10px] text-primary">Mark as read</span>}</button>)}
      </div>
      {isAdmin && <a href="/admin/notifications" className="block px-4 py-2 text-center text-xs text-primary">Admin notification management</a>}
    </div>}
    </div>
  );
}
