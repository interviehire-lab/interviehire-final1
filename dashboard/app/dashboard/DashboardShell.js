"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRouter, usePathname, notFound } from "next/navigation";
import { initDashboardPage } from "../../src/dashboard/index";
import { STAGE_SLUG_TO_TAB } from "../../src/dashboard/job-stages";
import { html } from "../../src/html/dashboard-crystal";
import {
	apiMe,
	apiLogout,
	isAuthed,
	clearAuthed,
} from "../../src/auth-client";
import {
	apiGetPreferences,
	apiUpdatePreferences,
} from "../../src/dashboard/api.js";

const ROLE_LABEL = {
	super_admin: "Admin",
	org_admin: "Org. Admin",
	member: "Member",
};

// 401-style messages from the api client; anything else (network/backend down)
// is treated as "unverified" rather than "rejected".
const UNAUTHED_RE = /401|not authenticated|unauthor|credential|user not found/i;

function VerifyingScreen() {
	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				display: "grid",
				placeItems: "center",
				background: "#0a0a0a",
				color: "#9a9a9a",
				fontFamily: "'Outfit', system-ui, sans-serif",
				zIndex: 50,
			}}
		>
			<div style={{ textAlign: "center" }}>
				<div
					style={{
						width: 34,
						height: 34,
						margin: "0 auto 14px",
						borderRadius: "50%",
						border: "2px solid rgba(45,212,191,0.2)",
						borderTopColor: "#2dd4bf",
						animation: "ih-auth-spin 0.8s linear infinite",
					}}
				/>
				<div style={{ fontSize: "0.85rem", letterSpacing: "0.02em" }}>
					Verifying your session…
				</div>
			</div>
			<style>{"@keyframes ih-auth-spin{to{transform:rotate(360deg)}}"}</style>
		</div>
	);
}

// The vanilla dashboard surface. memo() + no props => renders exactly once,
// React never re-runs it — parent re-renders can't reset dangerouslySetInnerHTML
// and wipe the vanilla-JS-injected content (job cards, kanban, etc.).
const DashboardSurface = memo(function DashboardSurface() {
	useEffect(() => {
		const cleanup = initDashboardPage();

		// Small tick to let the vanilla mount bindings settle (mirrors original setTimeout(initMountBindings, 0))
		const timer = setTimeout(() => {
			window.__ihDashboardMounted = true;
			navigateToPath(window.location.pathname);
		}, 50);

		return () => {
			window.__ihDashboardMounted = false;
			clearTimeout(timer);
			if (cleanup) cleanup();
		};
	}, []);
	return <div dangerouslySetInnerHTML={{ __html: html }} />;
});

function navigateToPath(path, bareRetries = 0) {
	if (!path) return;
	const segments = path.split("/").filter(Boolean); // e.g. ['dashboard', 'jobs', 'JOB-123']
	if (segments[0] !== "dashboard") return;

	const sub = segments[1]; // e.g. 'jobs', 'analytics', etc.
	if (!sub) {
		// The bare path's default tab depends on whether this is a superadmin —
		// if /me hasn't resolved yet (IH_USER_TYPE still unset), wait rather than
		// guess "jobs" and correct later: a second pushUrl() a tick later can
		// silently lose a race with this one's still-pending rAF-queued push
		// (see pushUrl's _pushPending guard in url-sync.ts), leaving the URL/view
		// on the wrong tab. Bounded so a failed /me call can't hang this forever.
		if (window.IH_USER_TYPE === undefined && bareRetries < 20) {
			setTimeout(() => navigateToPath(path, bareRetries + 1), 50);
			return;
		}
		// A superadmin who hasn't explicitly opened an org yet lands on Platform
		// (their home state); everyone else — and a superadmin who has explicitly
		// opened an org — defaults to Jobs, same as always.
		if (window.IH_USER_TYPE === "super_admin" && !window.IH_ACTIVE_ORG_EXPLICIT) {
			window.navigateToSubtab?.("platform-overview");
		} else {
			window.navigateToTab?.("jobs");
		}
		return;
	}

	if (sub === "jobs") {
		const rawJobId = segments[2];
		const jobId =
			rawJobId && rawJobId.includes("--")
				? rawJobId.split("--").pop()
				: rawJobId;
		const subSub = segments[3];
		if (jobId) {
			if (subSub === "flow") {
				window.openJobFlowView?.(jobId);
			} else {
				window.navigateToJobStage?.(jobId, subSub || "overview");
			}
		} else {
			window.navigateToTab?.("jobs");
		}
	} else if (sub === "sourcing") {
		const rawJobId = segments[2];
		const jobId =
			rawJobId && rawJobId.includes("--")
				? rawJobId.split("--").pop()
				: rawJobId;
		if (jobId) {
			// Preserve the stage the flow was opened for across a hard refresh
			// (navigateToSourcing sanitizes anything unexpected back to null).
			const stage =
				typeof window !== "undefined"
					? new URLSearchParams(window.location.search).get("stage")
					: null;
			window.navigateToSourcing?.(jobId, stage);
		}
	} else if (sub === "settings") {
		window.navigateToSubtab?.("settings-general");
	} else if (sub === "platform") {
		// Platform has six sub-tabs (unlike Settings' one), so the third path
		// segment picks which one — /dashboard/platform/organisations etc.
		const validSubtabs = ["overview", "organisations", "users", "jobs", "interviews", "audit"];
		const subSub = segments[2];
		const subtabId = validSubtabs.includes(subSub) ? `platform-${subSub}` : "platform-overview";
		window.navigateToSubtab?.(subtabId);
	} else if (["analytics", "talent", "team", "career", "data-rights"].includes(sub)) {
		// "data-rights" was previously missing here (hard refresh silently fell
		// through to the default Jobs view); "swarm" was stale, left over from
		// the already-removed AI Swarm tab — both fixed while touching this array.
		window.navigateToTab?.(sub);
	}
}

/**
 * DashboardShell
 *
 * Shared auth-guarded wrapper in layout to persist vanilla DOM across route transitions.
 */
export default function DashboardShell({ children }) {
	const router = useRouter();
	const pathname = usePathname();
	// Start 'checking' on both server and first client render to avoid hydration mismatch.
	const [phase, setPhase] = useState("checking");
	const [user, setUser] = useState(null);

	// Optimistic upgrade — client-only, after hydration.
	useEffect(() => {
		if (isAuthed()) setPhase("authed");
	}, []);

	// Expose routing function to window for url-sync to push to next router
	useEffect(() => {
		window.__ihPushState = (url) => {
			router.push(url, { scroll: false });
		};
		window.__ihNavigateToPath = (path) => {
			navigateToPath(path);
		};
		return () => {
			delete window.__ihPushState;
			delete window.__ihNavigateToPath;
		};
	}, [router]);

	// Expose a global theme updater so the vanilla mount.js theme toggle can
	// persist its changes to the backend without importing React or the API client.
	useEffect(() => {
		window.IH_updateTheme = async (theme) => {
			await apiUpdatePreferences({ theme });
		};
		return () => {
			delete window.IH_updateTheme;
		};
	}, []);

	// Authoritative session check against the backend.
	useEffect(() => {
		let cancelled = false;
		const optimistic = isAuthed();

		apiMe()
			.then(async (me) => {
				if (cancelled) return;
				// Org-less accounts (new signups) must finish onboarding before the
				// dashboard — keeps every dashboard session scoped to a real org.
				if (me && me.onboarding_required) {
					router.replace("/onboarding");
					return;
				}

				setUser(me);

				// Load saved theme preference and apply it before the dashboard surface
				// renders — avoids a flash of wrong theme on initial load.
				const prefs = await apiGetPreferences();
				if (!cancelled && prefs && prefs.theme) {
					const savedTheme = prefs.theme;
					// Sync to localStorage so the vanilla mount.js reads the same value.
					try {
						localStorage.setItem("IntervieHire-theme", savedTheme);
					} catch {}
					if (savedTheme === "light") {
						document.body.classList.add("light-theme");
					} else if (savedTheme === "dark") {
						document.body.classList.remove("light-theme");
					} else if (savedTheme === "system") {
						const prefersLight =
							window.matchMedia &&
							window.matchMedia("(prefers-color-scheme: light)").matches;
						document.body.classList.toggle("light-theme", prefersLight);
					}
				}

				if (!cancelled) setPhase("authed");
			})
			.catch((err) => {
				if (cancelled) return;
				const msg = (err && err.message) || "";
				if (UNAUTHED_RE.test(msg)) {
					clearAuthed();
					router.replace("/login");
				} else if (!optimistic) {
					router.replace("/login");
				}
				// else: optimistic session + backend hiccup → stay on the dashboard.
			});

		return () => {
			cancelled = true;
		};
	}, [router]);

	// Pathname sync effect (runs on route transitions after initial mount)
	useEffect(() => {
		if (phase !== "authed" || !window.__ihDashboardMounted) return;
		navigateToPath(pathname);
	}, [pathname, phase]);

	// Reflect the signed-in user into the sidebar profile (runs after the surface
	// has mounted and /me has returned).
	useEffect(() => {
		if (phase !== "authed" || !user) return;
		const label = (user.name || user.username || "Account").trim();
		const nameEl = document.querySelector(".user-profile .user-name");
		const roleEl = document.querySelector(".user-profile .user-role");
		const avatarEl = document.querySelector(".user-profile .user-avatar");
		if (nameEl) nameEl.textContent = label;
		if (roleEl) roleEl.textContent = ROLE_LABEL[user.user_type] || "Member";
		if (avatarEl) avatarEl.textContent = (label[0] || "A").toUpperCase();

		const firstName = label.split(/\s+/)[0] || label;
		window.IH_USER_NAME = firstName;
		window.IH_USER_EMAIL = user.email || "";
		window.IH_USER_ID = user.id || null;
		window.IH_GOOGLE_DRIVE_CONNECTED = !!user.google_drive_connected;
		window.IH_ORG_NAME = (user.organisation_name || "").trim();
		window.IH_USER_TYPE = user.user_type || "member";
		window.IH_ACTIVE_ORG_ID = user.organisation_id || null;
		window.IH_ACTIVE_ORG_EXPLICIT = !!user.active_org_explicit;
		// Refresh the settings page's email/toggles now that the profile is known (covers
		// the case where the settings view is already open on initial load).
		if (typeof window.__ihSyncSettings === "function")
			window.__ihSyncSettings();
		// Globals are set — (re)build the super-admin org switcher now that the role
		// is known. Guarded: the vanilla engine registers this once mount.js runs.
		if (typeof window.__ihInitOrgSwitcher === "function")
			window.__ihInitOrgSwitcher();
		// Same for the Platform sidebar tab's visibility.
		if (typeof window.__ihInitPlatformTabVisibility === "function")
			window.__ihInitPlatformTabVisibility();

		// Personalise the "Created By" defaults so they show the signed-in user.
		const creatorInput = document.getElementById("job-creator-input");
		if (creatorInput) creatorInput.value = label;
		const creatorOpt = document.querySelector(
			'#jobs-creator-select option[value="me"]',
		);
		if (creatorOpt) creatorOpt.textContent = label;
		const titleEl = document.getElementById("header-main-title");
		if (
			titleEl &&
			/^good (morning|afternoon|evening)/i.test(
				(titleEl.textContent || "").trim(),
			)
		) {
			titleEl.textContent =
				typeof window.__ihBuildGreeting === "function"
					? window.__ihBuildGreeting()
					: `Good day, ${firstName}`;
		}
	}, [phase, user]);

	// Bind logout button.
	useEffect(() => {
		if (phase !== "authed") return;
		let timer;
		const bind = () => {
			const btn = document.querySelector(".user-profile .btn-logout");
			if (!btn) {
				timer = setTimeout(bind, 80);
				return;
			}
			if (btn.dataset.ihLogout) return;
			const fresh = btn.cloneNode(true);
			btn.replaceWith(fresh);
			fresh.dataset.ihLogout = "1";
			fresh.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopImmediatePropagation();
				fresh.setAttribute("disabled", "");
				try {
					await apiLogout();
				} catch {}
				router.replace("/login");
			});
		};
		timer = setTimeout(bind, 80);
		return () => clearTimeout(timer);
	}, [phase, router]);

	// /dashboard/random is intentionally blank — opt out of the dashboard surface
	// entirely (the surface always renders the default Jobs tab otherwise).
	if (pathname === "/dashboard/random") return children;

	if (phase !== "authed") return <VerifyingScreen />;

	// /dashboard/platform/* is a real backend-enforced (require_super_admin)
	// section, but every route under it always renders here client-side
	// regardless of role — navigateToPath's "platform" branch has no role
	// check, so a non-super-admin used to see an inline "Could not load:
	// Only available to Super Admins" error instead of a 404, revealing the
	// section exists. Match the bare /dashboard/platform/ path's behavior
	// (a genuine 404, since it has no page.js) for every subpath too, once
	// the role is actually known — `user` can still be null here on a
	// backend hiccup with an optimistic session, so don't 404 on an unknown
	// role, only a confirmed non-super-admin one.
	if (
		pathname.startsWith("/dashboard/platform") &&
		user &&
		user.user_type !== "super_admin"
	) {
		notFound();
	}

	return (
		<>
			<DashboardSurface />
			{children}
		</>
	);
}
