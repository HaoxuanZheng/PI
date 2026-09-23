import { onboardingGoals, type OnboardingStatus } from "@lifegraph/analytics";
import { completeOnboarding, selectOnboardingGoal, startOnboarding } from "./actions";

export function OnboardingChecklist({ status }: { status: OnboardingStatus }) {
  if (status.completed) return null;

  return (
    <section aria-labelledby="onboarding-title" className="onboardingCard">
      <p className="eyebrow">Getting started</p>
      <h2 id="onboarding-title">Reach your first value</h2>
      <ol className="muted">
        <li>{status.started ? "✓ Started" : "1. Start onboarding"}</li>
        <li>{status.goal ? `✓ Goal: ${status.goal}` : "2. Choose a goal"}</li>
        <li>
          {status.activated
            ? `✓ Activated with ${status.objectCount} objects`
            : `3. Create or import ${status.objectCount}/10 objects`}
        </li>
      </ol>
      {!status.started ? (
        <form action={startOnboarding}>
          <button className="button" type="submit">Start onboarding</button>
        </form>
      ) : (
        <form action={selectOnboardingGoal} className="noteForm">
          <label className="field">
            <span>Initial goal</span>
            <select name="goal" defaultValue={status.goal ?? "organize"}>
              {onboardingGoals.map((goal) => (
                <option key={goal.value} value={goal.value}>{goal.label}</option>
              ))}
            </select>
          </label>
          <button className="button buttonSecondary" type="submit">Save goal</button>
        </form>
      )}
      {status.started && (
        <form action={completeOnboarding}>
          <button className="button buttonSecondary" type="submit" disabled={!status.goal}>
            Mark onboarding complete
          </button>
        </form>
      )}
    </section>
  );
}
