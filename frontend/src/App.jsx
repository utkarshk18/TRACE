import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth.jsx";
import { Protected } from "./components/Protected.jsx";
import { RoleGate } from "./components/RoleGate.jsx";
import AppLayout from "./AppLayout.jsx";
import Landing from "./pages/Landing.jsx";
import LoginPage from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import NewTest from "./pages/NewTest.jsx";
import EvidenceVault from "./pages/EvidenceVault.jsx";
import EvidenceDetail from "./pages/EvidenceDetail.jsx";
import VerifyPage from "./pages/Verify.jsx";
import AuditPage from "./pages/Audit.jsx";
import Profiles from "./pages/Profiles.jsx";
import Admin from "./pages/Admin.jsx";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </AuthProvider>
  );
}
