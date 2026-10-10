"use client";

/**
 * Add / edit one of the user's own chat providers.
 *
 * The API key lives only in this form's state while the dialog is open: it
 * is not logged, not stored, and the form unmounts (dropping it) on close.
 * Saving asks the server to read the provider's model list, which verifies
 * the key without sending a chat request.
 */
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  type FieldErrors,
  type ProviderField,
  type ProviderFormValues,
  buildCreateBody,
  buildEditPlan,
  formErrorFor,
  initialFormValues,
  validateProviderForm,
} from "@/lib/chat-provider-form";
import {
  CHAT_PROVIDER_LIMITS,
  type ChatProvider,
  createChatProvider,
  refreshChatProviderModels,
  updateChatProvider,
} from "@/lib/chat-providers-api";
import { ApiApplicationError, ApiAuthError } from "@/lib/server-api";
import { cn } from "@/lib/utils";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Segmented } from "../ui/select";

const FIELD_OF: Record<keyof ProviderFormValues, ProviderField> = {
  name: "name",
  baseUrl: "baseUrl",
  apiKey: "apiKey",
  modelsMode: "models",
  modelsText: "models",
};

export type ProviderDialogTarget = { kind: "create" } | { kind: "edit"; provider: ChatProvider };

export function ChatProviderDialog({
  target,
  onClose,
  onSaved,
}: {
  target: ProviderDialogTarget | null;
  onClose: () => void;
  /** `close: false` = saved, but the dialog stays open to show a follow-up error. */
  onSaved: (provider: ChatProvider, info: { created: boolean; close: boolean }) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {target ? (
          <ProviderForm
            key={target.kind === "edit" ? target.provider.id : "create"}
            original={target.kind === "edit" ? target.provider : null}
            onCancel={onClose}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProviderForm({
  original,
  onCancel,
  onSaved,
}: {
  original: ChatProvider | null;
  onCancel: () => void;
  onSaved: (provider: ChatProvider, info: { created: boolean; close: boolean }) => void;
}) {
  const { session } = useAuth();
  const [values, setValues] = useState<ProviderFormValues>(() => initialFormValues(original));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const fieldRefs = useRef<Partial<Record<ProviderField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const ids = useId();
  const idOf = (field: ProviderField) => `${ids}-${field}`;

  const set = <K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    const field = FIELD_OF[key];
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const focusFirst = (next: FieldErrors) => {
    const order: ProviderField[] = ["name", "baseUrl", "apiKey", "models"];
    const first = order.find((field) => next[field]);
    if (first) requestAnimationFrame(() => fieldRefs.current[first]?.focus());
  };

  const fail = (error: unknown, editingWithoutNewKey: boolean) => {
    if (error instanceof ApiAuthError) return; // the auth layer signs out and redirects
    const code = error instanceof ApiApplicationError ? error.code : "application_error";
    const message = error instanceof ApiApplicationError ? error.message : null;
    if (!(error instanceof ApiApplicationError)) console.error("[chat-provider] save failed", error);
    const mapped = formErrorFor(code, message, { editingWithoutNewKey });
    if (mapped.switchToManual) setValues((prev) => ({ ...prev, modelsMode: "manual" }));
    if (mapped.field) {
      const next = { [mapped.field]: mapped.message } as FieldErrors;
      setErrors(next);
      setFormError(null);
      focusFirst(next);
    } else {
      setFormError(mapped.message);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const token = session?.access_token;
    if (!token) return;
    const checked = validateProviderForm(values, original);
    if (!checked.ok) {
      setErrors(checked.errors);
      setFormError(null);
      focusFirst(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    const form = checked.value;
    try {
      if (!original) {
        const provider = await createChatProvider(token, buildCreateBody(form));
        console.info("[chat-provider] created", provider.id, provider.models.length);
        setValues((prev) => ({ ...prev, apiKey: "" }));
        onSaved(provider, { created: true, close: true });
        return;
      }
      const plan = buildEditPlan(original, form);
      let provider = original;
      if (plan.patch) {
        provider = await updateChatProvider(token, original.id, plan.patch);
        console.info("[chat-provider] updated", original.id, Object.keys(plan.patch));
        setValues((prev) => ({ ...prev, apiKey: "" }));
      }
      if (plan.refreshAfter) {
        try {
          provider = await refreshChatProviderModels(token, original.id);
        } catch (error) {
          // The edit itself is saved; keep the dialog open to explain.
          if (plan.patch) onSaved(provider, { created: false, close: false });
          fail(error, true);
          return;
        }
      }
      onSaved(provider, { created: false, close: true });
    } catch (error) {
      fail(error, Boolean(original) && !form.apiKey);
    } finally {
      setSubmitting(false);
    }
  };

  const keyHint = original?.keyHint;
  const manual = values.modelsMode === "manual";

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{original ? `编辑「${original.name}」` : "添加对话模型服务商"}</DialogTitle>
        <DialogDescription className="text-[13px] leading-relaxed text-fg-soft">
          接入一个 OpenAI 兼容的接口，给设计助手对话用。生图仍走主站。
        </DialogDescription>
      </DialogHeader>

      <Field id={idOf("name")} label="名称" error={errors.name}>
        <Input
          ref={(el) => {
            fieldRefs.current.name = el;
          }}
          id={idOf("name")}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={CHAT_PROVIDER_LIMITS.nameLength}
          placeholder="给这个服务商起个名字"
          autoComplete="off"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${idOf("name")}-msg` : undefined}
        />
      </Field>

      <Field
        id={idOf("baseUrl")}
        label="接口地址"
        hint="填到 /v1 为止。只支持 https 公网地址。"
        error={errors.baseUrl}
      >
        <Input
          ref={(el) => {
            fieldRefs.current.baseUrl = el;
          }}
          id={idOf("baseUrl")}
          type="url"
          inputMode="url"
          value={values.baseUrl}
          onChange={(e) => set("baseUrl", e.target.value)}
          placeholder="https://api.example.com/v1"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-[13px] md:text-[13px]"
          aria-invalid={errors.baseUrl ? true : undefined}
          aria-describedby={`${idOf("baseUrl")}-msg`}
        />
      </Field>

      <Field
        id={idOf("apiKey")}
        label="API Key"
        hint={
          original
            ? `已保存末 4 位 ${keyHint}。不换 Key 就留空；改了接口地址必须重新填写。`
            : "只用来向这个服务商发请求。保存后只显示末 4 位。"
        }
        error={errors.apiKey}
      >
        <div className="relative">
          <Input
            ref={(el) => {
              fieldRefs.current.apiKey = el;
            }}
            id={idOf("apiKey")}
            type={showKey ? "text" : "password"}
            value={values.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
            placeholder={original ? "不换就留空" : "sk-…"}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className="pr-11 font-mono text-[13px] md:text-[13px]"
            aria-invalid={errors.apiKey ? true : undefined}
            aria-describedby={`${idOf("apiKey")}-msg`}
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
            aria-pressed={showKey}
            className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-md text-fg-muted outline-none hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acc"
          >
            {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </Field>

      <div className="grid gap-2">
        <span id={`${idOf("models")}-label`} className="text-[13px] font-medium text-fg">
          模型
        </span>
        <Segmented
          ariaLabel="模型列表来源"
          value={values.modelsMode}
          onValueChange={(v) => {
            set("modelsMode", v === "manual" ? "manual" : "auto");
            // Start a manual list from what was read last time.
            if (v === "manual" && !values.modelsText.trim() && original?.models.length)
              set("modelsText", original.models.join("\n"));
          }}
          options={[
            { value: "auto", label: "自动获取" },
            { value: "manual", label: "手动填写" },
          ]}
          className="w-fit"
        />
        {manual ? (
          <textarea
            ref={(el) => {
              fieldRefs.current.models = el;
            }}
            id={idOf("models")}
            value={values.modelsText}
            onChange={(e) => set("modelsText", e.target.value)}
            rows={5}
            placeholder={"每行一个模型名，例如\nmodel-a\nmodel-b"}
            spellCheck={false}
            aria-labelledby={`${idOf("models")}-label`}
            aria-invalid={errors.models ? true : undefined}
            aria-describedby={`${idOf("models")}-msg`}
            className="min-h-28 w-full resize-y rounded-md border border-line-strong bg-tint/[0.04] px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg-muted hover:border-tint/25 focus-visible:border-acc/70 focus-visible:bg-tint/[0.06] focus-visible:shadow-[0_0_0_3px_rgb(var(--amb)/0.18)] aria-invalid:border-alert"
          />
        ) : null}
        <FieldMessage
          id={`${idOf("models")}-msg`}
          error={errors.models}
          hint={
            manual
              ? `服务商没有模型列表接口时用。最多 ${CHAT_PROVIDER_LIMITS.models} 个。`
              : original?.modelsSource === "fetched"
                ? `已读到 ${original.models.length} 个模型。改了地址或 Key 会重新读取。`
                : "保存时读取服务商的模型列表，顺便验证 Key。"
          }
        />
      </div>

      <p className="rounded-md bg-tint/[0.05] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg-soft">
        用这个服务商的模型对话时，费用由服务商收取，不从主站余额扣。
      </p>

      {formError ? (
        <p role="alert" className="text-[13px] leading-relaxed text-alert">
          {formError}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (original ? "正在保存…" : "正在验证…") : original ? "保存" : "添加"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      <FieldMessage id={`${id}-msg`} error={error} hint={hint} />
    </div>
  );
}

function FieldMessage({
  id,
  error,
  hint,
}: {
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  if (!error && !hint) return null;
  return (
    <p
      id={id}
      className={cn("text-[12px] leading-relaxed", error ? "text-alert" : "text-fg-muted")}
    >
      {error ?? hint}
    </p>
  );
}
