import React, { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import RoleProtectedRoute from "@/components/RoleProtectedRoute";
import AppErrorBoundary from "@/components/AppErrorBoundary";

// Page imports
// Dashboard removed — no longer used
const FreightTracker = React.lazy(() => import("@/pages/FreightTracker"));
const MovementDashboard = React.lazy(() => import("@/pages/MovementDashboard.jsx"));
const InwardMonitor = React.lazy(() => import("@/pages/InwardMonitor.jsx"));
const OutwardMonitor = React.lazy(() => import("@/pages/OutwardMonitor.jsx"));
const UploadCenter = React.lazy(() => import("@/pages/UploadCenter"));
const UploadHistory = React.lazy(() => import("@/pages/UploadHistory"));
const Notifications = React.lazy(() => import("@/pages/Notifications"));
const Settings = React.lazy(() => import("@/pages/Settings"));
const Login = React.lazy(() => import("@/pages/Login"));
const Signup = React.lazy(() => import("@/pages/Signup"));
const UserManagement = React.lazy(() => import("@/pages/UserManagement"));
const NotificationPreferences = React.lazy(() => import("@/pages/NotificationPreferences"));
const MasterManagement = React.lazy(() => import("@/pages/MasterManagement.jsx"));

const ADMIN_ROLES = ["super_admin", "admin"];
const USER_ROLES = ["user"];

const StationMasterLazy = React.lazy(() => import("@/pages/StationMaster.jsx"));

const AppLoader = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      <p className="text-sm text-muted-foreground">Loading RailFlow...</p>
    </div>
  </div>
);

const OPERATION_VIEWS = {
  "fois-reports": <FreightTracker />,
  "inward-dashboard": <MovementDashboard direction="Inward" />,
  "outward-dashboard": <MovementDashboard direction="Outward" />,
  inward: <InwardMonitor />,
  outward: <OutwardMonitor />,
  "inward-monitor": <InwardMonitor />,
  "outward-monitor": <OutwardMonitor />,
};

function OperationsKeepAlive() {
  const { operation } = useParams();
  const [visited, setVisited] = React.useState(() => new Set([operation]));

  React.useEffect(() => {
    if (!OPERATION_VIEWS[operation]) return;
    setVisited((current) => {
      if (current.has(operation)) return current;
      const next = new Set(current);
      next.add(operation);
      return next;
    });
  }, [operation]);

  if (!OPERATION_VIEWS[operation]) return <PageNotFound />;

  return Object.entries(OPERATION_VIEWS).map(([key, view]) =>
    visited.has(key) ? (
      <div key={key} className={key === operation ? "block" : "hidden"} aria-hidden={key !== operation}>
        {view}
      </div>
    ) : null
  );
}

const RoleHomeRedirect = () => {
  const { user, isAuthenticated } = useAuth();

  // Requirement: unauthenticated must always land on /login
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return ADMIN_ROLES.includes(user?.role) ? (
    <Navigate to="/admin/fois-reports" replace />
  ) : (
    <Navigate to="/fois-reports" replace />
  );
};

const AuthenticatedApp = () => {
  const { isAuthenticated, isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();
  const location = useLocation();

  React.useEffect(() => {
    if (!isAuthenticated) return undefined;
    const preload = () => {
      void Promise.allSettled([
        import("@/pages/FreightTracker"),
        import("@/pages/MovementDashboard.jsx"),
        import("@/pages/InwardMonitor.jsx"),
        import("@/pages/OutwardMonitor.jsx"),
      ]);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(preload, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preload, 300);
    return () => window.clearTimeout(id);
  }, [isAuthenticated]);

  if (location.pathname === "/login" || location.pathname === "/signup") {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
      </Routes>
    );
  }

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading RailFlow...</p>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === "user_not_registered")
      return <UserNotRegisteredError />;
    if (authError.type === "auth_required")
      return <Navigate to="/login" replace />;
  }

  return (
    <Routes>
      <Route
        element={
          <ProtectedRoute
            unauthenticatedElement={<Navigate to="/login" replace />}
          />
        }
      >
        <Route path="/" element={<RoleHomeRedirect />} />

        {/* ==========================================================================
            SECURE ADMINISTRATIVE PANEL WORKSPACE ROUTES (ADMIN ONLY)
           ========================================================================== */}
        <Route
          element={
            <RoleProtectedRoute
              allowedRoles={ADMIN_ROLES}
              redirectTo="/dashboard"
            />
          }
        >
          <Route element={<Layout />}>
            <Route path="/admin" element={<Navigate to="/admin/fois-reports" replace />} />
            <Route path="/admin/upload" element={<UploadCenter />} />
            <Route path="/admin/upload-history" element={<UploadHistory />} />
            <Route path="/admin/dashboard" element={<Navigate to="/admin/inward-dashboard" replace />} />
            <Route path="/admin/freight" element={<Navigate to="/admin/fois-reports" replace />} />
            <Route path="/admin/:operation" element={<OperationsKeepAlive />} />
            <Route path="/admin/notifications" element={<Notifications />} />

            <Route
              path="/admin/station-master"
              element={
                <Suspense
                  fallback={
                    <div className="fixed inset-0 flex items-center justify-center bg-background">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                        <p className="text-sm text-muted-foreground">
                          Loading Station Master...
                        </p>
                      </div>
                    </div>
                  }
                >
                  <StationMasterLazy />
                </Suspense>
              }
            />

            {/* ⚙️ CORE LOCK: Master Management successfully mapped inside secure layout route */}
            <Route path="/admin/master-management" element={<Navigate to="/admin/master-management/state" replace />} />
            <Route path="/admin/master-management/:masterKey" element={<MasterManagement />} />

            <Route path="/admin/users" element={<UserManagement />} />
            <Route path="/admin/settings" element={<Settings />} />
          </Route>
        </Route>

        {/* ==========================================================================
            REGULAR USER WORKSPACE PANEL ROUTES (USER STANDARD LOGS)
           ========================================================================== */}
        <Route
          element={
            <RoleProtectedRoute allowedRoles={USER_ROLES} redirectTo="/admin" />
          }
        >
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Navigate to="/inward-dashboard" replace />} />
            <Route path="/search" element={<Navigate to="/fois-reports" replace />} />
            <Route path="/:operation" element={<OperationsKeepAlive />} />
            <Route
              path="/notification-preferences"
              element={<NotificationPreferences />}
            />
          </Route>
        </Route>

        {/* Dynamic Nav Fallbacks & Legacy Redirections Engine */}
        <Route path="/tracker" element={<Navigate to="/fois-reports" replace />} />
        <Route path="/upload" element={<Navigate to="/admin/upload" replace />} />
        <Route path="/notifications" element={<Navigate to="/admin/notifications" replace />} />
        <Route path="/settings" element={<Navigate to="/admin/settings" replace />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <Suspense fallback={<AppLoader />}>
              <AuthenticatedApp />
            </Suspense>
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </AppErrorBoundary>
  );
}

export default App;
