"use client";

import type {
  BrandKitSummary,
  BrandKitDetail,
  BrandKitAssetType,
} from "@loomic/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrandKitSkeleton } from "../skeletons/brand-kit-skeleton";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useAuth } from "../../lib/auth-context";
import {
  createBrandKit,
  createBrandKitAsset,
  deleteBrandKit,
  deleteBrandKitAsset,
  duplicateBrandKit,
  fetchBrandKit,
  fetchBrandKits,
  updateBrandKit,
  updateBrandKitAsset,
  uploadBrandKitAsset,
} from "../../lib/brand-kit-api";
import { ApiAuthError } from "../../lib/server-api";
import { BrandKitEditor } from "./brand-kit-editor";
import { BrandKitSidebar } from "./brand-kit-sidebar";
import { EmptyState } from "./empty-state";

export function BrandKitPage() {
  const { session } = useAuth();
  const { error: toastError } = useToast();

  const [kits, setKits] = useState<BrandKitSummary[]>([]);
  const [selectedKit, setSelectedKit] = useState<BrandKitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BrandKitSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Use refs for values that change on token refresh but shouldn't
  // trigger callback/effect cascades (root cause of tab-switch reloads).
  const accessTokenRef = useRef(session?.access_token);
  accessTokenRef.current = session?.access_token;
  const selectedKitRef = useRef(selectedKit);
  selectedKitRef.current = selectedKit;
  const toastErrorRef = useRef(toastError);
  toastErrorRef.current = toastError;

  /**
   * 401 is already handled globally (brand-kit-api emits the expiry event),
   * so only application errors surface here. Returns true when handled.
   */
  const handleAuthError = useCallback(async (err: unknown, failure?: string) => {
    if (err instanceof ApiAuthError) return true;
    if (failure) toastErrorRef.current(failure);
    return false;
  }, []);

  const getToken = useCallback(() => {
    const token = accessTokenRef.current;
    if (!token) throw new ApiAuthError();
    return token;
  }, []);

  // --- Data loading (ref-based, no dependency cascades) ---

  const loadKitDetail = useCallback(
    async (kitId: string) => {
      try {
        const detail = await fetchBrandKit(getToken(), kitId);
        setSelectedKit(detail);
      } catch (err) {
        if (await handleAuthError(err, "套件详情没有加载出来")) return;
        console.error("[brand-kit] load detail failed", err);
      }
    },
    [getToken, handleAuthError],
  );

  const refreshList = useCallback(async () => {
    try {
      const data = await fetchBrandKits(getToken());
      setKits(data.brandKits);
      return data.brandKits;
    } catch (err) {
      if (await handleAuthError(err)) return [];
      console.error("[brand-kit] refresh list failed", err);
      return [];
    }
  }, [getToken, handleAuthError]);

  // Initial load — runs once per mount (workspace layout guarantees auth);
  // `reload` re-runs it after a failure.
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await fetchBrandKits(getToken());
      setKits(data.brandKits);
      const firstKit = data.brandKits[0];
      if (firstKit) {
        const detail = await fetchBrandKit(getToken(), firstKit.id);
        setSelectedKit(detail);
      }
    } catch (err) {
      if (await handleAuthError(err)) return;
      console.error("[brand-kit] initial load failed", err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [getToken, handleAuthError]);

  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    void loadAll();
  }, [loadAll]);

  // --- Kit handlers ---

  const handleSelectKit = useCallback(
    async (kitId: string) => {
      await loadKitDetail(kitId);
    },
    [loadKitDetail],
  );

  const handleCreateKit = useCallback(async () => {
    try {
      const newKit = await createBrandKit(getToken());
      await refreshList();
      setSelectedKit(newKit);
    } catch (err) {
      if (await handleAuthError(err, "套件没有创建成功")) return;
      console.error("[brand-kit] create failed", err);
    }
  }, [getToken, handleAuthError, refreshList]);

  const handleDuplicateKit = useCallback(async () => {
    const kit = selectedKitRef.current;
    if (!kit) return;
    try {
      const duplicated = await duplicateBrandKit(getToken(), kit.id);
      await refreshList();
      setSelectedKit(duplicated);
    } catch (err) {
      if (await handleAuthError(err, "套件没有复制成功")) return;
      console.error("[brand-kit] duplicate failed", err);
    }
  }, [getToken, handleAuthError, refreshList]);

  const handleUpdateKit = useCallback(
    async (data: {
      name?: string;
      guidance_text?: string | null;
      is_default?: boolean;
    }) => {
      const kit = selectedKitRef.current;
      if (!kit) return;
      try {
        const updated = await updateBrandKit(getToken(), kit.id, data);
        setSelectedKit(updated);
        await refreshList();
      } catch (err) {
        if (await handleAuthError(err, "修改没有保存")) return;
        console.error("[brand-kit] update failed", err);
      }
    },
    [getToken, handleAuthError, refreshList],
  );

  const requestDeleteKit = useCallback(
    (kitId: string) => {
      const kit = kits.find((k) => k.id === kitId);
      if (kit) setPendingDelete(kit);
    },
    [kits],
  );

  const handleDeleteSelectedKit = useCallback(() => {
    const kit = selectedKitRef.current;
    if (kit) requestDeleteKit(kit.id);
  }, [requestDeleteKit]);

  const confirmDeleteKit = useCallback(async () => {
    const kit = pendingDelete;
    if (!kit) return;
    setDeleting(true);
    try {
      await deleteBrandKit(getToken(), kit.id);
      const remaining = await refreshList();
      if (selectedKitRef.current?.id === kit.id) {
        const nextKit = remaining[0];
        if (nextKit) {
          await loadKitDetail(nextKit.id);
        } else {
          setSelectedKit(null);
        }
      }
      setPendingDelete(null);
    } catch (err) {
      if (await handleAuthError(err, "套件没有删除，请稍后再试")) return;
      console.error("[brand-kit] delete failed", err);
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, getToken, handleAuthError, refreshList, loadKitDetail]);

  // --- Asset handlers ---

  const handleAddAsset = useCallback(
    async (
      type: BrandKitAssetType,
      displayName: string,
      textContent?: string | null,
      metadata?: Record<string, unknown>,
    ) => {
      const kit = selectedKitRef.current;
      if (!kit) return;
      try {
        await createBrandKitAsset(getToken(), kit.id, {
          asset_type: type,
          display_name: displayName,
          text_content: textContent ?? null,
          metadata,
        });
        await loadKitDetail(kit.id);
      } catch (err) {
        if (await handleAuthError(err, "素材没有添加成功")) return;
        console.error("[brand-kit] create asset failed", err);
      }
    },
    [getToken, handleAuthError, loadKitDetail],
  );

  const handleUpdateAsset = useCallback(
    async (
      assetId: string,
      data: { display_name?: string; text_content?: string | null },
    ) => {
      const kit = selectedKitRef.current;
      if (!kit) return;
      try {
        await updateBrandKitAsset(getToken(), kit.id, assetId, data);
        await loadKitDetail(kit.id);
      } catch (err) {
        if (await handleAuthError(err, "素材修改没有保存")) return;
        console.error("[brand-kit] update asset failed", err);
      }
    },
    [getToken, handleAuthError, loadKitDetail],
  );

  const handleDeleteAsset = useCallback(
    async (assetId: string) => {
      const kit = selectedKitRef.current;
      if (!kit) return;
      try {
        await deleteBrandKitAsset(getToken(), kit.id, assetId);
        await loadKitDetail(kit.id);
        await refreshList();
      } catch (err) {
        if (await handleAuthError(err, "素材没有删除")) return;
        console.error("[brand-kit] delete asset failed", err);
      }
    },
    [getToken, handleAuthError, loadKitDetail, refreshList],
  );

  const handleUploadAsset = useCallback(
    async (type: "logo" | "image", file: File) => {
      const kit = selectedKitRef.current;
      if (!kit) return;
      try {
        await uploadBrandKitAsset(getToken(), kit.id, type, file);
        await loadKitDetail(kit.id);
        await refreshList();
      } catch (err) {
        if (await handleAuthError(err, "上传失败，请检查文件格式和大小")) return;
        console.error("[brand-kit] upload asset failed", err);
      }
    },
    [getToken, handleAuthError, loadKitDetail, refreshList],
  );

  // --- Render ---

  if (loading) {
    return <BrandKitSkeleton />;
  }

  if (loadFailed) {
    return (
      <div className="flex h-[70dvh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-fg">品牌套件没有加载出来。</p>
        <Button variant="outline" onClick={() => void loadAll()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    // Two glass panels that fill the viewport under the 84px workspace nav
    // (desktop); the editor scrolls inside its own panel.
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pt-2 sm:px-8 md:-mb-8 md:h-[calc(100dvh-132px)] md:flex-row md:pt-4 lg:px-12">
      {/* Sidebar: full width horizontal on mobile, vertical panel on md+ */}
      <BrandKitSidebar
        kits={kits}
        selectedKitId={selectedKit?.id ?? null}
        onSelectKit={handleSelectKit}
        onCreateKit={handleCreateKit}
        onDeleteKit={requestDeleteKit}
      />

      {selectedKit ? (
        <BrandKitEditor
          kit={selectedKit}
          onUpdateKit={handleUpdateKit}
          onDeleteKit={handleDeleteSelectedKit}
          onDuplicateKit={handleDuplicateKit}
          onAddAsset={handleAddAsset}
          onUpdateAsset={handleUpdateAsset}
          onDeleteAsset={handleDeleteAsset}
          onUploadAsset={handleUploadAsset}
        />
      ) : (
        <EmptyState onCreateKit={handleCreateKit} />
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>删除「{pendingDelete?.name}」？</DialogTitle>
            <DialogDescription>
              套件里的标志、颜色、字体和图片会一起删除。用过它的画布项目会保留，只是不再关联这个套件。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeleteKit()} disabled={deleting}>
              {deleting ? "正在删除" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
