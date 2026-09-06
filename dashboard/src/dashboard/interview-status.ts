// Pure interview-status/stage mapping logic — deliberately no imports from
// ./runtime or anything DOM-touching, so this is directly unit-testable with
// plain `node` (see dashboard/tests/interview-status.test.mjs) and safe to
// import from any of the vanilla-JS dashboard modules.
//
// Screening and functional are tracked as SEPARATE backend fields
// (screening_status/screening_score vs functional_status/functional_score),
// exposed on the Candidate object as screeningStatus/screeningScore vs
// interviewStatus/interviewScore. Code that reads "the" status/score without
// picking the right pair for the stage it's actually displaying will silently
// read the wrong field — a real bug this module exists to prevent recurring.

// Normalises a backend interview status (snake_case) to the dashboard label.
// pending -> 'Awaiting Schedule' and scheduled -> 'Scheduled' are genuinely
// distinct backend values that used to collide into the same 'Not Started'
// label here, which is what made every screening-stage candidate look
// identical regardless of whether they'd been scheduled yet.
export function mapInterviewStatus(s: unknown): string | null {
	if (!s) return null;
	const k = String(s).toLowerCase().replace(/\s+/g, "_");
	const map: Record<string, string> = {
		completed: "Completed",
		incomplete: "Incomplete",
		evaluating: "Evaluating",
		attempting: "Attempting",
		in_progress: "Attempting",
		pending: "Awaiting Schedule",
		scheduled: "Scheduled",
		not_started: "Not Started",
		slot_missed: "Slot Missed",
		missed: "Slot Missed",
	};
	return map[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " "));
}

export type Stage = "screening" | "functional";

export function statusFieldForStage(stage: Stage): "screeningStatus" | "interviewStatus" {
	return stage === "screening" ? "screeningStatus" : "interviewStatus";
}

export function scoreFieldForStage(stage: Stage): "screeningScore" | "interviewScore" {
	return stage === "screening" ? "screeningScore" : "interviewScore";
}

// Which subtab bucket a candidate belongs in, for the stage currently being
// viewed. Reads the field that actually belongs to that stage — the bug this
// fixes was reading the functional-derived field even on the Screening pane,
// so every screening candidate (whose functional field is always null while
// they're still in that stage) fell into the same default 'scheduled' bucket.
export function getCandidateSubtab(c: any, stage: Stage): string {
	const status = c[statusFieldForStage(stage)];
	if (status === "Completed") return "completed";
	if (status === "Incomplete") return "partially-completed";
	if (status === "Slot Missed") return "window-missed";
	if (status === "Awaiting Schedule") return "awaiting-schedule";
	return "scheduled"; // Scheduled, Attempting, Evaluating, legacy 'Not Started'
}
