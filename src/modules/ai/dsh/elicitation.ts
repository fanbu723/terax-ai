import type {
  ElicitationContentValue,
  ElicitationSchema,
  EnumOption,
} from "@agentclientprotocol/sdk";

export type DshFormOption = {
  value: string;
  label: string;
  description?: string | null;
};

type FieldBase = {
  name: string;
  title: string;
  description: string | null;
  required: boolean;
};

export type DshFormField =
  | (FieldBase & {
      kind: "string";
      options: DshFormOption[];
      multiline: boolean;
      default: string;
    })
  | (FieldBase & {
      kind: "number";
      integer: boolean;
      minimum: number | null;
      maximum: number | null;
      default: string;
    })
  | (FieldBase & { kind: "boolean"; default: boolean })
  | (FieldBase & {
      kind: "multi";
      options: DshFormOption[];
      default: string[];
    });

export type DshForm = {
  title: string | null;
  description: string | null;
  fields: DshFormField[];
};

export type DshFormValues = Record<string, string | boolean | string[]>;

const emptyForm: DshForm = { title: null, description: null, fields: [] };

type RawProperty = {
  type?: string;
  title?: string | null;
  description?: string | null;
  default?: unknown;
  enum?: string[] | null;
  oneOf?: EnumOption[] | null;
  format?: string | null;
  minimum?: number | null;
  maximum?: number | null;
  items?: {
    type?: string;
    enum?: string[] | null;
    anyOf?: EnumOption[] | null;
  } | null;
};

function optionsFromEnum(
  enumValues: string[] | null | undefined,
  oneOf: EnumOption[] | null | undefined,
): DshFormOption[] {
  if (Array.isArray(oneOf)) {
    return oneOf.map((option) => ({
      value: option.const,
      label: option.title,
      description: option.description ?? null,
    }));
  }
  if (Array.isArray(enumValues)) {
    return enumValues.map((value) => ({ value, label: value }));
  }
  return [];
}

function enumOptions(property: RawProperty): DshFormOption[] {
  if (property.type === "string") {
    return optionsFromEnum(property.enum, property.oneOf);
  }
  if (property.type === "array") {
    return optionsFromEnum(property.items?.enum, property.items?.anyOf);
  }
  return [];
}

/** Maps the ACP elicitation JSON schema onto the console's simple form model. */
export function buildElicitationForm(
  schema: ElicitationSchema | null | undefined,
): DshForm {
  if (!schema?.properties) return emptyForm;
  const required = new Set(schema.required ?? []);
  const fields: DshFormField[] = [];
  for (const [name, raw] of Object.entries(schema.properties)) {
    const property = raw as RawProperty;
    const base = {
      name,
      title: property.title ?? name,
      description: property.description ?? null,
      required: required.has(name),
    };
    if (property.type === "string") {
      const options = enumOptions(property);
      fields.push({
        ...base,
        kind: "string",
        options,
        multiline: options.length === 0 && !property.format,
        default: typeof property.default === "string" ? property.default : "",
      });
    } else if (property.type === "number" || property.type === "integer") {
      fields.push({
        ...base,
        kind: "number",
        integer: property.type === "integer",
        minimum: property.minimum ?? null,
        maximum: property.maximum ?? null,
        default:
          typeof property.default === "number"
            ? String(property.default)
            : "",
      });
    } else if (property.type === "boolean") {
      fields.push({
        ...base,
        kind: "boolean",
        default: property.default === true,
      });
    } else if (property.type === "array") {
      fields.push({
        ...base,
        kind: "multi",
        options: enumOptions(property),
        default: Array.isArray(property.default)
          ? property.default.filter((v): v is string => typeof v === "string")
          : [],
      });
    }
  }
  return {
    title: schema.title ?? null,
    description: schema.description ?? null,
    fields,
  };
}

export function initialElicitationValues(form: DshForm): DshFormValues {
  const values: DshFormValues = {};
  for (const field of form.fields) {
    values[field.name] = field.default;
  }
  return values;
}

export type ElicitationValidation =
  | { ok: true; content: Record<string, ElicitationContentValue> }
  | { ok: false; field: string | null; reason: "required" | "invalid" };

export function buildElicitationContent(
  form: DshForm,
  values: DshFormValues,
): ElicitationValidation {
  const content: Record<string, ElicitationContentValue> = {};
  for (const field of form.fields) {
    const value = values[field.name];
    if (field.kind === "string") {
      const text = typeof value === "string" ? value : "";
      if (!text.trim()) {
        if (field.required) {
          return { ok: false, field: field.name, reason: "required" };
        }
        continue;
      }
      content[field.name] = text;
    } else if (field.kind === "number") {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) {
        if (field.required) {
          return { ok: false, field: field.name, reason: "required" };
        }
        continue;
      }
      const parsed = field.integer ? Number.parseInt(text, 10) : Number(text);
      if (!Number.isFinite(parsed) || (field.integer && !Number.isInteger(parsed))) {
        return { ok: false, field: field.name, reason: "invalid" };
      }
      if (field.minimum != null && parsed < field.minimum) {
        return { ok: false, field: field.name, reason: "invalid" };
      }
      if (field.maximum != null && parsed > field.maximum) {
        return { ok: false, field: field.name, reason: "invalid" };
      }
      content[field.name] = parsed;
    } else if (field.kind === "boolean") {
      content[field.name] = typeof value === "boolean" ? value : field.default;
    } else {
      const selected = Array.isArray(value) ? value : [];
      if (selected.length === 0) {
        if (field.required) {
          return { ok: false, field: field.name, reason: "required" };
        }
        continue;
      }
      content[field.name] = selected;
    }
  }
  return { ok: true, content };
}
