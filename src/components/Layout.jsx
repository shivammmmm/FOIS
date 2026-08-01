import { useEffect, useRef, useState } from "react";
import { Link, useLocation, Outlet, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Train,
  AlertTriangle,
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
  X,
  Users,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import GlobalSearch from "./GlobalSearch";
import NotificationBell from "./NotificationBell";
import { useAuth } from "@/lib/AuthContext";
import { loadMasterHierarchy } from "@/utils/masterHierarchy";

const masterSubItems = [
  { path: "/admin/master-management/state", label: "State Master", icon: MapPinned },
  { path: "/admin/master-management/district", label: "District Master", icon: Map },
  { path: "/admin/master-management/station", label: "Station Master", icon: TrainFront },
  { path: "/admin/master-management/zone", label: "Zone Master", icon: Globe },
  { path: "/admin/master-management/division", label: "Division Master", icon: GitBranch },
  { path: "/admin/master-management/commodity", label: "Commodity Master", icon: Package },
  { path: "/admin/master-management/company", label: "Company Master", icon: Building2 },
  { path: "/admin/master-management/product", label: "Product Master", icon: Boxes },
  { path: "/admin/unmapped-codes", label: "Unmapped Codes", icon: AlertTriangle },
];

// ⚙️ ADMINISTRATIVE NAVIGATION MATRIX (ADMIN SCALED ONLY)
const adminNavItems = [
  {
    path: "/admin/master-management",
    label: "Master Management",
    icon: Settings,
    children: masterSubItems,
  },
  { path: "/admin/upload", label: "Upload Center", icon: Upload },
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

// 👥 STANDARD USER NAVIGATION MATRIX
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [masterMenuOpen, setMasterMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const isAdmin = user?.role === "super_admin" || user?.role === "admin";
  const navItems = isAdmin ? adminNavItems : userNavItems;

  useEffect(() => {
    if (
      location.pathname.startsWith("/admin/master-management") ||
      location.pathname.startsWith("/admin/unmapped-codes")
    ) {
      setMasterMenuOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    loadMasterHierarchy();
  }, []);

  useEffect(() => {
    if (!profileOpen) return undefined;
    const close = (event) => {
      if (!profileRef.current?.contains(event.target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [profileOpen]);

  return (
    <div className="flex h-screen bg-slate-100/60 overflow-hidden font-inter text-slate-900 antialiased selection:bg-blue-500/20 selection:text-blue-600">
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Royal Blue & Clean Glass Light Sidebar */}
      <aside
        className={cn(
          "fixed lg:relative z-50 flex flex-col h-full bg-slate-50/95 text-slate-900 border-r border-slate-200/80 transition-all duration-300 ease-in-out shadow-xs flex-shrink-0",
          open ? "translate-x-0 w-64" : "-translate-x-full lg:translate-x-0",
          sidebarCollapsed
            ? "lg:w-0 lg:-translate-x-full lg:border-none lg:opacity-0 overflow-hidden"
            : "lg:w-64 lg:opacity-100"
        )}
      >
        {/* Logo & Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-slate-200/80 bg-white/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 p-0.5 shadow-md shadow-blue-500/20">
              <div className="w-full h-full bg-white rounded-[10px] flex items-center justify-center">
                <Train className="w-5 h-5 text-blue-600" />
              </div>
            </div>
            <div>
              <div className="text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-1.5">
                RailFlow
                <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-blue-600/10 text-blue-600 border border-blue-600/20">
                  FOIS
                </span>
              </div>
              <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                {isAdmin ? "Admin Workspace" : "User Workspace"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
              title="Collapse Sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
              title="Close Mobile Sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Section */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Navigation Menu
          </div>

          {navItems.map(({ path, label, icon: Icon, children }) => {
            const active = children
              ? location.pathname.startsWith(path) || location.pathname.startsWith("/admin/unmapped-codes")
              : location.pathname === path;

            if (children) {
              return (
                <div key={path} className="mb-1">
                  <button
                    type="button"
                    onClick={() => {
                      const nextOpen = !masterMenuOpen;
                      setMasterMenuOpen(nextOpen);
                      if (nextOpen && !active) navigate(children[0].path);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer group",
                      "text-xs font-semibold tracking-wide",
                      active
                        ? "bg-blue-600 text-white font-bold shadow-md shadow-blue-600/25"
                        : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
                    )}
                    aria-expanded={masterMenuOpen}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors",
                        active ? "bg-white/20 text-white" : "bg-slate-200/80 text-slate-500 group-hover:bg-slate-300/80 group-hover:text-slate-900"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-left truncate">{label}</span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 flex-shrink-0 transition-transform duration-200",
                        active ? "text-white" : "text-slate-400 group-hover:text-slate-700",
                        masterMenuOpen && "rotate-180"
                      )}
                    />
                  </button>

                  <div
                    className={cn(
                      "overflow-hidden transition-all duration-300 ease-in-out",
                      masterMenuOpen ? "max-h-[32rem] opacity-100 mt-1" : "max-h-0 opacity-0"
                    )}
                  >
                    <div className="relative ml-3 pl-3 border-l-2 border-blue-500/30 space-y-0.5 py-1">
                      {children.map((child) => {
                        const childActive = location.pathname === child.path;
                        const ChildIcon = child.icon;
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            onClick={() => setOpen(false)}
                            className={cn(
                              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer",
                              childActive
                                ? "bg-blue-600 text-white font-bold shadow-sm shadow-blue-600/20"
                                : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
                            )}
                          >
                            <ChildIcon
                              className={cn(
                                "h-3.5 w-3.5 flex-shrink-0 transition-colors",
                                childActive ? "text-white" : "text-slate-400"
                              )}
                            />
                            <span className="truncate">{child.label}</span>
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
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer group",
                  "text-xs font-semibold tracking-wide",
                  active
                    ? "bg-blue-600 text-white font-bold shadow-md shadow-blue-600/25"
                    : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors",
                    active ? "bg-white/20 text-white" : "bg-slate-200/80 text-slate-500 group-hover:bg-slate-300/80 group-hover:text-slate-900"
                  )}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span className="truncate">{label}</span>
                {path.endsWith("/notifications") && <NotificationDot />}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-slate-100/60">
        {/* Sleek Header Topbar */}
        <header className="flex items-center justify-between gap-4 px-4 lg:px-6 py-3 border-b border-slate-200/80 bg-white/90 backdrop-blur-md flex-shrink-0 shadow-xs z-10">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Desktop / Mobile Sidebar Toggle Button */}
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 1024) {
                  setOpen(!open);
                } else {
                  setSidebarCollapsed(!sidebarCollapsed);
                }
              }}
              className="p-2 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs"
              title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-5 h-5 text-blue-600" />
              ) : (
                <PanelLeftClose className="w-5 h-5" />
              )}
            </button>

            {/* Global Search Bar */}
            <div className="max-w-md flex-1">
              <GlobalSearch />
            </div>
          </div>

          {/* Right Header Status Controls */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Notification Bell */}
            <NotificationBell isAdmin={isAdmin} />

            {/* User Profile Button */}
            <div ref={profileRef} className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((value) => !value)}
                className="flex items-center gap-2.5 p-1.5 pl-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 transition-all cursor-pointer shadow-xs"
                aria-label="Open profile menu"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-xs">
                  {user?.full_name?.[0] || user?.username?.[0] || "U"}
                </div>
                <div className="hidden md:flex flex-col text-left">
                  <span className="text-xs font-semibold text-slate-800 leading-none">
                    {user?.full_name || user?.username || "User"}
                  </span>
                  <span className="text-[10px] text-slate-500 leading-tight mt-0.5 capitalize">
                    {String(user?.role || "User").replaceAll("_", " ")}
                  </span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden md:block" />
              </button>

              {/* Profile Modal Dropdown */}
              {profileOpen && (
                <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl animate-scale-in">
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-base shadow-sm">
                      {user?.full_name?.[0] || user?.username?.[0] || "U"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900 truncate">
                        {user?.full_name || user?.username || "User"}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{user?.email || "No email"}</div>
                    </div>
                  </div>

                  <div className="py-3 space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Username</span>
                      <span className="font-semibold text-slate-900 truncate">{user?.username || "-"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Account Role</span>
                      <span className="font-bold text-blue-600 capitalize">
                        {String(user?.role || "user").replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Status</span>
                      <span className="font-semibold text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Authenticated
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={logout}
                    className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-500/20 transition-all cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    Log Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content Outlet */}
        <main className="flex-1 overflow-y-auto bg-slate-100/60">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NotificationDot() {
  return <span className="ml-auto w-2 h-2 rounded-full bg-red-500 pulse-dot" />;
}
