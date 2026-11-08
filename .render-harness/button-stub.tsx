import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
    >
      {children}
    </button>
  );
}
