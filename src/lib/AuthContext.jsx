import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext();

const localPublicSettings = {
  id: 'local',
  public_settings: {
    require_auth: true,
  },
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  const checkUserAuth = useCallback(async () => {
    try {
      setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(!!currentUser);
      setAuthError(null);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      return currentUser;
    } catch {
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      setAuthChecked(true);
      setAuthError({
        type: 'auth_required',
        message: 'Authentication required',
      });
      return null;
    }
  }, []);

  const checkAppState = useCallback(async () => {
    setIsLoadingPublicSettings(true);
    setAuthError(null);
    setAppPublicSettings(localPublicSettings);

    if (localPublicSettings.public_settings.require_auth) {
      await checkUserAuth();
    } else {
      setUser(null);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }

    setIsLoadingPublicSettings(false);
  }, [checkUserAuth]);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  const logout = () => {
    // Requirement: remove JWT + local/session data, clear auth state, redirect /login
    base44.auth.logout();
    try {
      window.sessionStorage.clear();
    } catch {}

    // If you have any app-specific cached user data, clear it as well.
    try {
      window.localStorage.removeItem('user');
    } catch {}

    setUser(null);
    setIsAuthenticated(false);
    setAuthError(null);
    setAuthChecked(false);
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        authChecked,
        logout,
        checkUserAuth,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
