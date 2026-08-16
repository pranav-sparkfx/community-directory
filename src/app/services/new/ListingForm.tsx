"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitListing, type ListingState } from "./actions";
import type { ServiceCategory } from "@/lib/types";

const fieldStyle: React.CSSProperties = {
  background: "var(--fp-surface)",
  border: "1px solid var(--fp-line)",
  borderRadius: "var(--fp-radius-md)",
  fontSize: "var(--fp-text-base)",
  padding: "0 var(--fp-space-3)",
  width: "100%",
  color: "var(--fp-ink)",
};

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: "var(--fp-space-5)" }}>
      <span style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-2)", fontWeight: 500 }}>
        {label}
      </span>
      {hint ? (
        <span
          style={{ display: "block", fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
        >
          {hint}
        </span>
      ) : null}
      <span style={{ display: "block", marginTop: 6 }}>{children}</span>
      {error ? (
        <span
          role="alert"
          style={{ display: "block", fontSize: "var(--fp-text-sm)", color: "var(--fp-rejected)", marginTop: 4 }}
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}

function Submit() {
  // useFormStatus must be read from a child of the form, not the form itself.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="fp-tap w-full rounded-xl"
      style={{
        height: "var(--fp-control-h)",
        background: "var(--fp-forest)",
        color: "var(--fp-ink-inverse)",
        fontSize: "var(--fp-text-base)",
        fontWeight: 600,
        opacity: pending ? 0.6 : 1,
      }}
    >
      {pending ? "Sending for review…" : "Send for review"}
    </button>
  );
}

export function ListingForm({ categories }: { categories: ServiceCategory[] }) {
  const [state, formAction] = useActionState<ListingState, FormData>(submitListing, {});

  return (
    <form action={formAction}>
      {state.error ? (
        <p
          role="alert"
          className="rounded-xl px-4 py-3"
          style={{
            background: "var(--fp-rejected-wash)",
            color: "var(--fp-rejected)",
            fontSize: "var(--fp-text-base)",
            marginBottom: "var(--fp-space-5)",
          }}
        >
          {state.error}
        </p>
      ) : null}

      <Field label="What do you offer?" error={state.fieldErrors?.category}>
        <select name="category" required style={{ ...fieldStyle, height: "var(--fp-control-h)" }}>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Title"
        hint="A short line neighbours will see first"
        error={state.fieldErrors?.title}
      >
        <input
          name="title"
          required
          maxLength={120}
          placeholder="Dog walking &amp; drop-in visits"
          style={{ ...fieldStyle, height: "var(--fp-control-h)" }}
        />
      </Field>

      <Field label="Details" hint="Optional" error={state.fieldErrors?.description}>
        <textarea
          name="description"
          rows={4}
          maxLength={600}
          placeholder="What you do, and anything neighbours should know."
          style={{ ...fieldStyle, padding: "var(--fp-space-3)", lineHeight: 1.5, resize: "vertical" }}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--fp-space-3)" }}>
        <Field label="When" hint="Optional">
          <input
            name="availability"
            maxLength={80}
            placeholder="evenings"
            style={{ ...fieldStyle, height: "var(--fp-control-h)" }}
          />
        </Field>
        <Field label="Rate" hint="Optional">
          <input
            name="rate_note"
            maxLength={80}
            placeholder="free / by donation"
            style={{ ...fieldStyle, height: "var(--fp-control-h)" }}
          />
        </Field>
      </div>

      <Submit />

      <p
        style={{
          fontSize: "var(--fp-text-sm)",
          color: "var(--fp-ink-3)",
          marginTop: "var(--fp-space-4)",
          maxWidth: "54ch",
        }}
      >
        Your listing is linked to your household, so neighbours can reach you
        through the contact options you have already set. It stays private
        until an admin approves it.
      </p>
    </form>
  );
}
