"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { hidesCustomerChrome } from "@/lib/customer-route";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export function PwaManager() {
  const pathname = usePathname();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [canOfferInstall, setCanOfferInstall] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Installation remains optional; a registration failure must not break the storefront.
      });
    }

    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const revealInstall = window.setTimeout(() => {
      if (!isStandalone && sessionStorage.getItem("crossly-install-dismissed") !== "1") setCanOfferInstall(true);
    }, 0);

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      setCanOfferInstall(true);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setCanOfferInstall(false);
      setShowHelp(false);
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(revealInstall);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) {
      setShowHelp(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setCanOfferInstall(false);
    setInstallPrompt(null);
  }

  function dismiss() {
    sessionStorage.setItem("crossly-install-dismissed", "1");
    setCanOfferInstall(false);
    setShowHelp(false);
  }

  if (!canOfferInstall || hidesCustomerChrome(pathname)) return null;
  return (
    <aside className="pwa-install" aria-label="Install DeshDak application">
      <button className="pwa-install-action" onClick={install} type="button">
        <span aria-hidden="true">↓</span> Install app
      </button>
      <button className="pwa-install-close" onClick={dismiss} type="button" aria-label="Dismiss install suggestion">×</button>
      {showHelp ? (
        <div className="pwa-install-help" role="dialog" aria-modal="false" aria-label="How to install DeshDak">
          <b>Install DeshDak</b>
          <p>On iPhone or iPad, open Share and choose <strong>Add to Home Screen</strong>. On desktop, use your browser menu and choose <strong>Install DeshDak</strong> or <strong>Add to Dock</strong>.</p>
          <button onClick={() => setShowHelp(false)} type="button">Got it</button>
        </div>
      ) : null}
    </aside>
  );
}
