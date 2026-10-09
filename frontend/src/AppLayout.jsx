import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { Shell, ToastStack } from "./components/ui.jsx";
import { api } from "./api.js";
import { flushQueue, pendingCount } from "./offline.js";

export default function AppLayout() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [banner, setBanner] = useState("");
  const [toasts, setToasts] = useState([]);

  function toast(text) {
    const id = Date.now();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  useEffect(() => {
    pendingCount().then(setPending);
    function onOff() {
      setOnline(false);
      toast("OFFLINE MODE — evidence stays on this device.");
    }
    async function onOn() {
      setOnline(true);
      const count = await pendingCount();
      if (count) {
        setBanner(`CONNECTION RESTORED — Synchronizing evidence…`);
        const result = await flushQueue(api);
        setBanner(`${result.synchronized} / ${result.total} records synchronized ✓`);
        toast("Synchronization complete.");
        setTimeout(() => setBanner(""), 5000);
      }
      setPending(await pendingCount());
    }
    window.addEventListener("offline", onOff);
    window.addEventListener("online", onOn);
    return () => {
      window.removeEventListener("offline", onOff);
      window.removeEventListener("online", onOn);
    };
  }, []);

  return (
    <Shell online={online} pending={pending} banner={banner}>
      <Outlet />
      <ToastStack toasts={toasts} />
    </Shell>
  );
}
