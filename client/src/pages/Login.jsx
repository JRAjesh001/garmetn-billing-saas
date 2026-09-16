import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";

export default function Login() {
  const { setMe, toast } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api("/api/login", {
        method: "POST",
        body: { username, password },
      });
      if (r.operator) {
        window.location.href = "/platform";
        return;
      } // platform owner/operator → console
      setMe(r.user);
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(135deg,#16233b 0%,#1d2d4a 55%,#4f46e5 130%)",
        padding: "1rem",
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 430,
          border: "none",
          borderRadius: "1rem",
          boxShadow: "0 24px 60px rgba(2,6,23,.45)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg,#4f46e5,#7c3aed)",
            color: "#fff",
            padding: "1.8rem 2rem 1.5rem",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              margin: "0 auto .8rem",
              background: "rgba(255,255,255,.15)",
              border: "1px solid rgba(255,255,255,.25)",
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.7rem",
            }}
          >
            <i className="bi bi-shop"></i>
          </div>
          <h4 className="mb-0 fw-bold">Garment Billing System</h4>
          <div className="small opacity-75 mt-1"></div>
        </div>
        <div className="card-body p-4">
          {error && (
            <div className="alert alert-danger py-2 small">{error}</div>
          )}
          <form onSubmit={submit} autoComplete="off">
            <div className="mb-3">
              <label className="form-label small fw-semibold">Username</label>
              <div className="input-group">
                <span className="input-group-text">
                  <i className="bi bi-person"></i>
                </span>
                <input
                  className="form-control"
                  placeholder="Enter username"
                  autoFocus
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="form-label small fw-semibold">Password</label>
              <div className="input-group">
                <span className="input-group-text">
                  <i className="bi bi-lock"></i>
                </span>
                <input
                  type={showPw ? "text" : "password"}
                  className="form-control"
                  placeholder="Enter password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span
                  className="input-group-text"
                  style={{ cursor: "pointer" }}
                  onClick={() => setShowPw((s) => !s)}
                >
                  <i className={`bi bi-eye${showPw ? "-slash" : ""}`}></i>
                </span>
              </div>
            </div>
            <button
              className="btn btn-lg w-100 text-white"
              style={{ background: "#4f46e5", fontWeight: 600 }}
              disabled={busy}
            >
              {busy ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Signing in…
                </>
              ) : (
                <>
                  <i className="bi bi-box-arrow-in-right me-2"></i>Sign In
                </>
              )}
            </button>
          </form>

          <div className="text-center small mt-3">
            New here?{" "}
            <Link to="/signup">Create your shop — free 14-day trial</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
