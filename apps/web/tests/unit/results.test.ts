import { describe, expect, it } from "vitest";

import { readAskStream } from "@/lib/ask-stream";
import { csvFileName, toCsv } from "@/lib/csv";
import { axisLabeler, formatCell, formatDate } from "@/lib/format";

describe("CSV export", () => {
  it("T4.8 starts with a UTF-8 BOM and keeps Arabic text", () => {
    const csv = toCsv(
      [
        { name: "country", kind: "text" },
        { name: "customers", kind: "number" },
      ],
      [{ country: "مصر", customers: 3 }],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("country,customers\r\nمصر,3\r\n");
  });

  it("quotes commas, quotes, and new lines; leaves empty values empty", () => {
    const csv = toCsv(
      [
        { name: "a", kind: "text" },
        { name: "b", kind: "text" },
      ],
      [
        { a: 'say "hi", ok', b: null },
        { a: "two\nlines", b: undefined },
      ],
    );
    expect(csv.slice(1)).toBe('a,b\r\n"say ""hi"", ok",\r\n"two\nlines",\r\n');
  });

  it("defuses spreadsheet formulas in text, not negative numbers", () => {
    const csv = toCsv(
      [
        { name: "note", kind: "text" },
        { name: "delta", kind: "number" },
      ],
      [{ note: "=HYPERLINK(1)", delta: -5 }],
    );
    expect(csv.slice(1)).toBe("note,delta\r\n'=HYPERLINK(1),-5\r\n");
  });

  it("names the file by date", () => {
    expect(csvFileName(new Date("2026-11-25T10:00:00Z"))).toBe("askdb-2026-11-25.csv");
  });
});

describe("formatting", () => {
  it("shows Postgres date text as a date, without a time-zone shift", () => {
    expect(formatDate("1997-01-01")).toBe("1997-01-01");
    expect(formatDate("1997-01-01 00:00:00+00")).toBe("1997-01-01");
    expect(formatDate("1997-01-01 14:30:00")).toBe("1997-01-01 14:30");
  });

  it("groups large numbers but leaves years alone", () => {
    expect(formatCell("1997", "number", "en")).toBe("1997");
    expect(formatCell("71398.4281", "number", "en")).toBe("71,398.43");
    expect(formatCell("71398.4281", "number", "ar")).toBe("71,398.43");
    expect(formatCell(null, "text", "en")).toBe("—");
  });

  it("labels whole months as month and year, and month numbers as month names", () => {
    const months = ["1997-01-01 00:00:00+00", "1997-02-01 00:00:00+00"];
    expect(axisLabeler({ name: "month", kind: "date" }, months, "en")(months[0])).toBe("Jan 1997");
    const numbers = [1, 2, 12];
    expect(axisLabeler({ name: "month", kind: "number" }, numbers, "en")(12)).toBe("Dec");
    const days = ["1997-01-05", "1997-01-06"];
    expect(axisLabeler({ name: "day", kind: "date" }, days, "en")(days[0])).toBe("1997-01-05");
  });
});

describe("readAskStream", () => {
  it("reads events split across chunks", async () => {
    const encoder = new TextEncoder();
    const text =
      '{"type":"stage","stage":"writing","attempt":1}\n{"type":"summary","text":"ملخص"}\n{"type":"done"}';
    const bytes = encoder.encode(text);
    // Split in the middle of the two UTF-8 bytes of "م" (everything before it is ASCII).
    const cut = text.indexOf("ملخص") + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, cut));
        controller.enqueue(bytes.subarray(cut));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readAskStream(body)) events.push(event);
    expect(events).toEqual([
      { type: "stage", stage: "writing", attempt: 1 },
      { type: "summary", text: "ملخص" },
      { type: "done" },
    ]);
  });
});
