// Plain Node assertion tests for interview-status.ts — no test framework, no new
// dependency. Runs directly against the real module (Node 26+ imports .ts files
// with type annotations natively) rather than a reimplementation, so this
// actually catches regressions in the shipped logic, not just a spec of intent.
//
// Run: node dashboard/tests/interview-status.test.mjs
// or:  npm run test:interview-status   (from dashboard/)
import assert from "node:assert/strict";
import {
	mapInterviewStatus,
	statusFieldForStage,
	scoreFieldForStage,
	getCandidateSubtab,
} from "../src/dashboard/interview-status.ts";

let passed = 0;
function test(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  ok  - ${name}`);
	} catch (err) {
		console.error(`FAIL - ${name}`);
		console.error(`       ${err.message}`);
		process.exitCode = 1;
	}
}

console.log("mapInterviewStatus");
test("pending -> Awaiting Schedule (the exact bug: used to collide with 'scheduled')", () => {
	assert.equal(mapInterviewStatus("pending"), "Awaiting Schedule");
});
test("scheduled -> Scheduled (used to collide with 'pending' under 'Not Started')", () => {
	assert.equal(mapInterviewStatus("scheduled"), "Scheduled");
});
test("pending and scheduled must map to DIFFERENT labels", () => {
	assert.notEqual(mapInterviewStatus("pending"), mapInterviewStatus("scheduled"));
});
test("completed -> Completed", () => {
	assert.equal(mapInterviewStatus("completed"), "Completed");
});
test("incomplete -> Incomplete", () => {
	assert.equal(mapInterviewStatus("incomplete"), "Incomplete");
});
test("slot_missed -> Slot Missed", () => {
	assert.equal(mapInterviewStatus("slot_missed"), "Slot Missed");
});
test("attempting / in_progress -> Attempting", () => {
	assert.equal(mapInterviewStatus("attempting"), "Attempting");
	assert.equal(mapInterviewStatus("in_progress"), "Attempting");
});
test("null/undefined/empty -> null", () => {
	assert.equal(mapInterviewStatus(null), null);
	assert.equal(mapInterviewStatus(undefined), null);
	assert.equal(mapInterviewStatus(""), null);
});
test("case-insensitive", () => {
	assert.equal(mapInterviewStatus("PENDING"), "Awaiting Schedule");
	assert.equal(mapInterviewStatus("Scheduled"), "Scheduled");
});

console.log("\nstatusFieldForStage / scoreFieldForStage");
test("screening stage reads screeningStatus/screeningScore", () => {
	assert.equal(statusFieldForStage("screening"), "screeningStatus");
	assert.equal(scoreFieldForStage("screening"), "screeningScore");
});
test("functional stage reads interviewStatus/interviewScore", () => {
	assert.equal(statusFieldForStage("functional"), "interviewStatus");
	assert.equal(scoreFieldForStage("functional"), "interviewScore");
});

console.log("\ngetCandidateSubtab (the reported bug)");
test("screening candidate buckets by screeningStatus, ignoring a stale/contaminated interviewStatus", () => {
	// This is the exact shape of the reported bug: a candidate whose FUNCTIONAL
	// status happens to say 'Completed' (e.g. leftover data, or simply because
	// functional_status defaults differently) must NOT be bucketed as completed
	// on the SCREENING pane — only their own screeningStatus counts there.
	const c = { screeningStatus: "Awaiting Schedule", interviewStatus: "Completed" };
	assert.equal(getCandidateSubtab(c, "screening"), "awaiting-schedule");
});
test("functional candidate buckets by interviewStatus, ignoring screeningStatus", () => {
	const c = { screeningStatus: "Completed", interviewStatus: "Awaiting Schedule" };
	assert.equal(getCandidateSubtab(c, "functional"), "awaiting-schedule");
});
test("Completed status buckets as 'completed' — the exact filter that used to show 0 results", () => {
	const c = { screeningStatus: "Completed", interviewStatus: null };
	assert.equal(getCandidateSubtab(c, "screening"), "completed");
});
test("Incomplete -> partially-completed, Slot Missed -> window-missed", () => {
	assert.equal(getCandidateSubtab({ screeningStatus: "Incomplete" }, "screening"), "partially-completed");
	assert.equal(getCandidateSubtab({ screeningStatus: "Slot Missed" }, "screening"), "window-missed");
});
test("Scheduled/Attempting/unset all fall into the generic 'scheduled' bucket, distinct from 'awaiting-schedule'", () => {
	assert.equal(getCandidateSubtab({ screeningStatus: "Scheduled" }, "screening"), "scheduled");
	assert.equal(getCandidateSubtab({ screeningStatus: "Attempting" }, "screening"), "scheduled");
	assert.equal(getCandidateSubtab({ screeningStatus: null }, "screening"), "scheduled");
});
test("a never-scheduled candidate is NOT lumped into 'scheduled' — the reported categorisation bug", () => {
	const neverScheduled = { screeningStatus: "Awaiting Schedule" };
	assert.notEqual(getCandidateSubtab(neverScheduled, "screening"), "scheduled");
	assert.equal(getCandidateSubtab(neverScheduled, "screening"), "awaiting-schedule");
});

console.log(`\n${passed} passed${process.exitCode ? ", with failures above" : ""}`);
