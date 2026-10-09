import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

const empty = {
  name: "",
  slug: "",
  version: "1.0",
  calibration: "CIELAB",
  status: "Active",
  uncertaintyThreshold: 0.72,
  positiveLab: { L: 50, a: 20, b: 10 },
  negativeLab: { L: 80, a: 2, b: 8 },
  notes: "Demo / synthetic calibration profile. Not a validated forensic threshold.",
};

export default function Profiles() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function load() {
    api("/profiles")
      .then((d) => setProfiles(d.profiles))
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function create(e) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      await api("/profiles", { method: "POST", body: JSON.stringify(form) });
      setMsg("Profile stored.");
      setForm(empty);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleStatus(p) {
    setError("");
    const nextStatus = p.status === "Active" ? "Draft" : "Active";
    try {
      await api(`/profiles/${p.slug}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Test profiles</h1>
      <p className="lede">Demo ranges only. These are not validated laboratory thresholds.</p>
      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
      <div className="grid-12">
        {profiles.map((p) => (
          <section className="card span-6" key={p.slug}>
            <h2>Test profile</h2>
            <p>Profile: {p.name}</p>
            <p>Version: {p.version}</p>
            <p>Calibration: {p.calibration}</p>
            <p>
              Status:{" "}
              <span className={`badge ${p.status === "Active" ? "ok" : "demo"}`}>
                {p.status}
              </span>
            </p>
            <p className="lede">{p.notes}</p>
            {user?.role === "ADMIN" && (
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  onClick={() => toggleStatus(p)}
                >
                  {p.status === "Active" ? "Switch to Draft" : "Activate"}
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
      {user?.role === "ADMIN" && (
        <form className="card" style={{ marginTop: 16 }} onSubmit={create}>
          <h2>Add demo profile</h2>
          <div className="filters">
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input" placeholder="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
            <input className="input" type="number" step="0.01" value={form.uncertaintyThreshold} onChange={(e) => setForm({ ...form, uncertaintyThreshold: Number(e.target.value) })} />
          </div>
          <button className="btn btn-primary" type="submit">Save profile</button>
          {msg && <p>{msg}</p>}
        </form>
      )}
    </>
  );
}
