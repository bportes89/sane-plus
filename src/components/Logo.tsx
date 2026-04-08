import Link from "next/link";

export function Logo({
  href,
  size = "md",
}: {
  href?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const className =
    size === "sm"
      ? "text-xl"
      : size === "lg"
        ? "text-4xl"
        : "text-2xl";

  const content = (
    <span className={`${className} font-title font-bold tracking-tight`}>
      <span className="text-primary">SANE</span>
      <span className="text-accent">+</span>
    </span>
  );

  if (href === null) return content;
  return (
    <Link href="/" className="inline-flex items-center gap-2">
      {content}
    </Link>
  );
}
