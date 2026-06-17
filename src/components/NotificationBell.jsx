import { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const notifs = await base44.entities.RailNotification.filter({ is_read: false });
        setUnread(notifs.length);
      } catch (e) { /* ignore */ }
    };
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Link to="/admin/notifications" className="relative p-2 rounded-lg hover:bg-muted transition-colors">
      <Bell className="w-5 h-5 text-muted-foreground" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive rounded-full text-[10px] font-bold text-white flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}
