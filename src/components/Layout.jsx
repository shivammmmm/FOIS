import { useState } from "react";
import { Link, useLocation, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Train,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Upload,
  FileText,
  Settings,
  Menu,
  X,
  Users,
} from "lucide-react";
import GlobalSearch from "./GlobalSearch";
import NotificationBell from "./NotificationBell";
import { useAuth } from "@/lib/AuthContext";

// ⚙️ ADMINISTRATIVE NAVIGATION MATRIX (ADMIN SCALED ONLY)
const adminNavItems = [
  { path: "/admin", label: "Admin Dashboard", icon: LayoutDashboard },
  {
    path: "/admin/master-management",
    label: "Master Management",
    icon: Settings,
  }, // Fixed & Connected inside Admin Block
  { path: "/admin/upload", label: "Upload Excel", icon: Upload },
  { path: "/admin/freight", label: "Freight Records", icon: Train },
  { path: "/admin/inward", label: "Inward Monitor", icon: ArrowDownToLine },
  { path: "/admin/outward", label: "Outward Monitor", icon: ArrowUpFromLine },
  { path: "/admin/station-master", label: "Station Master", icon: FileText },
  { path: "/admin/users", label: "User Management", icon: Users },
  { path: "/admin/notifications", label: "Notifications", icon: Bell },
  { path: "/admin/settings", label: "Settings", icon: Settings },
];

// 👥 STANDARD USER NAVIGATION MATRIX (CLEAN HOUSEKEEPING)
const userNavItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/search", label: "Search", icon: Train },
  { path: "/inward-monitor", label: "Inward Monitor", icon: ArrowDownToLine }, // Connected seamlessly to User Routes
  { path: "/outward-monitor", label: "Outward Monitor", icon: ArrowUpFromLine }, // Connected seamlessly to User Routes
  { path: "/notification-preferences", label: "Notifications", icon: Bell },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";
  const navItems = isAdmin ? adminNavItems : userNavItems;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:relative z-30 flex flex-col h-full border-r border-sidebar-border transition-transform duration-300",
          "w-60 flex-shrink-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={{ backgroundColor: "hsl(222, 47%, 14%)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <Train className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-white leading-tight">
              RailFlow
            </div>
            <div
              className="text-xs leading-tight"
              style={{ color: "hsl(215,20%,65%)" }}
            >
              {isAdmin ? "Admin Panel" : "User Panel"}
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden text-sidebar-foreground hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {navItems.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg mb-0.5 transition-all duration-150",
                  "text-sm font-medium",
                  active
                    ? "bg-primary/20 text-white border border-primary/30"
                    : "hover:bg-sidebar-accent hover:text-white"
                )}
                style={{ color: active ? "white" : "hsl(215,20%,70%)" }}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 flex-shrink-0",
                    active && "text-primary"
                  )}
                  style={{ color: active ? "hsl(217,91%,65%)" : undefined }}
                />
                <span>{label}</span>
                {path.endsWith("/notifications") && <NotificationDot />}
              </Link>
            );
          })}
        </nav>

        {/* Upload reminder */}
        {isAdmin && (
          <div
            className="mx-3 mb-4 p-3 rounded-lg border"
            style={{
              borderColor: "rgba(245,158,11,0.3)",
              background: "rgba(245,158,11,0.07)",
            }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: "rgb(251,191,36)" }}
            >
              Next Upload Due
            </div>
            <div
              className="text-xs mt-0.5"
              style={{ color: "hsl(215,20%,60%)" }}
            >
              Upload FOIS data every 3h
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <header className="flex items-center gap-4 px-4 lg:px-6 py-3 border-b border-border bg-card flex-shrink-0 shadow-sm">
          {/* Hamburger */}
          <button
            onClick={() => setOpen(true)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex-1">
            <GlobalSearch />
          </div>
          {isAdmin && <NotificationBell />}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
              <span className="text-xs font-semibold text-primary">
                {user?.full_name?.[0] || user?.username?.[0] || "U"}
              </span>
            </div>
            <span className="text-sm text-muted-foreground hidden md:block">
              {user?.full_name || user?.username || "User"}
            </span>
          </div>
        </header>

        {/* Logout (Admin + User) */}
        <div className="px-4 py-2 border-b border-border bg-card">
          <button
            onClick={logout}
            className="inline-flex items-center justify-center rounded-lg bg-muted px-3 py-2 text-sm font-medium hover:bg-muted/80 transition-colors"
            title="Logout"
          >
            Logout
          </button>
        </div>

        {/* Page */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NotificationDot() {
  return (
    <span className="ml-auto w-2 h-2 rounded-full bg-destructive pulse-dot" />
  );
}
