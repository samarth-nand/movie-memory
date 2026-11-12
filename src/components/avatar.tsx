import Image from "next/image";

// Must match images.remotePatterns in next.config.ts; next/image throws on other hosts.
const ALLOWED_HOST = "lh3.googleusercontent.com";

function isAllowedImage(src: string | null): src is string {
  if (!src) return false;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname === ALLOWED_HOST;
  } catch {
    return false;
  }
}

/** Google photo if there is one; otherwise the first letter of the name or email. */
export function Avatar({ image, label }: { image: string | null; label: string }) {
  if (isAllowedImage(image)) {
    return <Image src={image} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full" />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-screen"
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
