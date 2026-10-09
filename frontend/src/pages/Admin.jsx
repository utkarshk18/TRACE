import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "ChangeMe!2026",
    role: "FIELD_OFFICER",
    unit: "Field Unit",
  });
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");

  function load() {
    Promise.all([api("/users"), api("/system/health")])
      .then(([u, h]) => {
        setUsers(u.users);
        setHealth(h);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function create(e) {
    e.preventDefault();
    setError("");
    try {
      await api("/users", { method: "POST", body: JSON.stringify(form) });
      setForm({
        name: "",
        email: "",
        password: "ChangeMe!2026",
        role: "FIELD_OFFICER",
        unit: "Field Unit",
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleStatus(u) {
    setError("");
    try {
      await api(`/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !u.active }),
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteUser(u) {
    if (!window.confirm(`Remove user account for ${u.name}?`)) return;
    setError("");
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Administration</h1>
      <p className="lede">Users, signing posture, and configuration. Least privilege: officers cannot enter this room.</p>
      {error && <div className="error-box">{error}</div>}
      <div className="grid-12">
        <section className="card span-8">
          <h2>Users</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Unit</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td className="mono">{u.email}</td>
                    <td>{u.role}</td>
                    <td>{u.unit}</td>
                    <td>
                      <span className={`badge ${u.active ? "ok" : "demo"}`}>
                        {u.active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <div className="btn-row">
                        <button
                          className="btn"
                          style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                          onClick={() => toggleStatus(u)}
                        >
                          {u.active ? "Disable" : "Enable"}
                        </button>
                        <button
                          className="btn"
                          style={{ padding: "4px 8px", fontSize: "0.8rem", color: "var(--positive)" }}
                          onClick={() => deleteUser(u)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form onSubmit={create} style={{ marginTop: 16 }}>
            <div className="filters">
              <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option>FIELD_OFFICER</option>
                <option>SUPERVISOR</option>
                <option>ADMIN</option>
              </select>
            </div>
            <button className="btn btn-primary" type="submit">Create user</button>
          </form>
        </section>
        <section className="card span-4">
          <h2>Signing configuration</h2>
          <p>Algorithm {health?.crypto?.algorithm}</p>
          <p>Hash {health?.crypto?.hashAlgorithm}</p>
          <p>{health?.crypto?.demoGeneratedKeys ? "Demo keypair generated at startup." : "Configured PEM keys in use."}</p>
        </section>
      </div>
    </>
  );
}
