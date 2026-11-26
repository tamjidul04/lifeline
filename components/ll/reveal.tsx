"use client";

import { useEffect } from "react";

/**
 * Pops elements marked `data-reveal` into view as they are scrolled to.
 * Progressive enhancement: content is visible by default. Only elements still below the screen are
 * hidden (after this script runs), so nothing disappears without JavaScript, and people who ask
 * for reduced motion get no animation at all.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("ll-reveal-in");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );

    const targets = [...document.querySelectorAll<HTMLElement>("[data-reveal]")].filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight,
    );
    for (const el of targets) {
      el.classList.add("ll-reveal-wait");
      observer.observe(el);
    }
    // After the pop finishes, drop the classes so hover effects use their own transitions again.
    const settle = (e: TransitionEvent) => {
      const el = e.target as HTMLElement;
      if (e.propertyName === "opacity" && el.classList.contains("ll-reveal-in")) el.classList.remove("ll-reveal-wait", "ll-reveal-in");
    };
    document.addEventListener("transitionend", settle);

    return () => {
      observer.disconnect();
      document.removeEventListener("transitionend", settle);
      for (const el of targets) el.classList.remove("ll-reveal-wait", "ll-reveal-in");
    };
  }, []);

  return null;
}
