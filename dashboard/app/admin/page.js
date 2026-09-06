"use client";

import { useEffect, useState } from "react";
import { apiGetAdminOverview, apiSwitchContext } from "../../src/auth-client";

const cardStyle = {
	background: "rgba(255,255,255,0.04)",
	border: "1px solid rgba(255,255,255,0.08)",
	borderRadius: 12,
	padding: "18px 20px",
};

function StatCard({ label, value }) {
	return (
		<div style={cardStyle}>
			<div style={{ fontSize: 12, color: "#9a9a9a", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
			<div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{value}</div>
		</div>
	);
}

function fmtDate(s) {
	if (!s) return "—";
	const d = new Date(s);
	return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export default function AdminOverviewPage() {
	const [data, setData] = useState(null);
	const [error, setError] = useState("");
	const [switching, setSwitching] = useState("");

	useEffect(() => {
		let cancelled = false;
		apiGetAdminOverview()
			.then((d) => { if (!cancelled) setData(d); })
			.catch((err) => { if (!cancelled) setError(err.message || "Failed to load."); });
		return () => { cancelled = true; };
	}, []);

	// Reuses the same switch-context mechanism the org-switcher header dropdown
	// already uses (POST /api/auth/switch-context, also super_admin-gated) —
	// this hands the super_admin the REAL dashboard (jobs, candidates, Kanban,
	// analytics, team, every existing feature) scoped to the chosen org, rather
	// than a second, more limited read-only view built from scratch.
	async function openOrg(orgId) {
		setSwitching(orgId);
		try {
			await apiSwitchContext(orgId);
			// A full reload, not a client-side push — matches org-switcher.ts's
			// own post-switch behavior exactly. active_org_id is a cookie the
			// vanilla-JS dashboard mount reads fresh on boot; a soft nav would
			// leave the already-mounted dashboard scoped to the old org.
			window.location.href = "/dashboard";
		} catch (err) {
			setSwitching("");
			setError(err.message || "Could not switch to that organisation.");
		}
	}

	return (
		<div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e8e8e8", fontFamily: "system-ui, sans-serif", padding: "32px 40px" }}>
			<h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Super Admin</h1>
			<p style={{ color: "#9a9a9a", marginBottom: 28 }}>Platform-wide overview across every organisation.</p>

			{error && <p style={{ color: "#f87171" }}>{error}</p>}
			{!data && !error && <p style={{ color: "#9a9a9a" }}>Loading…</p>}

			{data && (
				<>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 32 }}>
						<StatCard label="Organisations" value={data.organisation_count} />
						<StatCard label="Users" value={data.user_count} />
						<StatCard label="Jobs" value={data.job_count} />
						<StatCard label="Published Jobs" value={data.published_job_count} />
						<StatCard label="Applicants" value={data.applicant_count} />
					</div>

					<div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
						<div style={cardStyle}>
							<h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Organisations</h2>
							<p style={{ fontSize: 12, color: "#9a9a9a", marginBottom: 12 }}>Click a row to open that organisation's full dashboard — jobs, candidates, analytics, team, everything.</p>
							<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
								<thead>
									<tr style={{ textAlign: "left", color: "#9a9a9a", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
										<th style={{ padding: "6px 8px" }}>Name</th>
										<th style={{ padding: "6px 8px" }}>Jobs</th>
										<th style={{ padding: "6px 8px" }}>Created</th>
										<th style={{ padding: "6px 8px" }}></th>
									</tr>
								</thead>
								<tbody>
									{data.organisations.map((o) => (
										<tr
											key={o.id}
											onClick={() => openOrg(o.id)}
											style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer", opacity: switching && switching !== o.id ? 0.5 : 1 }}
										>
											<td style={{ padding: "6px 8px" }}>{o.name}</td>
											<td style={{ padding: "6px 8px" }}>{o.job_count}</td>
											<td style={{ padding: "6px 8px" }}>{fmtDate(o.created_at)}</td>
											<td style={{ padding: "6px 8px", color: "#2dd4bf" }}>{switching === o.id ? "Opening…" : "Open →"}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						<div style={cardStyle}>
							<h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Recent Users</h2>
							{data.recent_users.map((u) => (
								<div key={u.id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
									<div style={{ fontWeight: 600 }}>{u.name}</div>
									<div style={{ color: "#9a9a9a" }}>{u.email} · {u.user_type}</div>
								</div>
							))}
						</div>
					</div>
				</>
			)}
		</div>
	);
}
