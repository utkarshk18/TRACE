import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth.jsx";
import { Protected } from "./components/Protected.jsx";
import { RoleGate } from "./components/RoleGate.jsx";
import AppLayout from "./AppLayout.jsx";
import Landing from "./pages/Landing.jsx";

// Route-level code splitting for rapid page loading
const LoginPage = lazy(() => import("./pages/Login.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const NewTest = lazy(() => import("./pages/NewTest.jsx"));
const EvidenceVault = lazy(() => import("./pages/EvidenceVault.jsx"));
const EvidenceDetail = lazy(() => import("./pages/EvidenceDetail.jsx"));
const VerifyPage = lazy(() => import("./pages/Verify.jsx"));
const AuditPage = lazy(() => import("./pages/Audit.jsx"));
const Profiles = lazy(() => import("./pages/Profiles.jsx"));
const Admin = lazy(() => import("./pages/Admin.jsx"));

function PageLoader() {
  return (
    <div style={{ padding: "48px 24px", maxWidth: 1200, margin: "0 auto" }}>
      <div className="skeleton" style={{ height: 28, width: 220, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 180, width: "100%", borderRadius: 6 }} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Protected />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/test/new" element={<NewTest />} />
                <Route path="/evidence" element={<EvidenceVault />} />
                <Route path="/evidence/:id" element={<EvidenceDetail />} />
                <Route path="/verify" element={<VerifyPage />} />
                <Route path="/audit" element={<AuditPage />} />
                <Route path="/profiles" element={<Profiles />} />
                <Route
                  path="/admin"
                  element={
                    <RoleGate roles={["ADMIN"]}>
                      <Admin />
                    </RoleGate>
                  }
                />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
