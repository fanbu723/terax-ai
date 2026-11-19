import { describe, expect, it } from "vitest";
import {
  buildElicitationContent,
  buildElicitationForm,
  initialElicitationValues,
} from "./elicitation";

const schema = {
  type: "object" as const,
  title: "Answer DSH",
  properties: {
    name: { type: "string" as const, title: "Name" },
    color: {
      type: "string" as const,
      title: "Color",
      enum: ["red", "green"],
    },
    mode: {
      type: "string" as const,
      title: "Mode",
      oneOf: [
        { const: "fast", title: "Fast" },
        { const: "safe", title: "Safe" },
      ],
    },
    count: {
      type: "integer" as const,
      title: "Count",
      minimum: 1,
      maximum: 10,
      default: 3,
    },
    enabled: { type: "boolean" as const, title: "Enabled", default: true },
    tags: {
      type: "array" as const,
      title: "Tags",
      items: { type: "string" as const, enum: ["a", "b", "c"] },
      default: ["a"],
    },
  },
  required: ["name", "color"],
};

describe("buildElicitationForm", () => {
  it("maps primitive schemas to form fields", () => {
    const form = buildElicitationForm(schema);
    expect(form.title).toBe("Answer DSH");
    expect(form.fields.map((f) => f.kind)).toEqual([
      "string",
      "string",
      "string",
      "number",
      "boolean",
      "multi",
    ]);
    expect(form.fields[0]).toMatchObject({ required: true, multiline: true });
    expect(form.fields[1]).toMatchObject({
      required: true,
      options: [
        { value: "red", label: "red" },
        { value: "green", label: "green" },
      ],
    });
    expect(form.fields[2]).toMatchObject({
      options: [
        { value: "fast", label: "Fast" },
        { value: "safe", label: "Safe" },
      ],
    });
    expect(form.fields[3]).toMatchObject({
      integer: true,
      minimum: 1,
      maximum: 10,
      default: "3",
    });
    expect(form.fields[5]).toMatchObject({ default: ["a"] });
  });

  it("returns an empty form for a missing schema", () => {
    expect(buildElicitationForm(null).fields).toEqual([]);
  });

  it("seeds defaults into the initial values", () => {
    const form = buildElicitationForm(schema);
    expect(initialElicitationValues(form)).toEqual({
      name: "",
      color: "",
      mode: "",
      count: "3",
      enabled: true,
      tags: ["a"],
    });
  });
});

describe("buildElicitationContent", () => {
  it("accepts a complete answer", () => {
    const form = buildElicitationForm(schema);
    const result = buildElicitationContent(form, {
      name: "Ada",
      color: "green",
      mode: "fast",
      count: "4",
      enabled: false,
      tags: ["a", "c"],
    });
    expect(result).toEqual({
      ok: true,
      content: {
        name: "Ada",
        color: "green",
        mode: "fast",
        count: 4,
        enabled: false,
        tags: ["a", "c"],
      },
    });
  });

  it("reports missing required fields", () => {
    const form = buildElicitationForm(schema);
    const result = buildElicitationContent(form, {
      name: "",
      color: "",
    });
    expect(result).toMatchObject({
      ok: false,
      field: "name",
      reason: "required",
    });
  });

  it("rejects non-numeric and out-of-range numbers", () => {
    const form = buildElicitationForm(schema);
    expect(
      buildElicitationContent(form, {
        name: "Ada",
        color: "red",
        count: "abc",
      }),
    ).toMatchObject({ ok: false, field: "count", reason: "invalid" });
    expect(
      buildElicitationContent(form, {
        name: "Ada",
        color: "red",
        count: "99",
      }),
    ).toMatchObject({ ok: false, field: "count", reason: "invalid" });
  });

  it("skips optional empty values", () => {
    const form = buildElicitationForm(schema);
    const result = buildElicitationContent(form, {
      name: "Ada",
      color: "red",
      tags: [],
    });
    expect(result).toEqual({
      ok: true,
      content: { name: "Ada", color: "red", enabled: true },
    });
  });
});
