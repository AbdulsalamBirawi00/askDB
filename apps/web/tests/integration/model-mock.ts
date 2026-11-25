import { HttpResponse } from "msw/http";

/** Groq's OpenAI-compatible endpoint, mocked with MSW in the integration tests. */
export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export type ModelOutput = {
  sql: string | null;
  explanation: string;
  chartType: "table" | "bar" | "line" | "pie" | "number";
  needsClarification: boolean;
  clarificationQuestion: string | null;
};

export const completion = (output: Partial<ModelOutput>) =>
  HttpResponse.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "test",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify({
            sql: null,
            explanation: "Test",
            chartType: "table",
            needsClarification: false,
            clarificationQuestion: null,
            ...output,
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

/** The summary call streams (OpenAI-compatible SSE). */
export const streamed = (text: string) =>
  new HttpResponse(
    [
      { delta: { role: "assistant", content: text }, finish_reason: null },
      { delta: {}, finish_reason: "stop" },
    ]
      .map(
        (choice) =>
          `data: ${JSON.stringify({ id: "s", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, ...choice }] })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
