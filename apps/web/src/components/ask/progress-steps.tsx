import { Check, LoaderCircle } from "lucide-react";

import type { ProgressStage } from "@/lib/ask-stream";
import { cn } from "@/lib/utils";

const STEPS = ["understanding", "writing", "running"] as const;

type Labels = {
  progressLabel: string;
  stageUnderstanding: string;
  stageWriting: string;
  stageRunning: string;
  stageRepairing: string;
};

/** Understanding → Writing query → Running. A repair goes back to "Writing query". */
export function ProgressSteps({
  stage,
  attempt,
  labels,
}: {
  stage: ProgressStage;
  attempt: number;
  labels: Labels;
}) {
  const current = STEPS.indexOf(stage === "repairing" ? "writing" : stage);
  const names = [labels.stageUnderstanding, labels.stageWriting, labels.stageRunning];
  return (
    <div className="flex flex-col gap-2" data-testid="progress" data-stage={stage}>
      <ol aria-label={labels.progressLabel} className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {STEPS.map((step, i) => {
          const state = i < current ? "done" : i === current ? "current" : "pending";
          return (
            <li
              key={step}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 text-sm",
                state === "pending" && "text-muted-foreground",
                state === "current" && "font-medium",
              )}
            >
              {i > 0 && <span aria-hidden className="h-px w-4 bg-border sm:w-6" />}
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "current" && "border-primary",
                )}
              >
                {state === "done" ? (
                  <Check aria-hidden className="size-3" />
                ) : state === "current" ? (
                  <LoaderCircle aria-hidden className="size-3 animate-spin" />
                ) : null}
              </span>
              {names[i]}
            </li>
          );
        })}
      </ol>
      {stage === "repairing" && (
        <p className="text-xs text-muted-foreground">
          {labels.stageRepairing.replace("{attempt}", String(attempt))}
        </p>
      )}
    </div>
  );
}
