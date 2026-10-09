"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { LoginView } from "../../components/auth/login-view";
import { LoadingScreen } from "../../components/loading-screen";
import { LoginForm } from "../../components/login-form";
import { useAuth } from "../../lib/auth-context";
import { safeNextPath } from "../../lib/pending-prompt";

const NOTICE_COPY: Record<string, string> = {
  expired: "登录已过期，请重新登录。",
  auth_callback_retired: "这个登录链接已不再使用，请用主站账号登录。",
};

function LoginPageContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const reason = searchParams.get("reason") ?? searchParams.get("error");
  const initialErrorMessage = reason
    ? (NOTICE_COPY[reason] ?? "登录没有完成，请重新登录。")
    : null;

  // Only redirect a visitor who was already signed in when the page opened.
  // A fresh login navigates from the form after the workspace bootstrap.
  const decided = useRef(false);
  useEffect(() => {
    if (loading || decided.current) return;
    decided.current = true;
    if (user) router.replace(next);
  }, [user, loading, router, next]);

  if (loading || (user && !decided.current)) return <LoadingScreen />;

  return (
    <LoginView>
      <LoginForm initialErrorMessage={initialErrorMessage} next={next} />
    </LoginView>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LoginPageContent />
    </Suspense>
  );
}
