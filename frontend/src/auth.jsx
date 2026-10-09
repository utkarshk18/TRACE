import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("trace_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    api("/auth/me")
      .then((d) => {
        setUser(d.user);
        localStorage.setItem("trace_user", JSON.stringify(d.user));
      })
      .catch(() => {
        localStorage.removeItem("trace_token");
        localStorage.removeItem("trace_user");
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      async login(email, password) {
        const data = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        localStorage.setItem("trace_token", data.accessToken);
        localStorage.setItem("trace_user", JSON.stringify(data.user));
        setUser(data.user);
        return data.user;
      },
      logout() {
        localStorage.removeItem("trace_token");
        localStorage.removeItem("trace_user");
        setUser(null);
      },
    }),
    [user, ready]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
