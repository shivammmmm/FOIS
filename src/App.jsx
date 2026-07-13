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
} from "react-router-dom";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import RoleProtectedRoute from "@/components/RoleProtectedRoute";

// Page imports
// Dashboard removed — no longer used
import FreightTracker from "@/pages/FreightTracker";
import MovementDashboard from "@/pages/MovementDashboard.jsx";
import InwardMonitor from "@/pages/InwardMonitor.jsx";
import OutwardMonitor from "@/pages/OutwardMonitor.jsx";
import UploadCenter from "@/pages/UploadCenter";
import UploadHistory from "@/pages/UploadHistory";
import Notifications from "@/pages/Notifications";
import Settings from "@/pages/Settings";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import UserManagement from "@/pages/UserManagement";
import NotificationPreferences from "@/pages/NotificationPreferences";
import MasterManagement from "@/pages/MasterManagement.jsx";

const ADMIN_ROLES = ["super_admin", "admin"];
const USER_ROLES = ["user"];

const StationMasterLazy = React.lazy(() => import("@/pages/StationMaster.jsx"));

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
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();
  const location = useLocation();

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
            <Route path="/admin/fois-reports" element={<FreightTracker />} />
            <Route path="/admin/freight" element={<Navigate to="/admin/fois-reports" replace />} />
            <Route path="/admin/inward-dashboard" element={<MovementDashboard direction="Inward" />} />
            <Route path="/admin/outward-dashboard" element={<MovementDashboard direction="Outward" />} />
            <Route path="/admin/inward" element={<InwardMonitor />} />
            <Route path="/admin/outward" element={<OutwardMonitor />} />
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
            <Route path="/inward-dashboard" element={<MovementDashboard direction="Inward" />} />
            <Route path="/outward-dashboard" element={<MovementDashboard direction="Outward" />} />
            <Route path="/fois-reports" element={<FreightTracker />} />
            <Route path="/search" element={<Navigate to="/fois-reports" replace />} />
            <Route path="/inward-monitor" element={<InwardMonitor />} />
            <Route path="/outward-monitor" element={<OutwardMonitor />} />
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
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
