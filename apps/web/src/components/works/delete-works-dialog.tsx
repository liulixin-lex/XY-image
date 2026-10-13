"use client";

/**
 * Confirms deleting several pictures at once (第 58 条). One picture is
 * deleted straight away with 撤销 on the toast; a batch asks first.
 */
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export function DeleteWorksDialog({
  count,
  open,
  deleting,
  note,
  unit = "张图",
  onConfirm,
  onCancel,
}: {
  count: number;
  /** 张图 on 作品; 条记录 in 生成记录, where a failed row has no picture. */
  unit?: "张图" | "条记录";
  open: boolean;
  deleting: boolean;
  /** An extra line, e.g. how many of them are 待核对. */
  note?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !deleting) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            删除这 {count} {unit}？
          </DialogTitle>
          <DialogDescription>
            会从作品和生成记录里移除，删除后可以马上撤销。已经放在画布上的图，画布里还在。
          </DialogDescription>
          {note ? <p className="text-[13px] leading-relaxed text-fg-soft">{note}</p> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={deleting}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting ? "正在删除" : `删除 ${count} ${unit === "张图" ? "张" : "条"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
