import { useState } from "react";
import { Link } from "react-router-dom";
import UsersAdmin from "../components/admin/UsersAdmin";
import DropdownsAdmin from "../components/admin/DropdownsAdmin";
import StoresAdmin from "../components/admin/StoresAdmin";
import EventsAdmin from "../components/admin/EventsAdmin";
import PermissionsAdmin from "../components/admin/PermissionsAdmin";

type Tab = "users" | "permissions" | "dropdowns" | "stores" | "events";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="admin-page">
      <header className="admin-header">
        <Link to="/" className="link-btn">← Orders</Link>
        <h1>Admin</h1>
        <div className="admin-tabs">
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Users</button>
          <button className={tab === "permissions" ? "active" : ""} onClick={() => setTab("permissions")}>Permissions</button>
          <button className={tab === "dropdowns" ? "active" : ""} onClick={() => setTab("dropdowns")}>Dropdowns</button>
          <button className={tab === "stores" ? "active" : ""} onClick={() => setTab("stores")}>Stores</button>
          <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>Webhooks</button>
        </div>
      </header>
      <div className="admin-body">
        {tab === "users" && <UsersAdmin />}
        {tab === "permissions" && <PermissionsAdmin />}
        {tab === "dropdowns" && <DropdownsAdmin />}
        {tab === "stores" && <StoresAdmin />}
        {tab === "events" && <EventsAdmin />}
      </div>
    </div>
  );
}
