"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/toast";
import { updateProject } from "@/lib/server-api";

interface EditableProjectNameProps {
  accessToken: string;
  projectId: string;
  initialName: string;
}

export function EditableProjectName({
  accessToken,
  projectId,
  initialName,
}: EditableProjectNameProps) {
  const { error: toastError } = useToast();
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevName = useRef(initialName);

  // Sync if initialName changes externally
  useEffect(() => {
    setName(initialName);
    prevName.current = initialName;
  }, [initialName]);

  const save = useCallback(
    async (newName: string) => {
      const trimmed = newName.trim() || "未命名项目";
      setName(trimmed);
      setEditing(false);
      if (trimmed !== prevName.current) {
        const previous = prevName.current;
        prevName.current = trimmed;
        try {
          await updateProject(accessToken, projectId, { name: trimmed });
        } catch (err) {
          console.warn("[canvas] rename failed", err);
          prevName.current = previous;
          setName(previous);
          toastError("项目名没有保存，请稍后再试");
        }
      }
    },
    [accessToken, projectId, toastError],
  );

  const startEditing = useCallback(() => {
    setEditing(true);
    // Select all text after render
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save(name);
      } else if (e.key === "Escape") {
        setName(prevName.current);
        setEditing(false);
      }
    },
    [name, save],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => save(name)}
        onKeyDown={handleKeyDown}
        aria-label="项目名称"
        className="h-8 w-[min(220px,40vw)] rounded-md glass px-2.5 text-sm font-medium text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acc"
        maxLength={100}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="glass h-8 max-w-[min(220px,40vw)] cursor-text truncate rounded-md px-2.5 text-sm font-medium text-fg transition-colors hover:border-tint/25 focus-visible:outline-2 focus-visible:outline-acc"
      title={`${name}（点击重命名）`}
    >
      {name}
    </button>
  );
}
