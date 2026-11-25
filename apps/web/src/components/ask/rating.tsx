"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";

import { cn } from "@/lib/utils";

export type Rating = 1 | -1 | null;

type Labels = { ratingLabel: string; helpful: string; notHelpful: string };

/** 👍 / 👎 on an answer. Pressing the selected one again clears it. */
export function RatingButtons({
  value,
  onChange,
  labels,
}: {
  value: Rating;
  onChange: (rating: Rating) => void;
  labels: Labels;
}) {
  const options = [
    { rating: 1 as const, label: labels.helpful, Icon: ThumbsUp },
    { rating: -1 as const, label: labels.notHelpful, Icon: ThumbsDown },
  ];
  return (
    <div
      role="group"
      aria-label={labels.ratingLabel}
      className="flex items-center gap-1"
      data-testid="rating"
    >
      <span className="me-1 text-xs text-muted-foreground">{labels.ratingLabel}</span>
      {options.map(({ rating, label, Icon }) => {
        const pressed = value === rating;
        return (
          <button
            key={rating}
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            title={label}
            onClick={() => onChange(pressed ? null : rating)}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted",
              pressed && "border-primary bg-primary/10 text-primary",
            )}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
