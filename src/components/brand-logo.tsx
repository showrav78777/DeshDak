"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export function BrandLogo({ href = "/", suffix }: { href?: string; suffix?: string }) {
  const [logo, setLogo] = useState("/brand/deshdak-mark-v2.webp");
  useEffect(() => { let active = true; fetch("/api/v1/website-appearance", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((result) => { if (active && result?.data?.logo) setLogo(result.data.logo); }).catch(() => {}); return () => { active = false; }; }, []);
  const label = suffix ? `DeshDak ${suffix}` : "DeshDak";
  return <Link className="brand brand-logo" href={href} aria-label={label}>
    <Image alt="" aria-hidden="true" className="brand-logo-mark" height={40} priority unoptimized src={logo} width={40} />
    <span>DeshDak{suffix ? <small>{suffix}</small> : null}</span>
  </Link>;
}
