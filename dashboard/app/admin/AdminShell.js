"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiMe, isAuthed, clearAuthed } from "../../src/auth-client";

// Same "checking → authed/rejected" phase pattern as DashboardShell.js, plus
// one extra gate: user_type must be super_admin, not just authenticated.
// The backend 403s /api/admin/* regardless (admin.py's _require_super_admin) —
// this is a redirect for UX, not the actual security boundary.
const UNAUTHED_RE = /401|not authenticated|unauthor|credential|user not found/i;

function VerifyingScreen() {
	return (
		<div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "#0a0a0a", color: "#9a9a9a", fontFamily: "system-ui, sans-serif" }}>
			<div style={{ textAlign: "center" }}>
				<div style={{ width: 34, height: 34, margin: "0 auto 14px", borderRadius: "50%", border: "2px solid rgba(45,212,191,0.2)", borderTopColor: "#2dd4bf", animation: "ih-admin-spin 0.8s linear infinite" }} />
				<style>{"@keyframes ih-admin-spin{to{transform:rotate(360deg)}}"}</style>
				<p>Verifying access…</p>
			</div>
		</div>
	);
}

export default function AdminShell({ children }) {
	const router = useRouter();
	const [phase, setPhase] = useState("checking");

	useEffect(() => {
		let cancelled = false;
		const optimistic = isAuthed();

		apiMe()
			.then((me) => {
				if (cancelled) return;
				if (!me || me.user_type !== "super_admin") {
					router.replace("/dashboard");
					return;
				}
				setPhase("authed");
			})
			.catch((err) => {
				if (cancelled) return;
				const msg = (err && err.message) || "";
				if (UNAUTHED_RE.test(msg) || !optimistic) {
					clearAuthed();
					router.replace("/login");
				}
			});

		return () => {
			cancelled = true;
		};
	}, [router]);

	if (phase !== "authed") return <VerifyingScreen />;
	return children;
}
