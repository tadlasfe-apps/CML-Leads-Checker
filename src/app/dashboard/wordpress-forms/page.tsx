"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WordPressFormsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard/website-leads"); }, [router]);
  return null;
}
