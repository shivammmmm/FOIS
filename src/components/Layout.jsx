import { useEffect, useRef, useState } from "react";
import { Link, useLocation, Outlet, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Train,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  GitBranch,
  Globe,
  Map,
  MapPinned,
  Package,
  TrainFront,
  Upload,
  History,
  Settings,
  Menu,
  X,
  Users,
} from "lucide-react";
import GlobalSearch from "./GlobalSearch";
import NotificationBell from "./NotificationBell";
import { useAuth } from "@/lib/AuthContext";

const masterSubItems = [
  { path: "/admin/master-management/state", label: "State Master", icon: MapPinned },
  { path: "/admin/master-management/district", label: "District Master", icon: Map },
  { path: "/admin/master-management/station", label: "Station Master", icon: TrainFront },
  { path: "/admin/master-management/zone", label: "Zone Master", icon: Globe },
  { path: "/admin/master-management/division", label: "Division Master", icon: GitBranch },
  { path: "/admin/master-management/commodity", label: "Commodity Master", icon: Package },
  { path: "/admin/master-management/company", label: "Company Master", icon: Building2 },
  { path: "/admin/master-management/product", label: "Product Master", icon: Boxes },
];

// ⚙️ ADMINISTRATIVE NAVIGATION MATRIX (ADMIN SCALED ONLY)
const adminNavItems = [
  {
    path: "/admin/master-management",
    label: "Master Management",
    icon: Settings,
    children: masterSubItems,
  }, // Fixed & Connected inside Admin Block
  { path: "/admin/upload", label: "Upload Excel", icon: Upload },
  { path: "/admin/upload-history", label: "Upload History", icon: History },
  { path: "/admin/fois-reports", label: "FOIS Reports", icon: Train },
  { path: "/admin/inward-dashboard", label: "Inward Dashboard", icon: BarChart3 },
  { path: "/admin/outward-dashboard", label: "Outward Dashboard", icon: BarChart3 },
  { path: "/admin/inward", label: "Inward Monitor", icon: ArrowDownToLine },
  { path: "/admin/outward", label: "Outward Monitor", icon: ArrowUpFromLine },
  { path: "/admin/users", label: "User Management", icon: Users },
  { path: "/admin/notifications", label: "Notifications", icon: Bell },
  { path: "/admin/settings", label: "Settings", icon: Settings },
];

// 👥 STANDARD USER NAVIGATION MATRIX (CLEAN HOUSEKEEPING)
const userNavItems = [
  { path: "/fois-reports", label: "FOIS Reports", icon: Train },
  { path: "/inward-monitor", label: "Inward Monitor", icon: ArrowDownToLine },
  { path: "/outward-monitor", label: "Outward Monitor", icon: ArrowUpFromLine },
  { path: "/inward-dashboard", label: "Inward Dashboard", icon: BarChart3 },
  { path: "/outward-dashboard", label: "Outward Dashboard", icon: BarChart3 },
  { path: "/notification-preferences", label: "Notification Settings", icon: Bell },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [masterMenuOpen, setMasterMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";
  const navItems = isAdmin ? adminNavItems : userNavItems;

  useEffect(() => {
    if (location.pathname.startsWith("/admin/master-management")) {
      setMasterMenuOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!profileOpen) return undefined;
    const close = (event) => {
      if (!profileRef.current?.contains(event.target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [profileOpen]);

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
          {navItems.map(({ path, label, icon: Icon, children }) => {
            const active = children
              ? location.pathname.startsWith(path)
              : location.pathname === path;

            if (children) {
              return (
                <div key={path} className="mb-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (active) {
                        setMasterMenuOpen(true);
                        return;
                      }

                      const nextOpen = !masterMenuOpen;
                      setMasterMenuOpen(nextOpen);
                      if (nextOpen) navigate(children[0].path);
                    }}
                    className={cn(
                      "flex w-[calc(100%-1rem)] items-center gap-3 mx-2 px-3 py-3 rounded-lg transition-all duration-200",
                      "text-sm font-semibold",
                      active
                        ? "bg-primary/20 text-white border border-primary/30 shadow-sm"
                        : "hover:bg-sidebar-accent hover:text-white"
                    )}
                    style={{ color: active ? "white" : "hsl(215,20%,70%)" }}
                    aria-expanded={masterMenuOpen}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors",
                        active ? "bg-primary/20" : "bg-white/5"
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-4 h-4 flex-shrink-0 transition-colors",
                          active && "text-primary"
                        )}
                        style={{ color: active ? "hsl(217,91%,65%)" : undefined }}
                      />
                    </span>
                    <span className="min-w-0 flex-1 text-left">{label}</span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 flex-shrink-0 transition-transform duration-200",
                        masterMenuOpen && "rotate-180"
                      )}
                    />
                  </button>
                  <div
                    className={cn(
                      "overflow-hidden transition-all duration-300 ease-out",
                      masterMenuOpen ? "max-h-[28rem] opacity-100" : "max-h-0 opacity-0"
                    )}
                  >
                    <div className="relative mx-2 mt-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 shadow-inner">
                      <span className="pointer-events-none absolute bottom-4 left-5 top-4 w-px rounded-full bg-blue-300/25" />
                      {children.map((child) => {
                        const childActive = location.pathname === child.path;
                        const ChildIcon = child.icon;
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            onClick={() => setOpen(false)}
                            className={cn(
                              "group relative flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 pl-8 text-xs transition-all duration-200",
                              childActive
                                ? "bg-blue-600 text-white font-bold shadow-md shadow-blue-950/30"
                                : "text-sidebar-foreground hover:bg-blue-500/10 hover:text-blue-100"
                            )}
                            style={{
                              color: childActive ? "white" : "hsl(215,20%,68%)",
                            }}
                          >
                            {childActive && (
                              <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-blue-300" />
                            )}
                            <span
                              className={cn(
                                "absolute left-[0.9rem] z-10 h-2.5 w-2.5 rounded-full border-2 transition-colors duration-200",
                                childActive
                                  ? "border-white bg-white"
                                  : "border-blue-300/60 bg-sidebar-background group-hover:border-blue-200 group-hover:bg-blue-200"
                              )}
                            />
                            <ChildIcon
                              className={cn(
                                "h-3.5 w-3.5 flex-shrink-0 transition-colors duration-200",
                                childActive
                                  ? "text-white"
                                  : "text-slate-400 group-hover:text-blue-200"
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate">{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

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
          <NotificationBell isAdmin={isAdmin} />
          <div ref={profileRef} className="relative">
            <button type="button" onClick={() => setProfileOpen((value) => !value)} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-muted" aria-label="Open profile">
            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
              <span className="text-xs font-semibold text-primary">
                {user?.full_name?.[0] || user?.username?.[0] || "U"}
              </span>
            </div>
            <span className="text-sm text-muted-foreground hidden md:block">
              {user?.full_name || user?.username || "User"}
            </span>
            </button>
            {profileOpen && <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-card p-4 shadow-xl">
              <div className="text-sm font-semibold text-foreground">Profile</div>
              <div className="mt-3 space-y-2 text-sm"><div><span className="text-xs text-muted-foreground">Username</span><div className="break-all font-medium">{user?.username || "-"}</div></div><div><span className="text-xs text-muted-foreground">Email</span><div className="break-all font-medium">{user?.email || "-"}</div></div><div><span className="text-xs text-muted-foreground">Role</span><div className="capitalize font-medium">{String(user?.role || "user").replaceAll("_", " ")}</div></div></div>
              <button type="button" onClick={logout} className="mt-4 w-full rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10">Logout</button>
            </div>}
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
